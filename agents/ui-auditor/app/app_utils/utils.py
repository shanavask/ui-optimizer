
import os

from google.cloud import firestore, storage
from typing import Any, Optional

GOOGLE_CLOUD_PROJECT = os.getenv("GOOGLE_CLOUD_PROJECT")
GOOGLE_CLOUD_LOCATION = os.getenv("GOOGLE_CLOUD_LOCATION")
STORAGE_BUCKET = os.getenv("STORAGE_BUCKET")

    
def firestore_client() -> Optional[Any]:
    project_id = os.getenv("GOOGLE_CLOUD_PROJECT", "").strip()
    database_id = os.getenv("FIRESTORE_DATABASE_ID", "").strip()
    if not project_id:
        raise RuntimeError("GOOGLE_CLOUD_PROJECT is required for Firestore access.")
    if database_id:
        return firestore.AsyncClient(project=project_id, database=database_id)
    return firestore.AsyncClient(project=project_id)