"""Per-step trigger functions shared by the manual API routes and the
pipeline state machine. Port of frontend/src/lib/pipeline-actions.ts.

`run_eyequant_step`/`run_slides_create_step` simplify to direct in-process
calls into `eyequant_runner.generate_eye_shot_for_run`/`slides_builder.create_slides`."""

import base64

from google.cloud import storage

from agent_client import (
    DEFAULT_AGENT_USERNAME,
    auditor_agent_base_url,
    fetch_guestimate_in_session,
    fetch_ui_audit,
    send_prompt_in_session,
    send_prompt_in_session_with_image,
)
from eyequant_runner import generate_eye_shot_for_run
from firestore_store import get_competitor_artifacts, get_slides_url, save_audit_run, save_roi_document_content
from slides_builder import create_slides

GENERATE_REPORT_PROMPT = "generate report"


def run_criteria_step(run_id: str, urls: list[str], username: str = DEFAULT_AGENT_USERNAME) -> None:
    """Narrower than /analyze's combined criteria+dispatch behavior: this
    only regenerates criteria and re-saves the run. The pipeline's own
    "audit" step does the BrowserUse dispatch separately."""
    audit, _ = fetch_ui_audit(auditor_agent_base_url(), urls, username)
    if not audit:
        raise RuntimeError("Agent did not return a parseable UI audit response.")
    save_audit_run(audit, run_id)


def run_guestimate_step(
    run_id: str, urls: list[str], guestimate_context: str = "", username: str = DEFAULT_AGENT_USERNAME
) -> str:
    guestimate = fetch_guestimate_in_session(auditor_agent_base_url(), urls, run_id, guestimate_context, username)
    if not guestimate:
        raise RuntimeError("Auditor agent did not return content.")
    save_roi_document_content(run_id, guestimate)
    return guestimate


def _resolve_screenshot_base64(screenshot: str) -> str | None:
    if screenshot.startswith("gs://"):
        try:
            without_scheme = screenshot[len("gs://") :]
            bucket_name, blob_path = without_scheme.split("/", 1)
            image_bytes = storage.Client().bucket(bucket_name).blob(blob_path).download_as_bytes()
            return base64.b64encode(image_bytes).decode("utf-8")
        except Exception:
            return None
    if screenshot.startswith("data:"):
        comma_idx = screenshot.find(",")
        return screenshot[comma_idx + 1 :] if comma_idx != -1 else None
    return screenshot


def _build_competitor_audit_prompt(
    competitor_name: str, competitor_url: str, page_type: str, best_practices: list[str]
) -> str:
    criteria = "\n".join(f"{i + 1}. {bp}" for i, bp in enumerate(best_practices))
    return (
        f"run audit for {competitor_name} for the url {competitor_url} and page type {page_type} "
        f"using the following criteria:\n{criteria}\nusing the screenshot"
    )


def run_competitors_audit_step(run_id: str, audit: dict, username: str = DEFAULT_AGENT_USERNAME) -> dict:
    competitors = audit.get("competitors") or []
    if not competitors:
        return {"dispatched": [], "skipped": [], "errors": []}

    artifacts = get_competitor_artifacts(run_id, len(audit["pages"]), len(competitors))

    dispatched: list[str] = []
    skipped: list[str] = []
    errors: list[str] = []

    unique_page_types = list(dict.fromkeys(p["page_type"] for p in audit["pages"] if p.get("page_type")))

    for page_type in unique_page_types:
        page_index = next((i for i, p in enumerate(audit["pages"]) if p.get("page_type") == page_type), None)
        if page_index is None:
            continue
        page = audit["pages"][page_index]

        for ci, competitor in enumerate(competitors):
            artifact = (
                artifacts[page_index][ci]
                if page_index < len(artifacts) and ci < len(artifacts[page_index])
                else {}
            )
            label = f"{competitor['competitor_name']}/{page_type}"
            screenshot = artifact.get("screenshot")
            if not screenshot or not screenshot.strip():
                skipped.append(label)
                continue
            try:
                base64_image = _resolve_screenshot_base64(screenshot)
                if not base64_image:
                    skipped.append(label)
                    continue
                prompt = _build_competitor_audit_prompt(
                    competitor["competitor_name"],
                    competitor["competitor_url"],
                    page_type,
                    page.get("best_practices", []),
                )
                send_prompt_in_session_with_image(auditor_agent_base_url(), run_id, prompt, base64_image, username)
                dispatched.append(label)
            except Exception as err:  # noqa: BLE001 - collected into errors, not swallowed
                errors.append(f"{label}: {err}")

    return {"dispatched": dispatched, "skipped": skipped, "errors": errors}


def run_eyequant_step(run_id: str, page_index: int | None = None) -> str:
    return generate_eye_shot_for_run(run_id, page_index)


def run_report_generate_step(run_id: str, username: str = DEFAULT_AGENT_USERNAME) -> None:
    send_prompt_in_session(auditor_agent_base_url(), run_id, GENERATE_REPORT_PROMPT, username)


def run_slides_create_step(run_id: str, task_ids: list[str]) -> str:
    existing = get_slides_url(run_id)
    if existing:
        return existing
    return create_slides(task_ids)
