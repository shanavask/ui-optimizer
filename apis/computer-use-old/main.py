import asyncio
import json
import logging
import os
import traceback
from datetime import datetime
from enum import Enum
from typing import Any, List, Optional

from fastapi import FastAPI, HTTPException, Query, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from agent import BrowserAgent
from computers import BrowserbaseComputer
from google.cloud import firestore


DEFAULT_MODEL = "gemini-3-flash-preview"
AUDITS_COLLECTION = "audits"

VIEWPORT = (440, 956)
CHROME_UA = (
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) "
    "AppleWebKit/605.1.15 (KHTML, like Gecko) "
    "CriOS/135.0.0.0 Mobile/15E148 Safari/604.1"
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="Browser Use API", description="API for browser use agent", version="1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

class TaskRequest(BaseModel):
    task: str = Field(..., description="The task to be performed by the agent")
    initial_url: str = Field(..., description="The initial URL loaded in the browser session")
    task_id: Optional[str] = Field(None, description="Optional caller-provided task identifier")
class TaskResponse(BaseModel):
    task_id: str = Field(..., description="Unique identifier for the task")
    result: str = Field(..., description="The result of the task")
    is_successful: bool = Field(..., description="Whether the task was successful")
    screenshot: str = Field(..., description="Base64 encoded screenshot of the final state")
class TaskStatus(str, Enum):
    PENDING = "pending"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    FAILED = "failed"
class TaskRecord(BaseModel):
    task_id: str = Field(..., description="Unique identifier for the task")
    task: str = Field(..., description="The task to be performed")
    status: TaskStatus = Field(..., description="Current status of the task")
    start_time: datetime = Field(..., description="Time when the task was started")
    end_time: Optional[datetime] = Field(None, description="Time when the task was completed")
    duration: Optional[float] = Field(None, description="Duration of the task in seconds")
    result: Optional[str] = Field(None, description="Result of the task if completed")
    screenshot: Optional[str] = Field(None, description="Base64 encoded screenshot of the final state")
    error: Optional[str] = Field(None, description="Error message if the task failed")
    agent_artifact_path: Optional[str] = Field(None, description="Path to saved agent artifact for analysis")

task_records: List[TaskRecord] = []
task_counter: int = 0
task_lock = asyncio.Lock()


def _firestore_client() -> Optional[Any]:
    project_id = os.getenv("GOOGLE_CLOUD_PROJECT", "").strip()
    database_id = os.getenv("FIRESTORE_DATABASE_ID", "").strip()
    return firestore.Client(project=project_id, database=database_id)


def _save_audit_to_firestore(task_id: str, result: str, screenshot: Optional[str]) -> None:
    client = _firestore_client()
    if client is None:
        return
    payload = {
        "task_id": task_id,
        "result": result,
        "screenshot": screenshot,
        "status": TaskStatus.COMPLETED.value,
        "updated_at": datetime.now(),
    }
    client.collection(AUDITS_COLLECTION).document(task_id).set(payload, merge=True)


def _execute_agent_task(task: str, initial_url: str) -> tuple[str, Optional[str]]:
    env = BrowserbaseComputer(
        screen_size=VIEWPORT,
        chrome_ua=CHROME_UA,
        initial_url=initial_url,
    )

    with env as browser_computer:
        agent = BrowserAgent(
            browser_computer=browser_computer,
            query=task,
            model_name=DEFAULT_MODEL,
        )
        agent.agent_loop()
        screenshot_base64 = browser_computer._screenshot()
        # artifact_path = _save_agent_for_analysis(task_id, agent)

    return agent.final_reasoning or "", screenshot_base64


async def _update_task_on_completion(
    task_id: str,
    result: str,
    screenshot: Optional[str],
) -> None:
    async with task_lock:
        for record in task_records:
            if record.task_id == task_id:
                record.status = TaskStatus.COMPLETED
                record.result = result
                record.screenshot = screenshot
                record.end_time = datetime.now()
                if record.start_time and record.end_time:
                    record.duration = (record.end_time - record.start_time).total_seconds()
                return


