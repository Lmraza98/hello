"""Status endpoints for pipeline routes."""

from fastapi import APIRouter

from api.routes._helpers import COMMON_ERROR_RESPONSES
from api.routes.pipeline_routes.models import PipelineStatusResponse
from api.routes.pipeline_routes.state import snapshot

router = APIRouter()


@router.get("/status", response_model=PipelineStatusResponse, responses=COMMON_ERROR_RESPONSES)
def get_pipeline_status():
    return snapshot(last_lines=50)
