"""Dispatches fire-and-forget tasks to the computer-use Cloud Run service.
Port of frontend/src/lib/browseruse.ts."""

import os
from concurrent.futures import ThreadPoolExecutor

import requests
from google.auth.transport.requests import Request as GoogleAuthRequest
from google.oauth2 import id_token as google_id_token

from firestore_store import AUDITS_COLLECTION, get_firestore_client
from task_ids import task_id_for_competitor, task_id_for_page, task_id_for_redo_page


def browser_use_base_url() -> str:
    configured = os.getenv("COMPUTER_API", "").strip()
    base_url = configured or "http://localhost:5401"
    return base_url.rstrip("/")


def _is_local_browser_use_url(base_url: str) -> bool:
    return base_url.startswith("http://localhost:")


def _browser_use_auth_headers(base_url: str) -> dict[str, str]:
    if _is_local_browser_use_url(base_url):
        return {}
    configured_token = os.getenv("ID_TOKEN", "").strip()
    if configured_token:
        return {"Authorization": f"Bearer {configured_token}"}
    token = google_id_token.fetch_id_token(GoogleAuthRequest(), base_url)
    return {"Authorization": f"Bearer {token}"}


def _normalize_url(url: str) -> str:
    trimmed = url.strip()
    if trimmed.startswith("http://") or trimmed.startswith("https://"):
        return trimmed
    return f"https://{trimmed}"


def _format_best_practices(best_practices: list[str]) -> str:
    filtered = [item.strip() for item in best_practices if item.strip()]
    if not filtered:
        return "No best practices provided."
    return "\n".join(f"{i + 1}. {item}" for i, item in enumerate(filtered))


def _build_browser_use_task(page_url: str, best_practices: str) -> str:
    return f"""**Role:** You are a Senior UX Auditor. You produce two things: (1) a complete diagnostic rating of every provided best practice, and (2) a prioritized shortlist of exactly **7 problems** where the user experience is less than "Excellent."

**Device Context:** You are operating an **iPhone browser** (mobile Safari on a small-screen device). All evaluations must be based on the **mobile experience** — assess touch targets, font sizes, layout reflow, scrollability, and mobile-specific interactions as seen on a phone screen.

**Important:** The browser is already open and the page at {page_url} is loaded. Do not navigate away from this page, open new tabs, or visit any other URL.

**Objective:** Use the provided best practices as a diagnostic lens. First rate *all* of them. Then surface the 7 most important friction points.

**Evaluation Criteria:**
{best_practices}

**Operational Protocol:**
1.  **Full Diagnostic Rating:** Evaluate **every** provided best practice and rate its implementation as **Poor**, **Good**, or **Excellent**. Rate all of them — do not skip any, including those rated Excellent.
2.  **Problem Pool:** Any best practice rated **Poor** or **Good** is a candidate "Problem."
3.  **Problem Selection (exactly 7):**
    * Select the 7 problems primarily from the candidate pool. Prioritize **Poor** ratings over **Good**, and the most critical/high-impact issues first.
    * If the candidate pool yields **fewer than 7** problems, supplement with general UX heuristic issues **not covered** by the provided best practices until exactly 7 are reached.
    * If the candidate pool yields **more than 7**, select the 7 highest-impact issues (Poor before Good) and leave the rest in the diagnostic rating only.
4.  **Efficiency:** Use a visual-first approach. Batch interactions (scrolls/clicks) only when necessary to confirm a rating.

**Output Requirements:**

**Section 1 — Best Practice Ratings**
For each provided best practice, one line: the best practice name — **Rating** (Poor / Good / Excellent) — a brief (one-sentence) observation justifying the rating.

**Section 2 — Top 7 Problems**
Exactly 7 problems, in priority order. For each:
1.  **[Problem Name/Headline]**
    * **Rating:** (Poor or Good)
    * **Reference:** (The specific Best Practice used, or "General Heuristic" if found during supplemental analysis)
    * **Observation:** A concise description of the implementation flaw discovered.
    * **Recommendation:** A brief, actionable fix to elevate the implementation to "Excellent."

**Constraints:** No introductory text and no summary "Part" headers beyond the two required sections. Section 1 must be a compact one-line-per-item list. Reserve detailed explanations for Section 2."""


def _build_competitor_task(competitor_name: str, competitor_url: str, page_type: str) -> str:
    return (
        f"Open the website for {competitor_name} using the url {competitor_url}. "
        f"Navigate to the {page_type}. "
        f"Wait for the page to load, close any popups or messages and take a screenshot."
    )


