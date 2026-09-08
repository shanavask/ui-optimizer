"""Pydantic request-body models for the new endpoints. Internal data (audit
docs, pipeline docs, Firestore payloads) stays as plain dicts, matching the
existing main.py convention and the defensive/partial-shape parsing in
firestore_store.py."""

from pydantic import BaseModel


class AnalyzeRequest(BaseModel):
    urlsText: str
    saveRun: bool = False
    runId: str | None = None
    username: str | None = None


class SaveRunRequest(BaseModel):
    audit: dict
    runId: str


class GuestimateRequest(BaseModel):
    runId: str
    urlsText: str
    guestimateText: str = ""
    username: str | None = None


class RoiPatchRequest(BaseModel):
    content: str


class RunIdRequest(BaseModel):
    runId: str


class RedoScreenshotRequest(BaseModel):
    runId: str
    pageIndex: int


class RememberRequest(BaseModel):
    vertical: str
    pageType: str
    bestPractices: str
    username: str | None = None
    sessionId: str | None = None


class ReportGenerateRequest(BaseModel):
    runId: str
    username: str | None = None
