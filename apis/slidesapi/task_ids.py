def task_id_for_page(run_id: str, page_index: int) -> str:
    return f"{run_id}_page_{page_index}"


def task_id_for_redo_page(run_id: str, page_index: int) -> str:
    return f"{run_id}_page_{page_index}_redo"


def task_id_for_competitor(run_id: str, page_index: int, competitor_index: int) -> str:
    return f"{run_id}_page_{page_index}_comp_{competitor_index}"
