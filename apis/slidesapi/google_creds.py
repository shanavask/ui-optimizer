"""Service account credential loading for the Drive/Slides/Sheets APIs."""

import json
import logging
import os

from google.cloud.secretmanager import SecretManagerServiceClient
from google.oauth2.service_account import Credentials

logger = logging.getLogger(__name__)


def get_creds() -> Credentials:
    """Get service account credentials from Secret Manager."""

    project_id = os.getenv("GOOGLE_CLOUD_PROJECT", "").strip()
    secret_name = os.getenv("SERVICE_SECRET", "").strip()
    if not project_id:
        raise RuntimeError("GOOGLE_CLOUD_PROJECT is required to load Slides API credentials.")
    if not secret_name:
        raise RuntimeError("SERVICE_SECRET is required to load Slides API credentials.")

    try:
        client = SecretManagerServiceClient()
        name = f"projects/{project_id}/secrets/{secret_name}/versions/latest"
        response = client.access_secret_version(name=name)
        creds_json = json.loads(response.payload.data.decode('UTF-8'))
    except Exception:
        logger.exception(f"Failed to load service account credentials from secret '{secret_name}'")
        raise

    scopes = [
        'https://www.googleapis.com/auth/spreadsheets',
        'https://www.googleapis.com/auth/presentations',
        'https://www.googleapis.com/auth/drive'
    ]
    return Credentials.from_service_account_info(creds_json, scopes=scopes)
