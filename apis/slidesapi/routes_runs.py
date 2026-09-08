from fastapi import APIRouter, HTTPException, Query

from browseruse_client import dispatch_browser_use_tasks
from firestore_store import delete_audit_run_documents, get_audit_run, list_audit_runs, parse_ui_audit_response
from models import SaveRunRequest

router = APIRouter()


@router.get("/runs")
def get_runs(limit: int | None = Query(default=None), cursor: str | None = Query(default=None)) -> dict:
    resolved_limit = max(1, min(100, limit)) if limit else 10
    return list_audit_runs(resolved_limit, cursor)


@router.post("/runs")
def post_runs(body: SaveRunRequest) -> dict:
    audit = parse_ui_audit_response(body.audit)
    if not audit:
        raise HTTPException(status_code=400, detail={"error": "Request body must include a valid audit."})
    run_id = body.runId.strip()
    if not run_id:
        raise HTTPException(status_code=400, detail={"error": "runId is required."})
    audit_with_task_state = dispatch_browser_use_tasks(audit, run_id)
    return {"runId": run_id, "audit": audit_with_task_state}


@router.get("/runs/{run_id}")
def get_run(run_id: str) -> dict:
    run_id = run_id.strip()
    if not run_id:
        raise HTTPException(status_code=400, detail={"error": "Run id is required."})
    audit = get_audit_run(run_id)
    if not audit:
        raise HTTPException(status_code=404, detail={"error": "Run not found."})
    return {"audit": audit}


@router.delete("/runs/{run_id}")
def delete_run(run_id: str) -> dict:
    run_id = run_id.strip()
    if not run_id:
        raise HTTPException(status_code=400, detail={"error": "Run id is required."})
    delete_audit_run_documents(run_id)
    return {"ok": True}
