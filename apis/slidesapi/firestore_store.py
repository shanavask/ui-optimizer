"""Firestore access layer. Port of frontend/src/lib/firestore-runs.ts.

Uses a lazy singleton client, since the pipeline tick path calls
Firestore far more often than the two pre-existing routes ever did.
"""

import json
import os
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

from google.cloud import firestore as gcf

from pipeline_steps import PIPELINE_STEP_ORDER
from task_ids import task_id_for_competitor, task_id_for_page, task_id_for_redo_page

RUNS_COLLECTION = "runs"
ROI_COLLECTION = "roi"
AUDITS_COLLECTION = "audits"
EYEQUANT_COLLECTION = "eyequant"
REPORTS_COLLECTION = "reports"
SHOTS_COLLECTION = "shots"
SLIDES_COLLECTION = "slides"
PIPELINES_COLLECTION = "pipelines"

_client: gcf.Client | None = None


def get_firestore_client() -> gcf.Client:
    global _client
    if _client is None:
        project_id = os.getenv("GOOGLE_CLOUD_PROJECT", "").strip()
        database_id = os.getenv("FIRESTORE_DATABASE_ID", "").strip()
        if not project_id:
            raise RuntimeError("GOOGLE_CLOUD_PROJECT is required for Firestore access.")
        _client = gcf.Client(project=project_id, database=database_id) if database_id else gcf.Client(project=project_id)
    return _client


def _get_many(doc_refs: list) -> list:
    if not doc_refs:
        return []
    with ThreadPoolExecutor(max_workers=min(16, len(doc_refs))) as executor:
        return list(executor.map(lambda ref: ref.get(), doc_refs))


def _is_string_list(value) -> bool:
    return isinstance(value, list) and all(isinstance(v, str) for v in value)


def parse_ui_audit_response(value) -> dict | None:
    if not isinstance(value, dict):
        return None
    company_name = value.get("company_name")
    vertical = value.get("vertical")
    pages_raw = value.get("pages")
    if not isinstance(company_name, str) or not isinstance(vertical, str) or not isinstance(pages_raw, list):
        return None

    competitors = []
    for c in value.get("competitors") or []:
        if not isinstance(c, dict):
            continue
        name, url = c.get("competitor_name"), c.get("competitor_url")
        if isinstance(name, str) and isinstance(url, str):
            competitors.append({"competitor_name": name, "competitor_url": url})

    pages = []
    for p in pages_raw:
        if not isinstance(p, dict):
            continue
        url, page_type, best_practices = p.get("url"), p.get("page_type"), p.get("best_practices")
        if not isinstance(url, str) or not isinstance(page_type, str) or not _is_string_list(best_practices):
            continue
        page = {"url": url, "page_type": page_type, "best_practices": best_practices}
        audit_status = p.get("audit_status")
        if audit_status in ("completed", "in_progress"):
            page["audit_status"] = audit_status
        for key in ("audit_result", "screenshot", "eyeshot", "clarity"):
            v = p.get(key)
            if isinstance(v, str):
                page[key] = v
        pages.append(page)

    result = {
        "company_name": company_name,
        "vertical": vertical,
        "pages": pages,
        "message": value.get("message") if isinstance(value.get("message"), str) else "",
    }
    if competitors:
        result["competitors"] = competitors
    guestimate = value.get("guestimate")
    if isinstance(guestimate, str):
        result["guestimate"] = guestimate
    return result


def sanitize_audit_for_run_storage(audit: dict) -> dict:
    sanitized = {
        "company_name": audit.get("company_name", ""),
        "vertical": audit.get("vertical", ""),
        "pages": [
            {
                "url": p.get("url", ""),
                "page_type": p.get("page_type", ""),
                "best_practices": p.get("best_practices", []),
            }
            for p in audit.get("pages", [])
        ],
        "message": audit.get("message", ""),
    }
    competitors = audit.get("competitors") or []
    if competitors:
        sanitized["competitors"] = competitors
    return sanitized


def save_audit_run(audit: dict, run_id: str | None = None) -> str:
    client = get_firestore_client()
    sanitized = sanitize_audit_for_run_storage(audit)
    now = gcf.SERVER_TIMESTAMP
    run_doc = {"audit": sanitized, "source": "run-audit-button", "updatedAt": now}
    collection = client.collection(RUNS_COLLECTION)
    if run_id:
        collection.document(run_id).set(run_doc, merge=True)
        return run_id
    write_doc = {**run_doc, "createdAt": now}
    _, doc_ref = collection.add(write_doc)
    return doc_ref.id


