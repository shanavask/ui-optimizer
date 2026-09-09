"""Pipeline orchestrator state machine. Port of frontend/src/lib/pipeline.ts.

Single-tick-does-one-thing design (trigger-then-return, or check-then-
return, never both in one invocation): a Cloud Tasks redelivery of the same
tick can't double-trigger, since it always re-reads the doc fresh and the
pending->running flip is transaction-guarded (see firestore_store.begin_pipeline_step).
"""

from datetime import datetime, timezone

from agent_client import DEFAULT_AGENT_USERNAME
from browseruse_client import dispatch_browser_use_tasks, dispatch_competitor_tasks
from cloud_tasks_client import enqueue_pipeline_tick
from firestore_store import (
    advance_pipeline_to_step,
    begin_pipeline_step,
    get_audit_run,
    get_competitor_artifacts,
    get_page_reports,
    get_pipeline_doc,
    get_roi_document_content,
    get_slides_url,
    mark_pipeline_completed,
    mark_pipeline_failed,
    mark_pipeline_step_completed,
    mark_pipeline_steps_skipped,
    shots_document_exists,
)
from pipeline_actions import (
    run_competitors_audit_step,
    run_criteria_step,
    run_eyequant_step,
    run_guestimate_step,
    run_report_generate_step,
    run_slides_create_step,
)
from pipeline_steps import PIPELINE_STEP_ORDER, STEP_IS_BLOCKING, STEP_POLL_DELAY_SECONDS, STEP_TIMEOUT_SECONDS
from task_ids import task_id_for_page


def _to_error_message(err: Exception) -> str:
    message = str(err).strip()
    return message or "Unexpected pipeline step failure."


def _trigger_step(step: str, run_id: str, audit: dict, username: str) -> None:
    urls = [p["url"] for p in audit["pages"]]
    if step == "criteria":
        run_criteria_step(run_id, urls, username)
    elif step == "audit":
        dispatch_browser_use_tasks(audit, run_id)
    elif step == "guestimate":
        run_guestimate_step(run_id, urls, "", username)
    elif step == "competitors_run":
        dispatch_competitor_tasks(audit, run_id)
    elif step == "competitors_audit":
        run_competitors_audit_step(run_id, audit, username)
    elif step == "eyequant":
        run_eyequant_step(run_id, None)
    elif step == "report_generate":
        run_report_generate_step(run_id, username)
    elif step == "slides_create":
        task_ids = [task_id_for_page(run_id, i) for i in range(len(audit["pages"]))]
        run_slides_create_step(run_id, task_ids)
    else:
        raise RuntimeError(f"Unknown pipeline step: {step}")


def _check_step_complete(step: str, run_id: str, audit: dict) -> bool:
    if step == "audit":
        pages = audit["pages"]
        return len(pages) > 0 and all(p.get("audit_status") == "completed" for p in pages)
    if step == "competitors_run":
        competitors = audit.get("competitors") or []
        pages = audit["pages"]
        if not competitors or not pages:
            return True
        artifacts = get_competitor_artifacts(run_id, len(pages), len(competitors))
        for page_index in range(len(pages)):
            for competitor_index, competitor in enumerate(competitors):
                url = competitor.get("competitor_url")
                if not url or not url.strip():
                    continue
                artifact = (
                    artifacts[page_index][competitor_index]
                    if page_index < len(artifacts) and competitor_index < len(artifacts[page_index])
                    else {}
                )
                if artifact.get("exists") is not True:
                    return False
        return True
    if step == "eyequant":
        return not any(not (p.get("eyeshot") or "").strip() for p in audit["pages"])
    # Blocking steps: trigger success already implies completion, this
    # branch is never reached for them by the state machine below.
    return True


def _step_already_done(step: str, run_id: str, audit: dict) -> bool:
    """Whether a step's output already exists from a prior run (manual button
    or an earlier pipeline attempt), independent of this pipeline doc."""
    pages = audit["pages"]
    if step == "criteria":
        return len(pages) > 0
    if step in ("audit", "competitors_run", "eyequant"):
        return _check_step_complete(step, run_id, audit)
    if step == "guestimate":
        return get_roi_document_content(run_id) is not None
    if step == "competitors_audit":
        if not audit.get("competitors"):
            return True
        return shots_document_exists(run_id)
    if step == "report_generate":
        return len(pages) > 0 and all(r is not None for r in get_page_reports(run_id, len(pages)))
    if step == "slides_create":
        return get_slides_url(run_id) is not None
    return False


