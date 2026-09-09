from fastapi import APIRouter

from slides_builder import create_slides

router = APIRouter()


@router.post("/create_slides", response_model=str)
def post_create_slides(task_ids: list[str]) -> str:
    """Create a Google Slides presentation from the final report for the given task ids."""
    return create_slides(task_ids)