def _to_audit_run_summary(doc_id: str, data: dict | None) -> dict | None:
    if not data:
        return None
    audit = data.get("audit") or {}
    company_name = (audit.get("company_name") or "").strip()
    if not company_name:
        return None
    created_at = data.get("createdAt")
    updated_at = data.get("updatedAt") or created_at
    epoch = datetime(1970, 1, 1, tzinfo=timezone.utc)
    created_iso = created_at.isoformat() if created_at else epoch.isoformat()
    updated_iso = updated_at.isoformat() if updated_at else created_iso
    return {
        "id": doc_id,
        "companyName": company_name,
        "createdAtIso": created_iso,
        "updatedAtIso": updated_iso,
    }


def list_audit_runs(limit: int = 10, start_after_iso: str | None = None) -> dict:
    client = get_firestore_client()
    query = client.collection(RUNS_COLLECTION).order_by("updatedAt", direction=gcf.Query.DESCENDING)
    if start_after_iso:
        query = query.start_after({"updatedAt": datetime.fromisoformat(start_after_iso)})
    docs = list(query.limit(limit + 1).stream())
    all_summaries = [s for s in (_to_audit_run_summary(d.id, d.to_dict()) for d in docs) if s is not None]
    has_more = len(all_summaries) > limit
    runs = all_summaries[:limit] if has_more else all_summaries
    next_cursor = runs[-1]["updatedAtIso"] if has_more and runs else None
    return {"runs": runs, "hasMore": has_more, "nextCursor": next_cursor}


def _parse_task_artifact(data: dict | None) -> dict:
    if not data:
        return {}
    status = data.get("status")
    result = data.get("result") if isinstance(data.get("result"), str) else None
    screenshot = data.get("screenshot") if isinstance(data.get("screenshot"), str) else None
    audit_status = None
    if result and result.strip():
        audit_status = "completed"
    elif status in ("completed", "in_progress"):
        audit_status = status
    artifact = {}
    if audit_status:
        artifact["audit_status"] = audit_status
    if result:
        artifact["audit_result"] = result
    if screenshot:
        artifact["screenshot"] = screenshot
    return artifact


def _get_page_task_artifacts(run_id: str, page_count: int) -> dict[int, dict]:
    if not run_id.strip() or page_count <= 0:
        return {}
    collection = get_firestore_client().collection(AUDITS_COLLECTION)
    refs = [collection.document(task_id_for_page(run_id, i)) for i in range(page_count)]
    redo_refs = [collection.document(task_id_for_redo_page(run_id, i)) for i in range(page_count)]
    snapshots = _get_many(refs)
    redo_snapshots = _get_many(redo_refs)
    artifacts: dict[int, dict] = {}
    for i, snapshot in enumerate(snapshots):
        if snapshot.exists:
            artifact = _parse_task_artifact(snapshot.to_dict())
            if artifact:
                artifacts[i] = artifact
    for i, snapshot in enumerate(redo_snapshots):
        if not snapshot.exists:
            continue
        data = snapshot.to_dict() or {}
        redo_screenshot = data.get("screenshot")
        if isinstance(redo_screenshot, str) and redo_screenshot.strip():
            artifacts.setdefault(i, {})["redo_screenshot"] = redo_screenshot
    return artifacts


def _parse_eyequant_artifact(data: dict | None) -> dict:
    if not data:
        return {}
    artifact = {}
    if isinstance(data.get("eyeshot"), str):
        artifact["eyeshot"] = data["eyeshot"]
    if isinstance(data.get("clarity"), str):
        artifact["clarity"] = data["clarity"]
    return artifact


def _get_page_eyequant_artifacts(run_id: str, page_count: int) -> dict[int, dict]:
    if not run_id.strip() or page_count <= 0:
        return {}
    collection = get_firestore_client().collection(EYEQUANT_COLLECTION)
    refs = [collection.document(task_id_for_page(run_id, i)) for i in range(page_count)]
    snapshots = _get_many(refs)
    artifacts: dict[int, dict] = {}
    for i, snapshot in enumerate(snapshots):
        if snapshot.exists:
            artifact = _parse_eyequant_artifact(snapshot.to_dict())
            if artifact:
                artifacts[i] = artifact
    return artifacts


