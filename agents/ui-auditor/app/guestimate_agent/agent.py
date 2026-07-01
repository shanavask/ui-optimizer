import os
import logging

from google.adk.agents import Agent, LlmAgent
from google.adk.agents.callback_context import CallbackContext
from google.adk.tools.agent_tool import AgentTool
from google.adk.tools.google_search_tool import google_search
from google.adk.models import Gemini
from google.adk.tools.load_memory_tool import LoadMemoryTool
from google.adk.tools.preload_memory_tool import PreloadMemoryTool
from google.adk.tools.load_web_page import load_web_page
from google.genai import types
from google.cloud import firestore

from .tools import similarweb_traffic_and_engagement
from .tools import generate_memories_callback
from .prompts import GUESTIMATE_PROMPT
from app.app_utils.utils import firestore_client


logger = logging.getLogger(__name__)

search_agent = LlmAgent(
    name="basic_search_agent",
    model=os.getenv("LLM_MODEL", "gemini-flash-latest"),
    description="Agent to answer questions using Google Search.",
    instruction="I can answer your questions by searching the internet. Just ask me anything!",
    tools=[google_search],
)

async def save_output(callback_context: CallbackContext) -> None:
    output = callback_context.state.get("guestimate_output")
    session_id = callback_context.session.id
    if not session_id or not output:
        return

    try:
        client = firestore_client()
        await client.collection("roi").document(session_id).set(
            {"content": output, "source": "guestimate-agent", "updatedAt": firestore.SERVER_TIMESTAMP},
            merge=True,
        )
        await client.close()
        logger.info("Saved guestimate to Firestore roi/%s", session_id)
    except Exception:
        logger.exception("Failed to save guestimate to Firestore roi/%s", session_id)

guestimate_agent = Agent(
    name="ui_guestimate_agent",
    model=Gemini(
        model=os.getenv("LLM_MODEL", "gemini-flash-latest"),
        retry_options=types.HttpRetryOptions(attempts=3),
    ),
    instruction=GUESTIMATE_PROMPT,
    tools=[
        load_web_page,
        similarweb_traffic_and_engagement,
        PreloadMemoryTool(),
        LoadMemoryTool(),
        AgentTool(agent=search_agent),
    ],
    output_key="guestimate_output",
    after_agent_callback=[generate_memories_callback, save_output]
)