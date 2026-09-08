import logging

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from routes_analyze import router as analyze_router
from routes_competitors import router as competitors_router
from routes_eyequant import router as eyequant_router
from routes_pipeline import router as pipeline_router
from routes_redo_screenshot import router as redo_screenshot_router
from routes_remember import router as remember_router
from routes_report import router as report_router
from routes_roi import router as roi_router
from routes_runs import router as runs_router
from routes_slides_create import router as slides_create_router
from routes_storage import router as storage_router

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="Slides API", description="API for slides generation", version="1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(HTTPException)
async def _http_exception_handler(request, exc: HTTPException) -> JSONResponse:
    # Ported routes raise HTTPException(detail={"error": ..., ...}) to match
    # the flat {error, rejectedUrls?} response shape the frontend already
    # expects, instead of FastAPI's default {"detail": {...}} wrapping.
    content = exc.detail if isinstance(exc.detail, dict) else {"error": str(exc.detail)}
    return JSONResponse(status_code=exc.status_code, content=content)


app.include_router(analyze_router)
app.include_router(runs_router)
app.include_router(roi_router)
app.include_router(competitors_router)
app.include_router(report_router)
app.include_router(redo_screenshot_router)
app.include_router(remember_router)
app.include_router(storage_router)
app.include_router(pipeline_router)
app.include_router(eyequant_router)
app.include_router(slides_create_router)


@app.get("/")
def root() -> dict[str, str]:
    """
    Root endpoint to check if the API is running.
    Returns a simple message.
    """
    return {"message": "Slides API is running. Use /docs for documentation."}

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
