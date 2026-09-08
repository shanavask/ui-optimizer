"""Cloud Tasks enqueue client. Port of frontend/src/lib/cloud-tasks.ts."""

import json
import os
import threading
from datetime import datetime, timedelta, timezone
from urllib.parse import urlparse

from google.cloud import tasks_v2
from google.protobuf import timestamp_pb2

_client: tasks_v2.CloudTasksClient | None = None


def _get_client() -> tasks_v2.CloudTasksClient:
    global _client
    if _client is None:
        _client = tasks_v2.CloudTasksClient()
    return _client


def _is_dev_mode() -> bool:
    # No real Cloud Tasks queue is provisioned for local dev (`make dev`
    # never sets PIPELINE_TASKS_QUEUE), so fall back to an in-process timer
    # that calls the tick logic directly. Lost on process restart, which is
    # fine for local dev only - every real deployment sets this env var.
    return not os.getenv("PIPELINE_TASKS_QUEUE", "").strip()


def enqueue_pipeline_tick(run_id: str, delay_seconds: float) -> None:
    if _is_dev_mode():
        def _run_dev_tick() -> None:
            from pipeline import run_pipeline_tick

            try:
                run_pipeline_tick(run_id)
            except Exception as err:  # noqa: BLE001 - log and drop, matches dev-only fallback
                print(f"[pipeline-dev-tick] failed for {run_id}: {err}")

        timer = threading.Timer(max(0.0, delay_seconds), _run_dev_tick)
        timer.daemon = True
        timer.start()
        return

    project = os.getenv("GOOGLE_CLOUD_PROJECT", "").strip()
    location = os.getenv("GOOGLE_CLOUD_LOCATION", "").strip()
    queue = os.getenv("PIPELINE_TASKS_QUEUE", "").strip()
    target_url = os.getenv("PIPELINE_TICK_URL", "").strip()
    service_account_email = os.getenv("PIPELINE_TASKS_SA_EMAIL", "").strip()
    if not all([project, location, queue, target_url, service_account_email]):
        raise RuntimeError(
            "Missing one of GOOGLE_CLOUD_PROJECT, GOOGLE_CLOUD_LOCATION, "
            "PIPELINE_TASKS_QUEUE, PIPELINE_TICK_URL, PIPELINE_TASKS_SA_EMAIL."
        )

    # Cloud Run's ID-token audience check expects the service's origin only -
    # an audience that includes the request path fails verification with
    # UNAUTHENTICATED (learned the hard way porting this from TypeScript).
    parsed = urlparse(target_url)
    audience = f"{parsed.scheme}://{parsed.netloc}"

    client = _get_client()
    parent = client.queue_path(project, location, queue)
    task: dict = {
        "http_request": {
            "http_method": tasks_v2.HttpMethod.POST,
            "url": target_url,
            "headers": {"Content-Type": "application/json"},
            "body": json.dumps({"runId": run_id}).encode("utf-8"),
            "oidc_token": {
                "service_account_email": service_account_email,
                "audience": audience,
            },
        }
    }
    if delay_seconds > 0:
        schedule_time = timestamp_pb2.Timestamp()
        schedule_time.FromDatetime(datetime.now(timezone.utc) + timedelta(seconds=delay_seconds))
        task["schedule_time"] = schedule_time

    client.create_task(parent=parent, task=task)