def _submit_browser_use_task(base_url: str, initial_url: str, task: str, task_id: str | None) -> None:
    headers = _browser_use_auth_headers(base_url)
    body: dict = {"task": task, "initial_url": initial_url}
    if task_id:
        body["task_id"] = task_id
    response = requests.post(f"{base_url}/run", json=body, headers=headers, timeout=30)
    if not response.ok:
        raise RuntimeError(f"BrowserUse API {response.status_code}: {response.text}")


def _read_existing_task_states(run_id: str, page_count: int) -> dict[int, dict]:
    if page_count <= 0:
        return {}
    collection = get_firestore_client().collection(AUDITS_COLLECTION)
    refs = [collection.document(task_id_for_page(run_id, i)) for i in range(page_count)]
    with ThreadPoolExecutor(max_workers=min(16, len(refs))) as executor:
        snapshots = list(executor.map(lambda ref: ref.get(), refs))
    states: dict[int, dict] = {}
    for i, snapshot in enumerate(snapshots):
        data = snapshot.to_dict() or {}
        result = data.get("result")
        if isinstance(result, str) and result.strip():
            states[i] = {"audit_status": "completed", "audit_result": result}
    return states


def _with_page_task_state(audit: dict, states: dict[int, dict]) -> dict:
    pages = []
    for i, page in enumerate(audit["pages"]):
        state = states.get(i)
        if not state:
            pages.append(page)
            continue
        new_page = {**page, "audit_status": state["audit_status"]}
        if state.get("audit_result"):
            new_page["audit_result"] = state["audit_result"]
        pages.append(new_page)
    return {**audit, "pages": pages}


def dispatch_browser_use_tasks(audit: dict, run_id: str | None = None) -> dict:
    base_url = browser_use_base_url()
    states = _read_existing_task_states(run_id, len(audit["pages"])) if run_id else {}

    def _dispatch_one(item: tuple[int, dict]) -> tuple[int, Exception | None]:
        page_index, page = item
        if page_index in states:
            return page_index, None
        page_url = _normalize_url(page["url"])
        task = _build_browser_use_task(page_url, _format_best_practices(page.get("best_practices", [])))
        if run_id:
            states[page_index] = {"audit_status": "in_progress"}
        task_id = task_id_for_page(run_id, page_index) if run_id else None
        try:
            _submit_browser_use_task(base_url, page_url, task, task_id)
            return page_index, None
        except Exception as err:  # noqa: BLE001 - collected below, not swallowed
            return page_index, err

    pages = list(enumerate(audit["pages"]))
    if pages:
        with ThreadPoolExecutor(max_workers=min(16, len(pages))) as executor:
            results = list(executor.map(_dispatch_one, pages))
        for page_index, err in results:
            if err is not None:
                print(f"BrowserUse task submission failed for page {page_index}: {err}")

    return _with_page_task_state(audit, states)


def dispatch_competitor_tasks(audit: dict, run_id: str) -> dict:
    base_url = browser_use_base_url()
    dispatched: list[str] = []
    skipped: list[str] = []
    errors: list[str] = []

    tasks = [
        (page_index, page, competitor_index, competitor)
        for page_index, page in enumerate(audit["pages"])
        for competitor_index, competitor in enumerate(audit.get("competitors") or [])
    ]

    def _dispatch_one(item) -> tuple[str, str]:
        page_index, page, competitor_index, competitor = item
        raw_url = competitor.get("competitor_url")
        competitor_url = _normalize_url(raw_url) if raw_url and raw_url.strip() else None
        if not competitor_url:
            return "skipped", f"page {page_index} / competitor {competitor_index}: no URL"
        task = _build_competitor_task(competitor["competitor_name"], competitor_url, page["page_type"])
        task_id = task_id_for_competitor(run_id, page_index, competitor_index)
        try:
            _submit_browser_use_task(base_url, competitor_url, task, task_id)
            return "dispatched", task_id
        except Exception as err:  # noqa: BLE001 - collected below
            return "error", f"{task_id}: {err}"

    if tasks:
        with ThreadPoolExecutor(max_workers=min(16, len(tasks))) as executor:
            for kind, value in executor.map(_dispatch_one, tasks):
                if kind == "dispatched":
                    dispatched.append(value)
                elif kind == "skipped":
                    skipped.append(value)
                else:
                    errors.append(value)

    return {"dispatched": dispatched, "skipped": skipped, "errors": errors}


def dispatch_redo_screenshot_task(page_url: str, run_id: str, page_index: int) -> None:
    base_url = browser_use_base_url()
    normalized_url = _normalize_url(page_url)
    task = (
        f"open the url {normalized_url} and wait for the page to load, "
        f"close any popups or messages and take a screenshot."
    )
    task_id = task_id_for_redo_page(run_id, page_index)
    _submit_browser_use_task(base_url, normalized_url, task, task_id)
