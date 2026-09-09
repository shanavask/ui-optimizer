from fastapi import APIRouter, HTTPException

from agent_client import auditor_agent_base_url, fetch_remember_this
from models import RememberRequest

router = APIRouter()


@router.post("/remember")
def post_remember(body: RememberRequest) -> dict:
    vertical = body.vertical.strip()
    page_type = body.pageType.strip()
    best_practices = body.bestPractices.strip()
    if not vertical or not page_type or not best_practices:
        raise HTTPException(
            status_code=400, detail={"error": "vertical, pageType, and bestPractices are required."}
        )
    username = (body.username or "").strip() or None
    session_id = (body.sessionId or "").strip() or None
    try:
        fetch_remember_this(
            auditor_agent_base_url(), vertical, page_type, best_practices, username, session_id, timeout=90
        )
    except Exception as err:
        raise HTTPException(status_code=500, detail={"error": str(err) or "Failed to save memory."})
    return {"ok": True}
