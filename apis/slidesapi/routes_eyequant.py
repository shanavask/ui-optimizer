from fastapi import APIRouter, HTTPException

from eyequant_runner import generate_eye_shot_for_run

router = APIRouter()


@router.get("/eyequant", response_model=str)
def get_eyequant(run_id: str, page_id: int | None = None) -> str:
    """Generate the EyeQuant attention/clarity shots for a run.

    If page_id is provided, only that page is processed; otherwise all pages are processed.
    """
    try:
        return generate_eye_shot_for_run(run_id, page_id)
    except ValueError as err:
        raise HTTPException(status_code=404, detail={"error": str(err)})
