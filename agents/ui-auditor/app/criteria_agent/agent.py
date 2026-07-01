import json
import logging
import os
# from pathlib import Path

from google.adk.agents import Agent
from google.adk.agents.callback_context import CallbackContext
from google.adk.models import Gemini
from google.adk.tools.tool_context import ToolContext
from google.cloud import firestore
# from dotenv import load_dotenv
from google.genai import types
from pydantic import BaseModel
from pydantic import Field

from .tools import load_web_page
from .prompts import CRITERIA_PROMPT
from app.app_utils.utils import firestore_client

# load_dotenv(dotenv_path=Path(__file__).resolve().parent.parent / ".env")

logger = logging.getLogger(__name__)

async def search_memories(query: str, tool_context: ToolContext):
  """Query this tool when you need to fetch information about user preferences."""
  return await tool_context.search_memory(query)


async def remember_this_callback(callback_context: CallbackContext) -> None:
  """Persist the current session context to long-term memory."""
  await callback_context.add_session_to_memory()
  return None


class PageAudit(BaseModel):
    url: str = Field(description="The URL of the page.")
    page_type: str = Field(
        description="The identified type of the page (e.g., Home Page, Product Page, Cart Page)."
    )
    best_practices: list[str] = Field(
        description="5-7 UI/UX best practices specifically for this page type."
    )

class Competitors(BaseModel):
    competitor_name: str = Field(description="The name of the competitor.")
    competitor_url: str = Field(description="The URL of the competitor's page.")

class UIAuditResponse(BaseModel):
    company_name: str = Field(description="The name of the company.")
    vertical: str = Field(
        description="The vertical of the parent domain (e.g., Ecommerce, Finance)."
    )
    competitors: list[Competitors] = Field(description="List of 2 competitors for the provided URL.")
    pages: list[PageAudit] = Field(description="List of audits for each provided URL.")
    message: str = Field(description="A message to the user.")

async def save_output(callback_context: CallbackContext) -> None:
    output = callback_context.state.get("criteria_output")
    session_id = callback_context.session.id
    if not session_id or not output:
        return

    try:
        client = firestore_client()
        await client.collection("runs").document(session_id).set(
            {"audit": output, "source": "criteria-agent", "updatedAt": firestore.SERVER_TIMESTAMP},
            merge=True,
        )
        await client.close()
        logger.info("Saved audit to Firestore runs/%s", session_id)
    except Exception:
        logger.exception("Failed to save audit to Firestore runs/%s", session_id)


criteria_agent = Agent(
    name="ui_criteria_agent",
    model=Gemini(
        model=os.getenv("LLM_MODEL", "gemini-flash-latest"),
        retry_options=types.HttpRetryOptions(attempts=3),
    ),
    output_schema=UIAuditResponse,
    instruction=CRITERIA_PROMPT,
    tools=[load_web_page, search_memories, remember_this_callback],
    output_key="criteria_output",
    after_agent_callback=save_output,
)
