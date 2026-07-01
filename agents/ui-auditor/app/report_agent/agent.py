import json
import logging
import os
# from pathlib import Path

from typing import Any, List, Optional, Literal
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

class BestPracticeRating(BaseModel):
    """One entry per evaluated best practice (Section 1 — full diagnostic)."""
    best_practice: str = Field(description="The name of the best practice / criterion evaluated")
    category: str = Field(default=None, description="The category the best practice belongs to")
    rating: Literal["Poor", "Good", "Excellent"] = Field(description="The rating assigned to the implementation")
    score: int = Field(description="Numeric score mapped from rating: Poor=0, Good=1, Excellent=2", ge=0, le=2)
    observation: str = Field(description="One-sentence justification for the rating (max about 150 characters)")


class Findings(BaseModel):
    """One of the 7 prioritized problems (Section 2)."""
    problem_discovered: str = Field(description="The snappy problem statement in 3-5 words")
    description_of_problem: str = Field(description="A brief explanation of the impact on user experience (max about 100 characters)")
    rating: Literal["Poor", "Good"] = Field(description="The problem rating — only Poor or Good qualify as problems")
    reference: str = Field(description="The specific best practice used, or 'General Heuristic' if found via supplemental analysis")
    reasoning: str = Field(default=None, description="Brief explanation of the analysis / observation")
    recommendation: str = Field(default=None, description="A brief, actionable fix to elevate the implementation to Excellent")
    score: int = Field(description="Numeric score mapped from rating: Poor=0, Good=1", ge=0, le=1)


class Recommendations(BaseModel):
    recommendation: str = Field(default=None, description="An actionable recommendation based on the analysis")
    priority: Literal["high", "medium", "low"] = Field(default=None, description="The priority of the recommendation")
    action: str = Field(default=None, description="The action to be taken based on the recommendation")
    impact: str = Field(default=None, description="The expected impact of implementing the recommendation")

class MediaMetrics(BaseModel):
    media_spend: int = Field(default=None, description="The annual paid media spend")
    media_traffic: int = Field(default=None, description="The annual paid media traffic")
    media_transactions: int = Field(default=None, description="The annual paid media transactions")
    revenue_per_sale: int = Field(default=None, description="The revenue per sale")
    currency: str = Field(default=None, description="The currency as a 3-letter code (e.g. USD, EUR, GBP, etc.)")
    current_cvr: float = Field(default=None, description="The current conversion rate percentage (0-100%)")
    cvr_lift: float = Field(default=None, description="The estimated conversion rate lift percentage (0-100%)")
    projected_cvr: float = Field(default=None, description="The projected conversion rate after improvements percentage (0-100%)")
    revenue_opp: int = Field(default=None, description="The revenue opportunity")
    annual_cost: int = Field(default=None, description="The annual cost of media spend")
    roi_percentage: float = Field(default=None, description="The estimated ROI percentage (0-100%)")

class FinalOutput(BaseModel):
    final_score: int = Field(default=None, description="Overall score normalized to 100, computed across ALL best_practice_ratings (sum of scores / max possible * 100)")
    url: str = Field(default=None, description="The url being analyzed")
    page_type: str = Field(default=None, description="Type of the page being analyzed")
    vertical: str = Field(default=None, description="The industry vertical of the url being analyzed")
    clientName: str = Field(default=None, description="The name of the url owner")
    status: Literal["good", "bad", "opportunity"] = Field(default=None, description="Overall status based on the analysis")
    executive_summary: str = Field(default=None, description="A brief, high-level summary of the overall audit findings")
    best_practice_ratings: list[BestPracticeRating] = Field(default=None, description="Full diagnostic — a rating for every best practice evaluated (Section 1)")
    findings: list[Findings] = Field(default=None, description="The 7 prioritized problems (Section 2)")
    recommendations: list[Recommendations] = Field(default=None, description="A single, consolidated list of actionable recommendations from all sub-reports")
    media_metrics: MediaMetrics = Field(default=None, description="The media metrics used for ROI estimation")

async def load_report(callback_context: CallbackContext) -> None:
    session_id = callback_context.session.id
    

    try:
        run_id = task_id.split("_page_")[0]
        page_id = int(task_id.split("_page_")[1])

        client = firestore_client()

        runs_doc = await client.collection("runs").document(run_id).get()
        runs_data = (runs_doc.to_dict() or {}).get("audit", {})

        roi_doc = await client.collection("roi").document(run_id).get()
        guestimate = (roi_doc.to_dict() or {}).get("content", "")

        audits_doc = await client.collection("audits").document(task_id).get()
        audit_result = (audits_doc.to_dict() or {}).get("result", "")

        await client.close()

        report = {
            "vertical": runs_data.get("vertical", ""),
            "company_name": runs_data.get("company_name", ""),
            "page": (runs_data.get("pages") or [])[page_id] if runs_data.get("pages") else {},
            "guestimate": guestimate,
            "audit": audit_result,
        }
        callback_context.state["final_report"] = json.dumps(report, indent=2)
    except Exception:
        logger.exception("Failed to load report from Firestore for task_id=%s", task_id)

    return None


async def save_output(callback_context: CallbackContext) -> None:
    output = callback_context.state.get("report_output")
    session_id = callback_context.session.id
    if not session_id or not output:
        return

    try:
        client = firestore_client()
        await client.collection("runs").document(session_id).set(
            {"audit": output, "source": "report-agent", "updatedAt": firestore.SERVER_TIMESTAMP},
            merge=True,
        )
        await client.close()
        logger.info("Saved audit to Firestore runs/%s", session_id)
    except Exception:
        logger.exception("Failed to save audit to Firestore runs/%s", session_id)


report_agent = Agent(
    name="ui_report_agent",
    model=Gemini(
        model=os.getenv("LLM_MODEL", "gemini-flash-latest"),
        retry_options=types.HttpRetryOptions(attempts=3),
    ),
    output_schema=FinalOutput,
    instruction="""
You are converting a UX audit report and guestimate report into structured JSON matching the provided schema. Extract only what is present in the report — do not invent findings, ratings, recommendations or guestimates.

The audit report has two distinct parts that map to two different fields. Keep them separate:

1. "Section 1 — Best Practice Ratings" → `best_practice_ratings`. Create one entry for EVERY best practice listed, including those rated Excellent. For each, capture the best practice name, its category if stated, the rating, and the one-line observation.

2. "Section 2 — Top 7 Problems" → `findings`. There should be exactly 7. For each, capture the problem headline (`problem_discovered`), the impact (`description_of_problem`), the rating (Poor or Good only), the `reference` (the named best practice, or "General Heuristic"), the reasoning, and the per-problem recommendation.

Scoring rules:
- Map every rating to a score: Poor = 0, Good = 1, Excellent = 2.
- `final_score`: sum the scores across ALL `best_practice_ratings`, divide by the maximum possible (2 × number of ratings), and multiply by 100. Round to the nearest integer.
- Derive `status` from `final_score` (or the report's stated overall verdict if given): roughly good / opportunity / bad.

Also extract `url`, `vertical`, `clientName`, and `executive_summary` if present in the report; leave them null if absent. Compile `recommendations` as a consolidated list from the report's recommendations.

For the media metrics, use the guestimate report and extract the values from the report.

The report is as follows:
{final_report}
""",
    tools=[],
    output_key="report_output",
    before_agent_callback=load_report,
    after_agent_callback=save_output,
)
