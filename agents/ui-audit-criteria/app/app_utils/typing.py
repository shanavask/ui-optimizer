import uuid
from typing import (
    Literal,
)

from pydantic import (
    BaseModel,
    Field,
)


class Feedback(BaseModel):
    """Represents feedback for a conversation."""

    score: int | float
    text: str | None = ""
    log_type: Literal["feedback"] = "feedback"
    service_name: Literal["ui-auditor"] = "ui-auditor"
    user_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    session_id: str = Field(default_factory=lambda: str(uuid.uuid4()))


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
