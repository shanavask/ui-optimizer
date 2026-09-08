from fastapi import APIRouter, HTTPException, Query

from firestore_store import create_or_reset_pipeline_doc, get_audit_run, get_pipeline_doc
from models import RunIdRequest
from pipeline import run_pipeline_tick, start_pipeline

router = APIRouter()


@router.post("/pipeline/start")
def post_pipeline_start(body: RunIdRequest) -> dict:
    run_id = body.runId.strip()
    if not run_id:
        raise HTTPException(status_code=400, detail={"error": "runId is required."})
    audit = get_audit_run(run_id)
    if not audit:
        raise HTTPException(status_code=404, detail={"error": "Run not found."})
    create_or_reset_pipeline_doc(run_id)
    start_pipeline(run_id, audit)
    return {"ok": True, "pipeline": get_pipeline_doc(run_id)}


@router.get("/pipeline/status")
def get_pipeline_status(runId: str = Query(...)) -> dict:
    run_id = runId.strip()
    if not run_id:
        raise HTTPException(status_code=400, detail={"error": "runId is required."})
    return {"pipeline": get_pipeline_doc(run_id)}


@router.post("/pipeline/tick")
def post_pipeline_tick(body: RunIdRequest) -> dict:
    # Cloud Tasks HTTP target. Cloud Run's --no-allow-unauthenticated setting
    # is the auth boundary here - no manual token verification needed.
    # Business-logic step failures are recorded on the pipelines/{runId} doc
    # by run_pipeline_tick itself and always resolve this request with 200,
    # so Cloud Tasks' own retry only fires for genuine infra failures.
    run_id = body.runId.strip()
    if not run_id:
        raise HTTPException(status_code=400, detail={"error": "runId is required."})
    try:
        run_pipeline_tick(run_id)
    except Exception as err:  # noqa: BLE001 - unexpected orchestrator bug, not a step failure
        print(f"[pipeline/tick] unexpected error for {run_id}: {err}")
        raise HTTPException(status_code=500, detail={"error": "tick failed"})
    return {"ok": True}