def get_competitor_artifacts(run_id: str, page_count: int, competitor_count: int) -> list[list[dict]]:
    if not run_id.strip() or page_count <= 0 or competitor_count <= 0:
        return []
    collection = get_firestore_client().collection(AUDITS_COLLECTION)
    flat_refs = [
        collection.document(task_id_for_competitor(run_id, pi, ci))
        for pi in range(page_count)
        for ci in range(competitor_count)
    ]
    flat_snapshots = _get_many(flat_refs)
    result: list[list[dict]] = []
    idx = 0
    for _ in range(page_count):
        row = []
        for _ in range(competitor_count):
            snapshot = flat_snapshots[idx]
            idx += 1
            if not snapshot.exists:
                row.append({"exists": False})
                continue
            data = snapshot.to_dict() or {}
            screenshot = data.get("screenshot") if isinstance(data.get("screenshot"), str) else None
            result_text = data.get("result")
            result_text = result_text.strip() if isinstance(result_text, str) and result_text.strip() else None
            artifact = {"exists": True}
            if screenshot:
                artifact["screenshot"] = screenshot
            if result_text:
                artifact["result"] = result_text
            row.append(artifact)
        result.append(row)
    return result


def _with_page_artifacts(audit: dict, artifacts: dict[int, dict]) -> dict:
    if not artifacts:
        return audit
    pages = list(audit["pages"])
    for i, artifact in artifacts.items():
        if 0 <= i < len(pages):
            pages[i] = {**pages[i], **artifact}
    return {**audit, "pages": pages}


def get_audit_run(run_id: str) -> dict | None:
    client = get_firestore_client()
    snapshot = client.collection(RUNS_COLLECTION).document(run_id).get()
    if not snapshot.exists:
        return None
    data = snapshot.to_dict() or {}
    audit = parse_ui_audit_response(data.get("audit"))
    if audit is None:
        return None
    task_artifacts = _get_page_task_artifacts(run_id, len(audit["pages"]))
    eyequant_artifacts = _get_page_eyequant_artifacts(run_id, len(audit["pages"]))
    audit = _with_page_artifacts(audit, task_artifacts)
    audit = _with_page_artifacts(audit, eyequant_artifacts)
    return audit


def delete_audit_run_documents(run_id: str) -> None:
    client = get_firestore_client()
    client.collection(RUNS_COLLECTION).document(run_id).delete()
    client.collection(ROI_COLLECTION).document(run_id).delete()


def _parse_roi_document_content(value) -> str | None:
    if isinstance(value, str):
        return value.strip() or None
    if not isinstance(value, dict):
        return None
    for key in ("content", "text", "guestimate", "roi", "value"):
        v = value.get(key)
        if isinstance(v, str) and v.strip():
            return v.strip()
    as_json = json.dumps(value, indent=2)
    return as_json.strip() or None


def get_roi_document_content(run_id: str) -> str | None:
    snapshot = get_firestore_client().collection(ROI_COLLECTION).document(run_id).get()
    if not snapshot.exists:
        return None
    return _parse_roi_document_content(snapshot.to_dict())


def has_roi_document(run_id: str) -> bool:
    return get_firestore_client().collection(ROI_COLLECTION).document(run_id).get().exists


def save_roi_document_content(run_id: str, content: str) -> None:
    get_firestore_client().collection(ROI_COLLECTION).document(run_id).set(
        {"content": content, "updatedAt": gcf.SERVER_TIMESTAMP}, merge=True
    )


