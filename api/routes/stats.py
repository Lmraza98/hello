"""Stats API route aggregator."""

from fastapi import APIRouter

from api.routes.stats_routes import read

STATS_PREFIX = "/api/stats"

router = APIRouter(tags=["stats"])
router.include_router(read.router, prefix=STATS_PREFIX)

