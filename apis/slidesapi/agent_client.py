"""HTTP client for the ADK auditor agent. Port of frontend/src/lib/agent-run.ts
+ frontend/src/lib/audit-events.ts (folded in as private helpers here, since
nothing else in this service needs them).

Two wire protocols depending on environment:
- Local ADK REST: POST {base}/apps/app/users/{userId}/sessions, POST {base}/run.
- Production Vertex AI Agent Runtime: POST {base}:query / {base}:streamQuery,
  authenticated with an OAuth2 ACCESS token (not an ID token - different from
  the auth pattern used to call computer-use).
"""

import json
import os
import re
import uuid
from typing import Any

import requests
from google.auth import default as google_auth_default
from google.auth.transport.requests import Request as GoogleAuthRequest

from url_input import is_allowed_audit_url, parse_urls_from_multiline

APP_NAME = "app"
DEFAULT_AUDITOR_AGENT_BASE = "http://127.0.0.1:8001"
DEFAULT_AGENT_USERNAME = "ui-audit-user"


def auditor_agent_base_url() -> str:
    auditor_agent = os.getenv("AUDITOR_AGENT", "").strip()
    return (auditor_agent or DEFAULT_AUDITOR_AGENT_BASE).rstrip("/")


def validate_url_list(urls_text: str) -> dict:
    urls = parse_urls_from_multiline(urls_text)
    if not urls:
        return {"ok": False, "error": "Provide at least one URL"}
    rejected = [u for u in urls if not is_allowed_audit_url(u)]
    if rejected:
        return {"ok": False, "error": "Each URL must be a valid http or https URL.", "rejectedUrls": rejected}
    return {"ok": True, "urls": urls}


def _normalize_base(base: str) -> str:
    trimmed = base.strip().rstrip("/")
    if trimmed.startswith("http://") or trimmed.startswith("https://"):
        return re.sub(r":(query|streamQuery)$", "", trimmed)
    if trimmed.startswith("projects/"):
        location = os.getenv("GOOGLE_CLOUD_LOCATION", "").strip()
        if not location:
            raise RuntimeError("Missing GOOGLE_CLOUD_LOCATION for Agent Runtime endpoint.")
        return f"https://{location}-aiplatform.googleapis.com/v1/{trimmed}"
    if trimmed.isdigit():
        project = os.getenv("GOOGLE_CLOUD_PROJECT", "").strip()
        location = os.getenv("GOOGLE_CLOUD_LOCATION", "").strip()
        if not project or not location:
            raise RuntimeError("Missing GOOGLE_CLOUD_PROJECT or GOOGLE_CLOUD_LOCATION.")
        return f"https://{location}-aiplatform.googleapis.com/v1/projects/{project}/locations/{location}/reasoningEngines/{trimmed}"
    return trimmed


def _is_vertex_reasoning_engine_base(base: str) -> bool:
    return bool(re.search(r"/reasoningEngines/[^/]+$", base))


def _query_url(base: str) -> str:
    return base if base.endswith(":query") else f"{base}:query"


def _stream_query_url(base: str) -> str:
    return base if base.endswith(":streamQuery") else f"{base}:streamQuery"


def _auth_headers(base: str) -> dict[str, str]:
    if not _is_vertex_reasoning_engine_base(base):
        return {}
    credentials, _ = google_auth_default(scopes=["https://www.googleapis.com/auth/cloud-platform"])
    credentials.refresh(GoogleAuthRequest())
    if not credentials.token:
        raise RuntimeError("Unable to get Google Cloud access token for Agent Runtime.")
    return {"Authorization": f"Bearer {credentials.token}"}


def _post_json(url: str, body: Any, timeout: float, headers: dict[str, str] | None = None) -> Any:
    response = requests.post(
        url,
        json=body,
        headers={"Content-Type": "application/json", **(headers or {})},
        timeout=timeout,
    )
    if not response.ok:
        raise RuntimeError(f"Agent API {response.status_code}: {response.text}")
    raw = response.text
    if not raw.strip():
        return None
    try:
        return response.json()
    except ValueError:
        return raw


def _extract_session_id(payload: Any) -> str:
    if not isinstance(payload, dict):
        raise RuntimeError("Agent Runtime session response is not an object.")
    output = payload.get("output") if isinstance(payload.get("output"), dict) else None
    direct_id = payload.get("id") if isinstance(payload.get("id"), str) else None
    output_id = output.get("id") if output and isinstance(output.get("id"), str) else None
    session = output.get("session") if output and isinstance(output.get("session"), dict) else None
    session_id = session.get("id") if session and isinstance(session.get("id"), str) else None
    resolved = direct_id or output_id or session_id
    if not resolved:
        raise RuntimeError("Agent Runtime did not return a session id.")
    return resolved