async def _update_task_on_failure(task_id: str, error: Exception) -> None:
    async with task_lock:
        for record in task_records:
            if record.task_id == task_id:
                record.status = TaskStatus.FAILED
                record.error = str(error)
                record.end_time = datetime.now()
                if record.start_time and record.end_time:
                    record.duration = (record.end_time - record.start_time).total_seconds()
                return


async def run_task(task_id: str, task: str, initial_url: str) -> None:
    """
    Run a task using the Browser Use agent.
    This function initializes a browser session, runs the agent with the specified task and URL,
    and returns the task record with the result or error.
    """
    try:
        logger.info(f"Starting task {task_id} with task: {task}")
        async with task_lock:
            duplicate_task_exists = any(record.task_id == task_id for record in task_records)
            if duplicate_task_exists:
                logger.info(
                    "Skipping task %s because an in-progress/completed task already exists",
                    task_id,
                )
                return
            task_record = TaskRecord(
                task_id=task_id,
                task=task,
                status=TaskStatus.IN_PROGRESS,
                start_time=datetime.now(),
            )
            task_records.append(task_record)
    
        logger.info(f"Task {task_id} running agent")
        result, screen = await asyncio.to_thread(_execute_agent_task, task, initial_url)
        # logger.info(f"Task {task_id} completed with result: {result}")
        await _update_task_on_completion(task_id, result, screen)
        await asyncio.to_thread(_save_audit_to_firestore, task_id, result, screen)

    except Exception as e:
        logger.error(f"Task {task_id} failed with error: {e}")
        logger.error(traceback.format_exc())
        await _update_task_on_failure(task_id, e)
    finally:
        logger.info(f"Task {task_id} finished")

@app.post("/run", response_model=TaskResponse)
async def run_task_post(request: TaskRequest, background_tasks: BackgroundTasks) -> TaskResponse:
    """
    Endpoint to run a task using the Browser Use agent.
    Accepts a task and model, starts the task in a background process,
    and returns the task record.
    """
    global task_counter
    logger.info(f"Received task request: {request.task}")

    async with task_lock:
        if request.task_id:
            curr_task_id = request.task_id
        else:
            task_counter += 1
            curr_task_id = f"{task_counter}"
    
    background_tasks.add_task(run_task, curr_task_id, request.task, request.initial_url)

    return TaskResponse(
        task_id=curr_task_id,
        result="Task is submitted",
        is_successful=False,
        screenshot=""
    )

@app.get("/tasks", response_model=List[TaskRecord])
async def get_tasks(
    limit: int = Query(100, ge=1, le=1000, description="Maximum number of tasks to return"),
) -> List[TaskRecord]:
    """
    Endpoint to get the list of all tasks.
    Returns the current task records.
    """
    async with task_lock:
        return list(task_records[:limit])

@app.get("/task/{task_id}", response_model=TaskRecord)
async def get_task(task_id: str) -> TaskRecord:
    """
    Endpoint to get the details of a specific task by its ID.
    Returns the task record if found, otherwise raises a 404 error.
    """
    async with task_lock:
        for record in task_records:
            if record.task_id == task_id:
                return record
    raise HTTPException(status_code=404, detail="Task not found")

@app.get("/")
async def root() -> dict[str, str]:
    """
    Root endpoint to check if the API is running.
    Returns a simple message.
    """
    return {"message": "Browser Use API is running. Use /docs for documentation."}

if __name__ == "__main__":
    import uvicorn
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=5400)
    parser.add_argument("--mode", type=str, choices=["server", "cli"], default="server")
    # For CLI mode, we might need other args, but uvicorn and argparse together is messy.
    # Let's keep it simple: if "main.py" is run, it starts server. 
    # __main__.py calls local_run().
    
    args, unknown = parser.parse_known_args()
    uvicorn.run(app, host="0.0.0.0", port=args.port)