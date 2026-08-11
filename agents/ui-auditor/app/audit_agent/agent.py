import logging
import os
import uuid
from typing import Literal

from google.adk.agents import Agent
from google.adk.agents.callback_context import CallbackContext
from google.adk.models import Gemini
from google.adk.models.llm_request import LlmRequest
from google.adk.models.llm_response import LlmResponse
from google.cloud import firestore
from google.genai import types
from pydantic import BaseModel, Field

from .tools import load_web_page
from .prompts import AUDIT_PROMPT
from app.app_utils.utils import firestore_client

logger = logging.getLogger(__name__)


def inject_image_parts(
    callback_context: CallbackContext, llm_request: LlmRequest
) -> LlmResponse | None:
    raw_parts = callback_context.state.get("input_parts")
    if not raw_parts:
        return None
    input_parts = [types.Part.model_validate_json(s) for s in raw_parts]
    for content in reversed(llm_request.contents):
        if content.role == "user":
            content.parts.extend(input_parts)
            break
    return None


async def save_output(callback_context: CallbackContext) -> None:
    output = callback_context.state.get("audit_output")
    session_id = callback_context.session.id
    if not session_id or not output:
        return

    try:
        client = firestore_client()
        audit_key = str(uuid.uuid4())
        await client.collection("shots").document(session_id).set(
            {audit_key: {"audit": output, "source": "audit-agent", "updatedAt": firestore.SERVER_TIMESTAMP}},
            merge=True,
        )
        client.close()
        logger.info("Saved audit to Firestore shots/%s", session_id)
    except Exception:
        logger.exception("Failed to save audit to Firestore shots/%s", session_id)


class Findings(BaseModel):
    """Audit findings for each criteria"""
    criteria: str = Field(description="The specific UI/UX criteria being evaluated")
    finding: str = Field(default=None, description="A brief, snappy statement of the problem or issue observed")
    recommendation: str = Field(default=None, description="A brief, actionable fix to elevate the implementation to Excellent")
    rating: Literal["Poor", "Good", "Excellent"] = Field(default=None, description="The rating assigned to the competitor's implementation")
    score: int = Field(description="Numeric score mapped from rating: Poor=0, Good=1", ge=0, le=1)

class UIAuditResponse(BaseModel):
    company_name: str = Field(default=None, description="The name of the client or company")
    page_url: str = Field(default=None, description="The URL of the client's implementation")
    page_type: str = Field(default=None, description="The page type of the client's implementation")    
    score: int = Field(default=None, description="Overall Numeric score out of 100")
    findings: list[Findings] = Field(default=None, description="Ratings for competing implementations")


audit_agent = Agent(
    name="ui_audit_agent",
    model=Gemini(
        model=os.getenv("LLM_MODEL", "gemini-flash-latest"),
        retry_options=types.HttpRetryOptions(attempts=3),
    ),
    output_schema=UIAuditResponse,
    instruction=AUDIT_PROMPT,
    tools=[load_web_page],
    output_key="audit_output",
    before_model_callback=inject_image_parts,
    after_agent_callback=save_output,
)