def _parse_sse_payload(raw: str) -> Any:
    events: list[Any] = []
    has_data_prefix = False
    for line in raw.split("\n"):
        trimmed = line.strip()
        if not trimmed.startswith("data:"):
            continue
        has_data_prefix = True
        payload = trimmed[5:].strip()
        if not payload or payload == "[DONE]":
            continue
        try:
            events.append(json.loads(payload))
        except ValueError:
            events.append(payload)
    if events:
        return events
    if has_data_prefix:
        return raw

    json_objects: list[Any] = []
    text = raw.strip()
    depth = 0
    start = -1
    in_string = False
    escaping = False
    for i, char in enumerate(text):
        if escaping:
            escaping = False
            continue
        if char == "\\":
            escaping = True
            continue
        if char == '"':
            in_string = not in_string
            continue
        if in_string:
            continue
        if char == "{":
            if depth == 0:
                start = i
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0 and start >= 0:
                candidate = text[start : i + 1]
                try:
                    json_objects.append(json.loads(candidate))
                except ValueError:
                    return raw
                start = -1
            elif depth < 0:
                return raw
    if json_objects and depth == 0 and not in_string:
        return json_objects
    return raw


def _extract_events(payload: Any) -> list[Any]:
    if isinstance(payload, list):
        return payload
    if isinstance(payload, str):
        parsed = _parse_sse_payload(payload)
        if parsed != payload:
            return _extract_events(parsed)
    if not isinstance(payload, dict):
        detail = payload[:300] if isinstance(payload, str) else json.dumps(payload)
        raise RuntimeError(f"Agent Runtime response is not parseable: {detail or 'empty payload'}")
    output = payload.get("output")
    if isinstance(output, list):
        return output
    if isinstance(output, dict) and isinstance(output.get("events"), list):
        return output["events"]
    return [payload]


def _is_page_audit(value: Any) -> bool:
    if not isinstance(value, dict):
        return False
    if not isinstance(value.get("url"), str) or not isinstance(value.get("page_type"), str):
        return False
    best_practices = value.get("best_practices")
    if not isinstance(best_practices, list):
        return False
    return all(isinstance(p, str) for p in best_practices)


def _extract_competitors(value: dict) -> list[dict]:
    competitors = []
    for c in value.get("competitors") or []:
        if not isinstance(c, dict):
            continue
        name, url = c.get("competitor_name"), c.get("competitor_url")
        if isinstance(name, str) and isinstance(url, str):
            competitors.append({"competitor_name": name, "competitor_url": url})
    return competitors


def _normalize_audit_response(value: Any) -> dict | None:
    if not isinstance(value, dict) or not isinstance(value.get("vertical"), str):
        return None
    pages = value.get("pages")
    if not isinstance(pages, list) or not all(_is_page_audit(p) for p in pages):
        return None
    competitors = _extract_competitors(value)
    result = {
        "company_name": value.get("company_name") if isinstance(value.get("company_name"), str) else "",
        "vertical": value["vertical"],
        "pages": pages,
        "message": value.get("message") if isinstance(value.get("message"), str) else "",
    }
    if competitors:
        result["competitors"] = competitors
    return result


def _try_parse_audit_text(text: str) -> dict | None:
    trimmed = text.strip()
    if not trimmed:
        return None
    try:
        parsed = json.loads(trimmed)
    except ValueError:
        return None
    return _normalize_audit_response(parsed)


def _collect_text_from_event(event: Any) -> str:
    if not isinstance(event, dict) or not isinstance(event.get("content"), dict):
        return ""
    parts = event["content"].get("parts")
    if not isinstance(parts, list):
        return ""
    texts = [p["text"] for p in parts if isinstance(p, dict) and isinstance(p.get("text"), str) and p["text"]]
    return "\n".join(texts)


def _parse_text_from_agent_events(events: list[Any]) -> str | None:
    for event in reversed(events):
        combined = _collect_text_from_event(event)
        if combined.strip():
            return combined
    return None


def _parse_audit_from_agent_events(events: list[Any]) -> dict | None:
    for event in reversed(events):
        combined = _collect_text_from_event(event)
        from_combined = _try_parse_audit_text(combined)
        if from_combined:
            return from_combined
        if not isinstance(event, dict) or not isinstance(event.get("content"), dict):
            continue
        parts = event["content"].get("parts")
        if not isinstance(parts, list):
            continue
        for part in parts:
            if isinstance(part, dict) and isinstance(part.get("text"), str):
                single = _try_parse_audit_text(part["text"])
                if single:
                    return single
    return None


