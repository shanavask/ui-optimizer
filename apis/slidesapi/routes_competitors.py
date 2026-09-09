from fastapi import APIRouter, HTTPException, Query

from browseruse_client import dispatch_competitor_tasks
from firestore_store import get_audit_run, get_competitor_artifacts, shots_document_exists
from models import RunIdRequest
from pipeline_actions import run_competitors_audit_step

router = APIRouter()


@router.post("/competitors/run")
def post_competitors_run(body: RunIdRequest) -> dict:
    run_id = body.runId.strip()
    if not run_id:
        raise HTTPException(status_code=400, detail={"error": "runId is required."})
    audit = get_audit_run(run_id)
    if not audit:
        raise HTTPException(status_code=404, detail={"error": "Run not found."})
    if not audit.get("competitors"):
        raise HTTPException(status_code=400, detail={"error": "No competitors configured for this run."})
    return dispatch_competitor_tasks(audit, run_id)


@router.get("/competitors/audit")
def get_competitors_audit(runId: str = Query(...)) -> dict:
    run_id = runId.strip()
    if not run_id:
        raise HTTPException(status_code=400, detail={"error": "runId is required."})
    return {"exists": shots_document_exists(run_id)}


@router.post("/competitors/audit")
def post_competitors_audit(body: RunIdRequest) -> dict:
    run_id = body.runId.strip()
    if not run_id:
        raise HTTPException(status_code=400, detail={"error": "runId is required."})
    audit = get_audit_run(run_id)
    if not audit:
        raise HTTPException(status_code=404, detail={"error": "Run not found."})
    if not audit.get("competitors"):
        raise HTTPException(status_code=400, detail={"error": "No competitors configured for this run."})
    return run_competitors_audit_step(run_id, audit)


@router.get("/competitors/artifacts")
def get_competitors_artifacts(runId: str = Query(...)) -> dict:
    run_id = runId.strip()
    if not run_id:
        raise HTTPException(status_code=400, detail={"error": "runId is required."})
    audit = get_audit_run(run_id)
    if not audit:
        raise HTTPException(status_code=404, detail={"error": "Run not found."})
    page_count = len(audit["pages"])
    competitor_count = len(audit.get("competitors") or [])
    return {"artifacts": get_competitor_artifacts(run_id, page_count, competitor_count)}
