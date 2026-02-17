"""Pipeline API route aggregator."""

from fastapi import APIRouter

from api.routes.pipeline_routes import discovery, orchestration, status

PIPELINE_PREFIX = "/api/pipeline"

router = APIRouter(tags=["pipeline"])
router.include_router(status.router, prefix=PIPELINE_PREFIX)
router.include_router(orchestration.router, prefix=PIPELINE_PREFIX)
router.include_router(discovery.router, prefix=PIPELINE_PREFIX)