def _parse_audit_from_payload(payload: Any) -> dict | None:
    if isinstance(payload, str):
        try:
            return _parse_audit_from_payload(json.loads(payload))
        except ValueError:
            return None
    if isinstance(payload, dict) and isinstance(payload.get("pages"), list) and all(
        _is_page_audit(p) for p in payload["pages"]
    ):
        competitors = _extract_competitors(payload)
        result = {
            "company_name": payload.get("company_name") if isinstance(payload.get("company_name"), str) else "",
            "vertical": payload.get("vertical") if isinstance(payload.get("vertical"), str) else "",
            "pages": payload["pages"],
            "message": payload.get("message") if isinstance(payload.get("message"), str) else "",
        }
        if competitors:
            result["competitors"] = competitors
        return result
    if isinstance(payload, dict) and isinstance(payload.get("output"), dict):
        return _parse_audit_from_payload(payload["output"])
    if isinstance(payload, list):
        return _parse_audit_from_agent_events(payload)
    return None


def _parse_text_from_payload(payload: Any) -> str | None:
    if isinstance(payload, str) and payload.strip():
        return payload.strip()
    if isinstance(payload, dict):
        if isinstance(payload.get("message"), str) and payload["message"].strip():
            return payload["message"].strip()
        if isinstance(payload.get("output"), str) and payload["output"].strip():
            return payload["output"].strip()
        if isinstance(payload.get("output"), dict):
            return _parse_text_from_payload(payload["output"])
    if isinstance(payload, list):
        return _parse_text_from_agent_events(payload)
    return None


def _run_request_body(user_id: str, session_id: str, prompt: str) -> dict:
    return {
        "app_name": APP_NAME,
        "user_id": user_id,
        "session_id": session_id,
        "new_message": {"role": "user", "parts": [{"text": prompt}]},
    }


def _create_agent_session(base: str, user_id: str, timeout: float) -> str:
    resolved_base = _normalize_base(base)
    if _is_vertex_reasoning_engine_base(resolved_base):
        payload = _post_json(
            _query_url(resolved_base),
            {"class_method": "async_create_session", "input": {"user_id": user_id}},
            timeout,
            _auth_headers(resolved_base),
        )
        return _extract_session_id(payload)
    session = _post_json(f"{resolved_base}/apps/{APP_NAME}/users/{user_id}/sessions", {"state": {}}, timeout)
    if not isinstance(session, dict) or not isinstance(session.get("id"), str):
        raise RuntimeError("ADK did not return a session id.")
    return session["id"]


def _run_vertex_stream_query(
    base: str, input_data: dict, timeout: float, image_base64: str | None = None
) -> Any:
    body_input = {**input_data, "image_base64": image_base64} if image_base64 else input_data
    body = {"class_method": "async_stream_query", "input": body_input}
    response = requests.post(
        _stream_query_url(base),
        json=body,
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream",
            **_auth_headers(base),
        },
        timeout=timeout,
    )
    if not response.ok:
        raise RuntimeError(f"Agent API {response.status_code}: {response.text}")
    raw = response.text
    if not raw.strip():
        return None
    try:
        return response.json()
    except ValueError:
        return _parse_sse_payload(raw)


def _build_user_prompt(urls: list[str]) -> str:
    listing = "\n".join(f"- {u}" for u in urls)
    return f"generate best practices for \n{listing}"


def _build_guestimate_prompt(urls: list[str], guestimate_context: str | None = None) -> str:
    listing = "\n".join(f"- {u}" for u in urls)
    context = guestimate_context.strip() if guestimate_context else ""
    if not context:
        return f"guestimate media metrics for:\n{listing}"
    return f"guestimate media metrics for:\n{context}"


def build_remember_prompt(vertical: str, page_type: str, best_practices: str) -> str:
    return f"Remember this:\nVertical: {vertical}\nPage Type: {page_type}\nBest Practices: {best_practices}"


def fetch_ui_audit(
    base: str, urls: list[str], username: str | None = None, timeout: float = 600
) -> tuple[dict | None, str]:
    resolved_base = _normalize_base(base)
    user_id = (username or "").strip() or str(uuid.uuid4())
    session_id = _create_agent_session(resolved_base, user_id, timeout)
    if _is_vertex_reasoning_engine_base(resolved_base):
        payload = _run_vertex_stream_query(
            resolved_base,
            {"user_id": user_id, "session_id": session_id, "message": _build_user_prompt(urls)},
            timeout,
        )
        parsed = _parse_audit_from_payload(payload)
        if parsed:
            return parsed, session_id
        return _parse_audit_from_agent_events(_extract_events(payload)), session_id
    body = _run_request_body(user_id, session_id, _build_user_prompt(urls))
    events = _post_json(f"{resolved_base}/run", body, timeout)
    return _parse_audit_from_agent_events(events or []), session_id