def _parse_slide_report(data: dict | None) -> dict | None:
    if not isinstance(data, dict):
        return None

    findings = None
    if isinstance(data.get("findings"), list):
        findings = []
        for f in data["findings"]:
            if not isinstance(f, dict):
                continue
            if not isinstance(f.get("problem_discovered"), str) or not isinstance(f.get("description_of_problem"), str):
                continue
            findings.append({
                "category": f.get("category") if isinstance(f.get("category"), str) else None,
                "problem_discovered": f["problem_discovered"],
                "description_of_problem": f["description_of_problem"],
                "status": f.get("status") if isinstance(f.get("status"), str) else None,
                "reasoning": f.get("reasoning") if isinstance(f.get("reasoning"), str) else None,
                "score": f.get("score") if isinstance(f.get("score"), (int, float)) else 0,
            })

    recommendations = None
    if isinstance(data.get("recommendations"), list):
        recommendations = []
        for r in data["recommendations"]:
            if not isinstance(r, dict):
                continue
            recommendations.append({
                "recommendation": r.get("recommendation") if isinstance(r.get("recommendation"), str) else None,
                "priority": r.get("priority") if isinstance(r.get("priority"), str) else None,
                "action": r.get("action") if isinstance(r.get("action"), str) else None,
                "impact": r.get("impact") if isinstance(r.get("impact"), str) else None,
            })

    media_metrics = None
    if isinstance(data.get("media_metrics"), dict):
        m = data["media_metrics"]
        media_metrics = {
            k: m.get(k)
            for k in (
                "media_spend", "media_traffic", "media_transactions", "revenue_per_sale", "currency",
                "current_cvr", "cvr_lift", "projected_cvr", "revenue_opp", "annual_cost", "roi_percentage",
            )
        }

    return {
        "final_score": data.get("final_score") if isinstance(data.get("final_score"), (int, float)) else None,
        "url": data.get("url") if isinstance(data.get("url"), str) else None,
        "vertical": data.get("vertical") if isinstance(data.get("vertical"), str) else None,
        "clientName": data.get("clientName") if isinstance(data.get("clientName"), str) else None,
        "status": data.get("status") if isinstance(data.get("status"), str) else None,
        "executive_summary": data.get("executive_summary") if isinstance(data.get("executive_summary"), str) else None,
        "media_metrics": media_metrics,
        "findings": findings,
        "recommendations": recommendations,
    }


def get_page_reports(run_id: str, page_count: int) -> list[dict | None]:
    if not run_id.strip() or page_count <= 0:
        return []
    collection = get_firestore_client().collection(REPORTS_COLLECTION)
    refs = [collection.document(task_id_for_page(run_id, i)) for i in range(page_count)]
    snapshots = _get_many(refs)
    return [_parse_slide_report(s.to_dict()) if s.exists else None for s in snapshots]


def _parse_guestimate_metrics(data: dict | None) -> dict | None:
    if not isinstance(data, dict):
        return None
    metrics = {
        "media_spend": data.get("media_spend") if isinstance(data.get("media_spend"), (int, float)) else None,
        "media_traffic": data.get("media_traffic") if isinstance(data.get("media_traffic"), (int, float)) else None,
        "media_transactions": data.get("media_transactions") if isinstance(data.get("media_transactions"), (int, float)) else None,
        "revenue_per_sale": data.get("revenue_per_sale") if isinstance(data.get("revenue_per_sale"), (int, float)) else None,
        "currency": data.get("currency") if isinstance(data.get("currency"), str) else None,
    }
    if not any(v is not None for v in metrics.values()):
        return None
    return metrics


def get_guestimate_report(run_id: str) -> dict | None:
    if not run_id.strip():
        return None
    snapshot = get_firestore_client().collection(REPORTS_COLLECTION).document(run_id).get()
    if not snapshot.exists:
        return None
    return _parse_guestimate_metrics(snapshot.to_dict())


def shots_document_exists(run_id: str) -> bool:
    if not run_id.strip():
        return False
    return get_firestore_client().collection(SHOTS_COLLECTION).document(run_id).get().exists


def get_slides_url(run_id: str) -> str | None:
    snapshot = get_firestore_client().collection(SLIDES_COLLECTION).document(run_id).get()
    if not snapshot.exists:
        return None
    data = snapshot.to_dict() or {}
    slides_url = data.get("slides_url")
    slides_url = slides_url.strip() if isinstance(slides_url, str) else ""
    return slides_url or None


# --- Pipeline orchestration state (pipelines/{runId}) ---

def _to_pipeline_doc(run_id: str, data: dict) -> dict:
    steps = {}
    stored_steps = data.get("steps") or {}
    for step in PIPELINE_STEP_ORDER:
        record = stored_steps.get(step) or {}
        entry = {"status": record.get("status", "pending")}
        started_at = record.get("startedAt")
        if started_at is not None:
            entry["startedAt"] = started_at.isoformat() if hasattr(started_at, "isoformat") else str(started_at)
        completed_at = record.get("completedAt")
        if completed_at is not None:
            entry["completedAt"] = completed_at.isoformat() if hasattr(completed_at, "isoformat") else str(completed_at)
        if record.get("error"):
            entry["error"] = record["error"]
        steps[step] = entry
    created_at = data.get("createdAt")
    updated_at = data.get("updatedAt") or created_at
    return {
        "runId": run_id,
        "currentStepIndex": data.get("currentStepIndex", 0),
        "status": data.get("status", "running"),
        "steps": steps,
        "error": data.get("error"),
        "createdAtIso": created_at.isoformat() if created_at else None,
        "updatedAtIso": updated_at.isoformat() if updated_at else None,
    }


