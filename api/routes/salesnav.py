"""SalesNav API route aggregator."""

from fastapi import APIRouter

from api.routes.salesnav_routes import browser, company_search, lead_scraping, people

SALESNAV_PREFIX = "/api/salesnav"

router = APIRouter(tags=["salesnav"])
router.include_router(people.router, prefix=SALESNAV_PREFIX)
router.include_router(company_search.router, prefix=SALESNAV_PREFIX)
router.include_router(lead_scraping.router, prefix=SALESNAV_PREFIX)
router.include_router(browser.router, prefix=SALESNAV_PREFIX)
