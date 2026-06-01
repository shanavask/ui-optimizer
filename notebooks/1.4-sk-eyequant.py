# %%
from __future__ import annotations

import argparse
import base64
import json
import os
import time
from pathlib import Path
from typing import Any
from PIL import Image
from io import BytesIO

import requests
from dotenv import load_dotenv

project_id = os.getenv("GOOGLE_CLOUD_PROJECT", "").strip()
database_id = os.getenv("FIRESTORE_DATABASE_ID", "").strip()


EYEQUANT_API_BASE_URL = "https://api.eyequant.com/v2"
ANALYSIS_ENDPOINT = f"{EYEQUANT_API_BASE_URL}/analyses"
DEFAULT_MEDIUM = "desktopWeb"
POLL_INTERVAL_SECONDS = 3
TIMEOUT_SECONDS = 120


def load_api_key() -> str:
    env_path = Path(__file__).resolve().parents[1] / ".env"
    load_dotenv(dotenv_path=env_path)
    api_key = os.getenv("EYEQUANT_API_KEY")
    if not api_key:
        raise ValueError("Missing EYEQUANT_API_KEY in environment or .env file.")
    return api_key


def read_image_as_base64(image_path: Path) -> str:
    if not image_path.exists():
        raise FileNotFoundError(f"Image not found: {image_path}")
    return base64.b64encode(image_path.read_bytes()).decode("utf-8")


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


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run EyeQuant analysis on an image.")
    parser.add_argument("image_path", type=Path, help="Path to a PNG or JPEG image.")
    parser.add_argument(
        "--title", default="EyeQuant image analysis", help="Title for the analysis."
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    api_key = load_api_key()
    image_b64 = read_image_as_base64(args.image_path)
    analysis_id = create_image_analysis(api_key, image_b64, args.title)
    print(f"Created EyeQuant image analysis: {analysis_id}")

    result = wait_for_analysis(api_key, analysis_id)
    outputs = result.get("outputs", {})
    output_urls = flatten_output_urls(outputs)

    print(f"Status: {result.get('status')}")
    if output_urls:
        print("Output URLs:")
        for url in output_urls:
            print(f"- {url}")
    else:
        print("No output URLs found in response.")

    print("Raw outputs:")
    print(json.dumps(outputs, indent=2))

# %%
api_key = load_api_key()
# %%
from google.cloud import firestore

client = firestore.Client(project=project_id, database=database_id)
run_id = 'CAOrJtbcq9gewMC80SoX'
# %%
run_dict = client.collection('runs').document(run_id).get().to_dict()
num_pages = len(run_dict['audit']['pages'])
# %%
task_id = f"{run_id}_page_0"

# %%
audit_doc = client.collection("audits").document(task_id).get()
audit_dict = audit_doc.to_dict()
audit_dict['screenshot']
# %%
image_b64 = audit_dict['screenshot']
analysis_id = create_image_analysis(api_key, image_b64, 'vetoquinol digital')
print(f"Created EyeQuant image analysis: {analysis_id}")

result = wait_for_analysis(api_key, analysis_id)
outputs = result.get("outputs", {})
# %%
outputs
# %%
# image_url = outputs['attention']['attentionMap']
image_url = outputs['clarity']['map']
response = requests.get(image_url)
img_over = Image.open(BytesIO(response.content))
img_bytes = base64.b64decode(image_b64)
img = Image.open(BytesIO(img_bytes))

# Ensure both images are in RGBA mode for proper alpha compositing
img = img.convert("RGBA")
img_over = img_over.convert("RGBA")

# Resize overlay to match base size if necessary
if img.size != img_over.size:
    img_over = img_over.resize(img.size, Image.ANTIALIAS)

composited_img = Image.alpha_composite(img, img_over)
composited_img
# %%
response.content
# %%

compressed_buffer = BytesIO()
composited_img.save(compressed_buffer, format="PNG", optimize=True)
compressed_bytes = compressed_buffer.getvalue()
composited_b64 = base64.b64encode(compressed_bytes).decode('utf-8')
client.collection("eyequant").document(task_id).set({"outputs": outputs, "eyeshot": composited_b64})
# %%
len(composited_b64)
# %%
img.size
# %%
composited_img.size
# %%
