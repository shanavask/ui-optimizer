from fastapi import APIRouter, HTTPException

from agent_client import auditor_agent_base_url, fetch_guestimate, fetch_ui_audit, validate_url_list
from browseruse_client import dispatch_browser_use_tasks
from firestore_store import save_audit_run
from models import AnalyzeRequest

router = APIRouter()


@router.post("/analyze")
def analyze(body: AnalyzeRequest) -> dict:
    validated = validate_url_list(body.urlsText)
    if not validated["ok"]:
        raise HTTPException(status_code=400, detail={k: v for k, v in validated.items() if k != "ok"})

    audit, session_id = fetch_ui_audit(auditor_agent_base_url(), validated["urls"], body.username)
    if not audit:
        raise HTTPException(
            status_code=502, detail={"error": "Agent did not return a parseable UI audit response."}
        )

    guestimate = None
    if body.saveRun:
        guestimate = fetch_guestimate(auditor_agent_base_url(), validated["urls"], None, body.username)
    audit_with_guestimate = {**audit, **({"guestimate": guestimate} if guestimate else {})}

    saved_run_id = None
    if body.saveRun:
        saved_run_id = save_audit_run(audit_with_guestimate, body.runId)

    next_audit = audit_with_guestimate
    if body.saveRun:
        next_audit = dispatch_browser_use_tasks(audit_with_guestimate, saved_run_id)

    return {"audit": next_audit, "runId": saved_run_id or session_id}
