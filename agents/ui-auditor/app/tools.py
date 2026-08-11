import logging
import os

from typing import Literal
from google.adk.tools import ToolContext
from google.genai import Client
from google.genai.types import GenerateContentConfig
from pydantic import BaseModel
from pydantic import Field

from app.app_utils.utils import firestore_client

GOOGLE_CLOUD_PROJECT = os.getenv("GOOGLE_CLOUD_PROJECT")
GOOGLE_CLOUD_LOCATION = os.getenv("GOOGLE_CLOUD_LOCATION")
LLM_MODEL = os.getenv("LLM_MODEL", "gemini-flash-latest")

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
    # rating: Literal["Poor", "Good"] = Field(description="The problem rating — only Poor or Good qualify as problems")
    # reference: str = Field(description="The specific best practice used, or 'General Heuristic' if found via supplemental analysis")
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

# class CompetitorRating(BaseModel):
#     competitor_name: str = Field(default=None, description="The name of the competitor")
#     page_url: str = Field(default=None, description="The URL of the competitor's implementation")
#     page_type: str = Field(default=None, description="The page type of the competitor's implementation")
#     rating: Literal["Poor", "Good", "Excellent"] = Field(default=None, description="The rating assigned to the competitor's implementation")
#     score: int = Field(default=None, description="Numeric score mapped from rating: Poor=0, Good=1, Excellent=2")
#     observation: str = Field(default=None, description="One-sentence justification for the rating (max about 150 characters)")

class FinalOutput(BaseModel):
    final_score: int = Field(default=None, description="Overall score normalized to 100, computed across ALL best_practice_ratings (sum of scores / max possible * 100)")
    status: Literal["good", "bad", "opportunity"] = Field(default=None, description="Overall status based on the analysis")
    executive_summary: str = Field(default=None, description="A brief, high-level summary of the overall audit findings")
    best_practice_ratings: list[BestPracticeRating] = Field(default=None, description="Full diagnostic — a rating for every best practice evaluated (Section 1)")
    findings: list[Findings] = Field(default=None, description="The 7 prioritized problems (Section 2)")
    recommendations: list[Recommendations] = Field(default=None, description="A single, consolidated list of actionable recommendations from all sub-reports")
    # competitor_ratings: list[CompetitorRating] = Field(default=None, description="Ratings for competing implementations")

async def create_reports(tool_context: ToolContext) -> str:
    session_id = tool_context.session.id
    criteria_output = tool_context.state.get("criteria_output")
    # if isinstance(criteria_output, str):
    #     try:
    #         criteria_output = json.loads(criteria_output)
    #     except (json.JSONDecodeError, ValueError):
    #         criteria_output = None
    num_pages = len(criteria_output.get("pages", [])) if isinstance(criteria_output, dict) else 0

    client = firestore_client()
    try:
        for page_id in range(num_pages):
            task_id = f"{session_id}_page_{page_id}"
            doc = await client.collection("audits").document(task_id).get()
            report = (doc.to_dict() or {}).get('result', {}) if doc.exists else {}
            if report:
                json_report = generate_audit_report(report)
                await client.collection("reports").document(task_id).set(json_report, merge=True)

        guestimate_output = tool_context.state.get("guestimate_output")
        guestimate_report = generate_guestimate_report(guestimate_output) if guestimate_output else {}
        if guestimate_report:
            await client.collection("reports").document(session_id).set(guestimate_report, merge=True)
    finally:
        client.close()
    
    return "success"

def generate_guestimate_report(guestimate_output: dict) -> dict:
    """Generate a structured JSON report from the guestimate output using LLM."""
    prompt = f"""
You are converting a guestimate output into structured JSON matching the provided schema. Extract only what is present in the output — do not invent any values.
The guestimate output is as follows:
{guestimate_output}
"""
    llm_client = Client(vertexai=True, project=GOOGLE_CLOUD_PROJECT, location=GOOGLE_CLOUD_LOCATION)
    response = llm_client.models.generate_content(
        model=LLM_MODEL, contents=prompt,
        config=GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=MediaMetrics
        )
    )

    json_output = (response.to_json_dict() or {}).get('parsed')
    # if json_output is None:
    #     logger.warning("generate_guestimate_report: LLM response missing 'parsed' key")
    #     return {}
    return json_output

def generate_audit_report(audit_report: dict) -> dict:
    """Generate a structured JSON report from the final audit report using LLM."""
    prompt = f"""
You are converting a UX audit report  into structured JSON matching the provided schema. Extract only what is present in the report — do not invent findings, ratings, recommendations or guestimates.

The audit report has two distinct parts that map to two different fields. Keep them separate:

1. "Section 1 — Best Practice Ratings" → `best_practice_ratings`. Create one entry for EVERY best practice listed, including those rated Excellent. For each, capture the best practice name, its category if stated, the rating, and the one-line observation.

2. "Section 2 — Top 7 Problems" → `findings`. There should be exactly 7. For each, capture the problem headline (`problem_discovered`), the impact (`description_of_problem`), the rating (Poor or Good only), the `reference` (the named best practice, or "General Heuristic"), the reasoning, and the per-problem recommendation.

Scoring rules:
- Map every rating to a score: Poor = 0, Good = 1, Excellent = 2.
- `final_score`: sum the scores across ALL `best_practice_ratings`, divide by the maximum possible (2 × number of ratings), and multiply by 100. Round to the nearest integer.
- Derive `status` from `final_score` (or the report's stated overall verdict if given): roughly good / opportunity / bad.

Also extract `url`, `vertical`, `clientName`, and `executive_summary` if present in the report; leave them null if absent. Compile `recommendations` as a consolidated list from the report's recommendations.

The report is as follows:
{audit_report}
"""

    llm_client = Client(vertexai=True, project=GOOGLE_CLOUD_PROJECT, location=GOOGLE_CLOUD_LOCATION)
    response = llm_client.models.generate_content(
        model=LLM_MODEL, contents=prompt,
        config=GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=FinalOutput
        )
    )

    json_output = (response.to_json_dict() or {}).get('parsed')
    # if json_output is None:
    #     logger.warning("generate_audit_report: LLM response missing 'parsed' key")
    #     return {}
    return json_output
