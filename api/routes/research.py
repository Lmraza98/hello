"""Research API route aggregator."""

from fastapi import APIRouter

from api.routes.research_routes import assessment, search

RESEARCH_PREFIX = "/api/research"

router = APIRouter(tags=["research"])
router.include_router(search.router, prefix=RESEARCH_PREFIX)
router.include_router(assessment.router, prefix=RESEARCH_PREFIX)