def send_agent_prompt(base: str, prompt: str, username: str | None = None, timeout: float = 300) -> None:
    resolved_base = _normalize_base(base)
    user_id = (username or "").strip() or str(uuid.uuid4())
    session_id = _create_agent_session(resolved_base, user_id, timeout)
    if _is_vertex_reasoning_engine_base(resolved_base):
        _run_vertex_stream_query(
            resolved_base, {"user_id": user_id, "session_id": session_id, "message": prompt}, timeout
        )
        return
    body = _run_request_body(user_id, session_id, prompt)
    _post_json(f"{resolved_base}/run", body, timeout)


def fetch_guestimate(
    base: str,
    urls: list[str],
    guestimate_context: str | None = None,
    username: str | None = None,
    timeout: float = 300,
) -> str | None:
    resolved_base = _normalize_base(base)
    user_id = (username or "").strip() or str(uuid.uuid4())
    session_id = _create_agent_session(resolved_base, user_id, timeout)
    return fetch_guestimate_in_session(base, urls, session_id, guestimate_context, username, timeout)


def fetch_guestimate_in_session(
    base: str,
    urls: list[str],
    session_id: str,
    guestimate_context: str | None = None,
    username: str | None = None,
    timeout: float = 300,
) -> str | None:
    resolved_base = _normalize_base(base)
    user_id = (username or "").strip() or str(uuid.uuid4())
    prompt = _build_guestimate_prompt(urls, guestimate_context)
    if _is_vertex_reasoning_engine_base(resolved_base):
        payload = _run_vertex_stream_query(
            resolved_base, {"user_id": user_id, "session_id": session_id, "message": prompt}, timeout
        )
        return _parse_text_from_payload(payload)
    body = _run_request_body(user_id, session_id, prompt)
    events = _post_json(f"{resolved_base}/run", body, timeout)
    text = _parse_text_from_agent_events(events or [])
    return text.strip() if text and text.strip() else None


def send_prompt_in_session(
    base: str, session_id: str, prompt: str, username: str | None = None, timeout: float = 300
) -> None:
    resolved_base = _normalize_base(base)
    user_id = (username or "").strip() or str(uuid.uuid4())
    if _is_vertex_reasoning_engine_base(resolved_base):
        _run_vertex_stream_query(
            resolved_base, {"user_id": user_id, "session_id": session_id, "message": prompt}, timeout
        )
        return
    body = _run_request_body(user_id, session_id, prompt)
    _post_json(f"{resolved_base}/run", body, timeout)


def send_prompt_in_session_with_image(
    base: str,
    session_id: str,
    prompt: str,
    image_base64: str,
    username: str | None = None,
    timeout: float = 600,
) -> None:
    resolved_base = _normalize_base(base)
    user_id = (username or "").strip() or str(uuid.uuid4())
    if _is_vertex_reasoning_engine_base(resolved_base):
        _run_vertex_stream_query(
            resolved_base,
            {"user_id": user_id, "session_id": session_id, "message": prompt},
            timeout,
            image_base64,
        )
        return
    body = {
        "app_name": APP_NAME,
        "user_id": user_id,
        "session_id": session_id,
        "new_message": {
            "role": "user",
            "parts": [
                {"text": prompt},
                {"inline_data": {"mime_type": "image/png", "data": image_base64}},
            ],
        },
    }
    _post_json(f"{resolved_base}/run", body, timeout)


def fetch_remember_this(
    base: str,
    vertical: str,
    page_type: str,
    best_practices: str,
    username: str | None = None,
    session_id: str | None = None,
    timeout: float = 90,
) -> None:
    prompt = build_remember_prompt(vertical, page_type, best_practices)
    if not session_id:
        send_agent_prompt(base, prompt, username, timeout)
        return
    resolved_base = _normalize_base(base)
    user_id = (username or "").strip() or str(uuid.uuid4())
    if _is_vertex_reasoning_engine_base(resolved_base):
        _run_vertex_stream_query(
            resolved_base, {"user_id": user_id, "session_id": session_id, "message": prompt}, timeout
        )
        return
    body = _run_request_body(user_id, session_id, prompt)
    _post_json(f"{resolved_base}/run", body, timeout)
