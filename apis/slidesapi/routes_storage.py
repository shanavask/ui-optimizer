from fastapi import APIRouter, HTTPException, Query, Response
from google.cloud import storage

router = APIRouter()


@router.get("/storage/image")
def get_storage_image(path: str = Query(...)) -> Response:
    if not path.startswith("gs://"):
        raise HTTPException(status_code=400, detail={"error": "Invalid path"})
    without_scheme = path[len("gs://") :]
    if "/" not in without_scheme:
        raise HTTPException(status_code=400, detail={"error": "Invalid GCS path"})
    bucket_name, blob_path = without_scheme.split("/", 1)
    try:
        image_bytes = storage.Client().bucket(bucket_name).blob(blob_path).download_as_bytes()
    except Exception:
        raise HTTPException(status_code=404, detail={"error": "Object not found"})
    return Response(
        content=image_bytes, media_type="image/png", headers={"Cache-Control": "private, max-age=3600"}
    )
