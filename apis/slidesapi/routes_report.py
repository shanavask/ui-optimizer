from fastapi import APIRouter, HTTPException, Query

from agent_client import DEFAULT_AGENT_USERNAME
from firestore_store import get_audit_run, get_guestimate_report, get_page_reports, get_slides_url
from models import ReportGenerateRequest
from pipeline_actions import run_report_generate_step

router = APIRouter()


@router.get("/slides/reports")
def get_slides_reports(runId: str = Query(...)) -> dict:
    run_id = runId.strip()
    if not run_id:
        raise HTTPException(status_code=400, detail={"error": "runId is required."})
    audit = get_audit_run(run_id)
    page_count = len(audit["pages"]) if audit else 0
    reports = get_page_reports(run_id, page_count)
    guestimate_metrics = get_guestimate_report(run_id)
    return {"reports": reports, "guestimateMetrics": guestimate_metrics}


@router.get("/slides/url")
def get_slides_url_route(runId: str = Query(...)) -> dict:
    run_id = runId.strip()
    if not run_id:
        raise HTTPException(status_code=400, detail={"error": "runId is required."})
    return {"slidesUrl": get_slides_url(run_id)}


@router.post("/report/generate")
def post_report_generate(body: ReportGenerateRequest) -> dict:
    run_id = body.runId.strip()
    if not run_id:
        raise HTTPException(status_code=400, detail={"error": "runId is required."})
    username = (body.username or "").strip() or DEFAULT_AGENT_USERNAME
    try:
        run_report_generate_step(run_id, username)
    except Exception as err:
        raise HTTPException(
            status_code=502, detail={"error": str(err) or "Unable to run auditor agent for report generation."}
        )
    return {"ok": True}
