from typing import Literal, TypedDict

PipelineStepId = Literal[
    "criteria",
    "audit",
    "guestimate",
    "competitors_run",
    "competitors_audit",
    "eyequant",
    "report_generate",
    "slides_create",
]

PIPELINE_STEP_ORDER: list[PipelineStepId] = [
    "criteria",
    "audit",
    "guestimate",
    "competitors_run",
    "competitors_audit",
    "eyequant",
    "report_generate",
    "slides_create",
]

# A "blocking" step's trigger call only returns once the underlying work is
# done, so completion = trigger success. Non-blocking steps dispatch async
# work (BrowserUse) or lag their Firestore write (EyeQuant), so the tick
# route must poll a completion predicate after triggering.
STEP_IS_BLOCKING: dict[PipelineStepId, bool] = {
    "criteria": True,
    "audit": False,
    "guestimate": True,
    "competitors_run": False,
    "competitors_audit": True,
    "eyequant": False,
    "report_generate": True,
    "slides_create": True,
}

STEP_POLL_DELAY_SECONDS: dict[PipelineStepId, int] = {
    "criteria": 0,
    "audit": 15,
    "guestimate": 0,
    "competitors_run": 15,
    "competitors_audit": 0,
    "eyequant": 15,
    "report_generate": 0,
    "slides_create": 0,
}

# Soft staleness guard: if a non-blocking step is still "running" after this
# long (in seconds), the pipeline fails instead of polling forever against a
# stuck job. NOTE: these are SECONDS, not milliseconds like the original
# TypeScript `STEP_TIMEOUT_MS` table this was ported from.
STEP_TIMEOUT_SECONDS: dict[PipelineStepId, int] = {
    "criteria": 10 * 60,
    "audit": 30 * 60,
    "guestimate": 10 * 60,
    "competitors_run": 30 * 60,
    "competitors_audit": 10 * 60,
    "eyequant": 10 * 60,
    "report_generate": 10 * 60,
    "slides_create": 10 * 60,
}

# Per-step timeout (seconds) for the trigger call itself, mirroring the
# timeouts the equivalent manual routes already used (e.g. /api/analyze's
# 600s, /api/roi/guestimate's 300s). The Cloud Tasks queue's own dispatch
# deadline must be configured at least this long for the longest step
# (competitors_audit/criteria, 600s) plus headroom.
STEP_TRIGGER_TIMEOUT_SECONDS: dict[PipelineStepId, int] = {
    "criteria": 600,
    "audit": 60,
    "guestimate": 300,
    "competitors_run": 60,
    "competitors_audit": 600,
    "eyequant": 300,
    "report_generate": 300,
    "slides_create": 300,
}

# Collapses the 8 internal steps to 6 user-facing labels for display.
DISPLAY_STEP_LABEL: dict[PipelineStepId, str] = {
    "criteria": "Criteria",
    "audit": "Audit",
    "guestimate": "Guestimate",
    "competitors_run": "Competitors",
    "competitors_audit": "Competitors",
    "eyequant": "EyeQuant",
    "report_generate": "Slides",
    "slides_create": "Slides",
}

PipelineStepStatus = Literal["pending", "running", "completed", "failed", "skipped"]
PipelineStatus = Literal["running", "completed", "failed"]


class PipelineStepRecord(TypedDict, total=False):
    status: PipelineStepStatus
    startedAt: str
    completedAt: str
    error: str


class PipelineDoc(TypedDict):
    runId: str
    currentStepIndex: int
    status: PipelineStatus
    steps: dict[PipelineStepId, PipelineStepRecord]
    error: str | None
    createdAtIso: str
    updatedAtIso: str
