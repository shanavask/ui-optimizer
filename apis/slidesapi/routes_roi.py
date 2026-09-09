from fastapi import APIRouter, HTTPException

from agent_client import DEFAULT_AGENT_USERNAME, validate_url_list
from firestore_store import get_roi_document_content, has_roi_document, save_roi_document_content
from models import GuestimateRequest, RoiPatchRequest
from pipeline_actions import run_guestimate_step

router = APIRouter()


@router.get("/roi/{run_id}")
def get_roi(run_id: str) -> dict:
    run_id = run_id.strip()
    if not run_id:
        raise HTTPException(status_code=400, detail={"error": "Run id is required."})
    exists = has_roi_document(run_id)
    content = get_roi_document_content(run_id) if exists else None
    return {"exists": exists, "content": content}


@router.patch("/roi/{run_id}")
def patch_roi(run_id: str, body: RoiPatchRequest) -> dict:
    run_id = run_id.strip()
    if not run_id:
        raise HTTPException(status_code=400, detail={"error": "Run id is required."})
    save_roi_document_content(run_id, body.content)
    return {"ok": True}


@router.post("/roi/guestimate")
def post_guestimate(body: GuestimateRequest) -> dict:
    run_id = body.runId.strip()
    if not run_id:
        raise HTTPException(status_code=400, detail={"error": "runId is required."})
    if not body.urlsText.strip():
        raise HTTPException(status_code=400, detail={"error": "urlsText is required."})
    validated = validate_url_list(body.urlsText)
    if not validated["ok"]:
        raise HTTPException(status_code=400, detail={k: v for k, v in validated.items() if k != "ok"})
    username = (body.username or "").strip() or DEFAULT_AGENT_USERNAME
    try:
        content = run_guestimate_step(run_id, validated["urls"], body.guestimateText, username)
    except Exception as err:
        raise HTTPException(status_code=502, detail={"error": str(err) or "Auditor agent did not return content."})
    return {"content": content}