def get_pipeline_doc(run_id: str) -> dict | None:
    snapshot = get_firestore_client().collection(PIPELINES_COLLECTION).document(run_id).get()
    if not snapshot.exists:
        return None
    return _to_pipeline_doc(run_id, snapshot.to_dict() or {})


def create_or_reset_pipeline_doc(run_id: str) -> dict:
    client = get_firestore_client()
    now = datetime.now(timezone.utc)
    steps = {step: {"status": "pending"} for step in PIPELINE_STEP_ORDER}
    client.collection(PIPELINES_COLLECTION).document(run_id).set({
        "currentStepIndex": 0,
        "status": "running",
        "steps": steps,
        "createdAt": now,
        "updatedAt": now,
    })
    return {
        "runId": run_id,
        "currentStepIndex": 0,
        "status": "running",
        "steps": {step: {"status": "pending"} for step in PIPELINE_STEP_ORDER},
        "error": None,
        "createdAtIso": now.isoformat(),
        "updatedAtIso": now.isoformat(),
    }


@gcf.transactional
def _begin_pipeline_step_txn(transaction, doc_ref, step: str) -> bool:
    snapshot = doc_ref.get(transaction=transaction)
    if not snapshot.exists:
        return False
    data = snapshot.to_dict() or {}
    current_status = (data.get("steps") or {}).get(step, {}).get("status", "pending")
    if current_status != "pending":
        return False
    transaction.update(doc_ref, {
        f"steps.{step}.status": "running",
        f"steps.{step}.startedAt": gcf.SERVER_TIMESTAMP,
        "updatedAt": gcf.SERVER_TIMESTAMP,
    })
    return True


def begin_pipeline_step(run_id: str, step: str) -> bool:
    """Transaction-guarded pending->running flip: prevents a Cloud Tasks
    redelivery (or concurrent tick) from double-triggering the same step."""
    client = get_firestore_client()
    doc_ref = client.collection(PIPELINES_COLLECTION).document(run_id)
    return _begin_pipeline_step_txn(client.transaction(), doc_ref, step)


def mark_pipeline_step_completed(run_id: str, step: str) -> None:
    get_firestore_client().collection(PIPELINES_COLLECTION).document(run_id).update({
        f"steps.{step}.status": "completed",
        f"steps.{step}.completedAt": gcf.SERVER_TIMESTAMP,
        "updatedAt": gcf.SERVER_TIMESTAMP,
    })


def mark_pipeline_steps_skipped(run_id: str, steps: list[str]) -> None:
    if not steps:
        return
    update: dict = {"updatedAt": gcf.SERVER_TIMESTAMP}
    for step in steps:
        update[f"steps.{step}.status"] = "skipped"
        update[f"steps.{step}.completedAt"] = gcf.SERVER_TIMESTAMP
    get_firestore_client().collection(PIPELINES_COLLECTION).document(run_id).update(update)


def advance_pipeline_to_step(run_id: str, next_index: int) -> None:
    get_firestore_client().collection(PIPELINES_COLLECTION).document(run_id).update({
        "currentStepIndex": next_index,
        "updatedAt": gcf.SERVER_TIMESTAMP,
    })


def mark_pipeline_failed(run_id: str, step: str, error_message: str) -> None:
    get_firestore_client().collection(PIPELINES_COLLECTION).document(run_id).update({
        "status": "failed",
        "error": error_message,
        f"steps.{step}.status": "failed",
        f"steps.{step}.error": error_message,
        f"steps.{step}.completedAt": gcf.SERVER_TIMESTAMP,
        "updatedAt": gcf.SERVER_TIMESTAMP,
    })


def mark_pipeline_completed(run_id: str) -> None:
    get_firestore_client().collection(PIPELINES_COLLECTION).document(run_id).update({
        "status": "completed",
        "updatedAt": gcf.SERVER_TIMESTAMP,
    })
