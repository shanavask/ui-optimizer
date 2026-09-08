from __future__ import annotations

import base64
import json
import os
import time
from typing import Any
from PIL import Image
from io import BytesIO

import requests

EYEQUANT_API_KEY = os.getenv("EYEQUANT_API_KEY")
EYEQUANT_API_BASE_URL = "https://api.eyequant.com/v2"
ANALYSIS_ENDPOINT = f"{EYEQUANT_API_BASE_URL}/analyses"
DEFAULT_MEDIUM = "mobileWeb"
POLL_INTERVAL_SECONDS = 3
TIMEOUT_SECONDS = 120


def create_image_analysis(api_key: str, image_b64: str, title: str) -> str:
    payload = {
        "input": {
            "type": "image",
            "content": image_b64,
            "medium": DEFAULT_MEDIUM,
            "title": title,
        }
    }
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    response = requests.post(
        ANALYSIS_ENDPOINT, json=payload, headers=headers, timeout=30
    )
    response.raise_for_status()
    return response.json()["id"]


def fetch_analysis(api_key: str, analysis_id: str) -> dict[str, Any]:
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    response = requests.get(
        f"{ANALYSIS_ENDPOINT}/{analysis_id}", headers=headers, timeout=30
    )
    response.raise_for_status()
    return response.json()


def wait_for_analysis(api_key: str, analysis_id: str) -> dict[str, Any]:
    deadline = time.time() + TIMEOUT_SECONDS
    while time.time() < deadline:
        result = fetch_analysis(api_key, analysis_id)
        status = result.get("status")
        if status == "success":
            return result
        if status not in {"pending", "processing"}:
            raise RuntimeError(f"EyeQuant analysis failed with status: {status}")
        time.sleep(POLL_INTERVAL_SECONDS)
    raise TimeoutError("Timed out waiting for EyeQuant analysis to complete.")


def flatten_output_urls(data: Any) -> list[str]:
    urls: list[str] = []
    if isinstance(data, str) and data.startswith("http"):
        urls.append(data)
    elif isinstance(data, dict):
        for value in data.values():
            urls.extend(flatten_output_urls(value))
    elif isinstance(data, list):
        for item in data:
            urls.extend(flatten_output_urls(item))
    return urls

def get_eye_shot_from_url(image_url: str, image_b64: str) -> str:
    response = requests.get(image_url)
    img_over = Image.open(BytesIO(response.content)).convert("RGBA")
    img_bytes = base64.b64decode(image_b64)
    img = Image.open(BytesIO(img_bytes)).convert("RGBA")

    # Resize overlay to match base size if necessary
    if img.size != img_over.size:
        img_over = img_over.resize(img.size, Image.Resampling.LANCZOS)

    composited_img = Image.alpha_composite(img, img_over)
    compressed_buffer = BytesIO()
    composited_img.save(compressed_buffer, format="PNG", optimize=True)
    compressed_bytes = compressed_buffer.getvalue()
    composited_b64 = base64.b64encode(compressed_bytes).decode('utf-8')
    return composited_b64

def get_eye_shot(image_b64: str, title: str) -> tuple[str, str, Any]:
    analysis_id = create_image_analysis(EYEQUANT_API_KEY, image_b64, title)
    result = wait_for_analysis(EYEQUANT_API_KEY, analysis_id)
    outputs = result.get("outputs", {})

    image_url = outputs.get('attention', {}).get('attentionMap', '')
    attention_b64 = get_eye_shot_from_url(image_url, image_b64) if image_url else None

    image_url = outputs.get('clarity', {}).get('map', '')
    clarity_b64 = get_eye_shot_from_url(image_url, image_b64) if image_url else None

    return attention_b64, clarity_b64, outputs