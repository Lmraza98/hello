"""Email/phone discovery endpoints for pipeline routes."""

import sys
import threading

from fastapi import APIRouter, HTTPException

from api.routes._helpers import COMMON_ERROR_RESPONSES
from api.routes.pipeline_routes.models import PipelineStartedResponse
from api.routes.pipeline_routes.runner import run_streaming_command
from api.routes.pipeline_routes.state import initialize_run, is_running

router = APIRouter()


@router.post("/emails", response_model=PipelineStartedResponse, responses=COMMON_ERROR_RESPONSES)
def run_email_discovery(workers: int = 5):
    """Run only the email discovery step on existing contacts."""
    if is_running():
        raise HTTPException(400, "Pipeline already running")

    initialize_run()
    cmd = [sys.executable, "-u", "-m", "cli.main", "discover-emails", "--workers", str(workers)]

    thread = threading.Thread(
        target=run_streaming_command,
        kwargs={"cmd": cmd},
        daemon=True,
    )
    thread.start()

    return PipelineStartedResponse(started=True)


@router.post("/phones", response_model=PipelineStartedResponse, responses=COMMON_ERROR_RESPONSES)
def run_phone_discovery(workers: int = 10, today_only: bool = False):
    """Run phone discovery on existing contacts."""
    if is_running():
        raise HTTPException(400, "Pipeline already running")

    initialize_run()
    cmd = [sys.executable, "-u", "-m", "cli.main", "discover-phones", "--workers", str(workers)]
    if today_only:
        cmd.append("--today")

    thread = threading.Thread(
        target=run_streaming_command,
        kwargs={"cmd": cmd},
        daemon=True,
    )
    thread.start()

    return PipelineStartedResponse(started=True)
