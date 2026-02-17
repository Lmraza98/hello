"""Start/stop orchestration endpoints for the full pipeline."""

import sys
import threading
from typing import Optional

from fastapi import APIRouter, HTTPException

import config
from api.routes._helpers import COMMON_ERROR_RESPONSES
from api.routes.pipeline_routes.models import PipelineStartedResponse, PipelineStoppedResponse
from api.routes.pipeline_routes.runner import run_streaming_command
from api.routes.pipeline_routes.state import initialize_run, is_running, stop_process

router = APIRouter()


@router.post("/start", response_model=PipelineStartedResponse, responses=COMMON_ERROR_RESPONSES)
def start_pipeline(tier: Optional[str] = None, max_contacts: int = 25):
    if is_running():
        raise HTTPException(400, "Pipeline already running")

    initialize_run(f"Starting pipeline... (tier={tier or 'all'}, max_contacts={max_contacts})")

    cmd = [sys.executable, "-u", "-m", "cli.main", "scrape-and-enrich", "--max-contacts", str(max_contacts)]
    if tier:
        cmd.extend(["--tier", tier])

    thread = threading.Thread(
        target=run_streaming_command,
        kwargs={
            "cmd": cmd,
            "cwd": str(config.BASE_DIR),
            "extra_env": {"NO_COLOR": "1", "TERM": "dumb"},
        },
        daemon=True,
    )
    thread.start()

    return PipelineStartedResponse(started=True)


@router.post("/stop", response_model=PipelineStoppedResponse, responses=COMMON_ERROR_RESPONSES)
def stop_pipeline():
    stop_process()
    return PipelineStoppedResponse(stopped=True)