def start_pipeline(run_id: str, audit: dict) -> None:
    """Called once when the pipeline is (re)started: skips any leading run of
    steps whose output already exists, so re-running the pipeline doesn't
    redo work already done via a manual button or a prior attempt."""
    already_done: list[str] = []
    start_index = len(PIPELINE_STEP_ORDER)
    for i, step in enumerate(PIPELINE_STEP_ORDER):
        if not _step_already_done(step, run_id, audit):
            start_index = i
            break
        already_done.append(step)

    if already_done:
        mark_pipeline_steps_skipped(run_id, already_done)
    if start_index >= len(PIPELINE_STEP_ORDER):
        mark_pipeline_completed(run_id)
        return
    if start_index > 0:
        advance_pipeline_to_step(run_id, start_index)
    enqueue_pipeline_tick(run_id, 0)


def _complete_step_and_advance(run_id: str, current_index: int) -> None:
    step = PIPELINE_STEP_ORDER[current_index]
    mark_pipeline_step_completed(run_id, step)
    next_index = current_index + 1
    if next_index >= len(PIPELINE_STEP_ORDER):
        mark_pipeline_completed(run_id)
        return
    advance_pipeline_to_step(run_id, next_index)
    enqueue_pipeline_tick(run_id, 0)


def run_pipeline_tick(run_id: str) -> None:
    doc = get_pipeline_doc(run_id)
    if not doc or doc["status"] != "running":
        return
    if doc["currentStepIndex"] >= len(PIPELINE_STEP_ORDER):
        mark_pipeline_completed(run_id)
        return
    step = PIPELINE_STEP_ORDER[doc["currentStepIndex"]]

    audit = get_audit_run(run_id)
    if not audit:
        mark_pipeline_failed(run_id, step, f"Run {run_id} not found.")
        return
    username = DEFAULT_AGENT_USERNAME
    has_competitors = bool(audit.get("competitors"))

    # Skip competitor steps entirely when there are no configured
    # competitors - mirrors the manual UI, which hides those buttons too.
    if step == "competitors_run" and not has_competitors:
        mark_pipeline_steps_skipped(run_id, ["competitors_run", "competitors_audit"])
        advance_pipeline_to_step(run_id, PIPELINE_STEP_ORDER.index("eyequant"))
        enqueue_pipeline_tick(run_id, 0)
        return
    if step == "competitors_audit" and not has_competitors:
        mark_pipeline_steps_skipped(run_id, ["competitors_audit"])
        advance_pipeline_to_step(run_id, doc["currentStepIndex"] + 1)
        enqueue_pipeline_tick(run_id, 0)
        return

    record = doc["steps"][step]

    if record["status"] == "pending":
        claimed = begin_pipeline_step(run_id, step)
        if not claimed:
            # Another tick already claimed this step (concurrent/redelivered
            # invocation) - back off briefly and let it run.
            enqueue_pipeline_tick(run_id, 5)
            return
        try:
            _trigger_step(step, run_id, audit, username)
        except Exception as err:  # noqa: BLE001 - recorded on the doc, not re-raised
            mark_pipeline_failed(run_id, step, _to_error_message(err))
            return
        if STEP_IS_BLOCKING[step]:
            _complete_step_and_advance(run_id, doc["currentStepIndex"])
        else:
            enqueue_pipeline_tick(run_id, STEP_POLL_DELAY_SECONDS.get(step) or 15)
        return

    if record["status"] == "running":
        started_at = record.get("startedAt")
        started_at_dt = datetime.fromisoformat(started_at) if started_at else datetime.now(timezone.utc)
        elapsed_seconds = (datetime.now(timezone.utc) - started_at_dt).total_seconds()
        if elapsed_seconds > STEP_TIMEOUT_SECONDS[step]:
            mark_pipeline_failed(
                run_id, step, f'Step "{step}" timed out after {STEP_TIMEOUT_SECONDS[step] // 60} minutes.'
            )
            return
        complete = _check_step_complete(step, run_id, audit)
        if not complete:
            enqueue_pipeline_tick(run_id, STEP_POLL_DELAY_SECONDS.get(step) or 15)
            return
        _complete_step_and_advance(run_id, doc["currentStepIndex"])
        return

    # status is "completed" | "failed" | "skipped": stale/redelivered tick
    # for a step that has already resolved - no-op.
