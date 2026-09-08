from fastapi import APIRouter, HTTPException

from browseruse_client import dispatch_redo_screenshot_task
from firestore_store import EYEQUANT_COLLECTION, get_audit_run, get_firestore_client
from models import RedoScreenshotRequest
from task_ids import task_id_for_page

router = APIRouter()


@router.post("/redo-screenshot")
def post_redo_screenshot(body: RedoScreenshotRequest) -> dict:
    run_id = body.runId.strip()
    if not run_id:
        raise HTTPException(status_code=400, detail={"error": "runId is required."})
    audit = get_audit_run(run_id)
    if not audit:
        raise HTTPException(status_code=404, detail={"error": "Run not found."})
    pages = audit["pages"]
    if body.pageIndex < 0 or body.pageIndex >= len(pages):
        raise HTTPException(status_code=404, detail={"error": f"Page {body.pageIndex} not found."})
    page = pages[body.pageIndex]
    url = (page.get("url") or "").strip()
    if not url:
        raise HTTPException(status_code=400, detail={"error": f"Page {body.pageIndex} has no URL."})

    eyequant_doc_id = task_id_for_page(run_id, body.pageIndex)
    get_firestore_client().collection(EYEQUANT_COLLECTION).document(eyequant_doc_id).delete()

    dispatch_redo_screenshot_task(url, run_id, body.pageIndex)
    return {"ok": True}
