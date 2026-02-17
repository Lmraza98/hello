"""Companies API route aggregator."""

from fastapi import APIRouter

from api.routes.company_routes import ingest, read, write

COMPANIES_PREFIX = "/api/companies"

router = APIRouter(tags=["companies"])
router.include_router(read.router, prefix=COMPANIES_PREFIX)
router.include_router(write.router, prefix=COMPANIES_PREFIX)
router.include_router(ingest.router, prefix=COMPANIES_PREFIX)

