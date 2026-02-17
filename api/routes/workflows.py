"""Workflow routes — thin aggregator."""

from fastapi import APIRouter

from api.routes.workflow_routes import outreach, prospecting, vetting

PREFIX = "/workflows"

router = APIRouter(tags=["workflows"])
router.include_router(outreach.router, prefix=PREFIX)
router.include_router(prospecting.router, prefix=PREFIX)
router.include_router(vetting.router, prefix=PREFIX)
