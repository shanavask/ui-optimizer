"""EyeQuant attention/clarity heatmap generation for a run's page screenshots."""

import base64
import logging
import os

from google.cloud import storage

from eyequant import get_eye_shot as run_eyequant_analysis
from firestore_store import get_firestore_client

STORAGE_BUCKET = os.getenv("STORAGE_BUCKET")

logger = logging.getLogger(__name__)


def generate_eye_shot_for_run(run_id: str, page_id: int | None = None) -> str:
    """Generate EyeQuant outputs for a run's pages.

    If page_id is provided, only that page is processed; otherwise all pages are processed.
    """
    client = get_firestore_client()
    run_doc = client.collection("runs").document(run_id).get().to_dict()
    if run_doc is None:
        logger.error(f"Run {run_id} not found in Firestore")
        raise ValueError(f"Run {run_id} not found")
    company_name = run_doc['audit']['company_name']
    num_pages = len(run_doc['audit']['pages'])
    page_ids = [page_id] if page_id is not None else range(num_pages)
    storage_client = storage.Client()
    bucket = storage_client.bucket(STORAGE_BUCKET)
    for pid in page_ids:
        task_id = f"{run_id}_page_{pid}"
        try:
            audit_doc = client.collection("audits").document(f"{task_id}_redo").get()
            if not audit_doc.exists:
                audit_doc = client.collection("audits").document(task_id).get()
            audit_dict = audit_doc.to_dict()
            raw_screenshot = audit_dict['screenshot']
            if raw_screenshot.startswith("gs://"):
                without_scheme = raw_screenshot[len("gs://"):]
                bucket_name, blob_path = without_scheme.split("/", 1)
                image_bytes = storage_client.bucket(bucket_name).blob(blob_path).download_as_bytes()
                image_b64 = base64.b64encode(image_bytes).decode("utf-8")
            else:
                image_b64 = raw_screenshot
            attention_b64, clarity_b64, outputs = run_eyequant_analysis(image_b64, company_name)
            eyeshot_path = f"eyequant/{company_name}_{task_id}_eyeshot.png"
            clarity_path = f"eyequant/{company_name}_{task_id}_clarity.png"
            bucket.blob(eyeshot_path).upload_from_string(base64.b64decode(attention_b64), content_type="image/png")
            bucket.blob(clarity_path).upload_from_string(base64.b64decode(clarity_b64), content_type="image/png")
            doc = {
                "outputs": outputs,
                "eyeshot": f"gs://{STORAGE_BUCKET}/{eyeshot_path}",
                "clarity": f"gs://{STORAGE_BUCKET}/{clarity_path}",
            }
            client.collection("eyequant").document(task_id).set(doc)
        except Exception:
            logger.exception(f"Error generating eye shot for task {task_id}")
            raise
    return "success"
