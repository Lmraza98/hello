"""Salesforce API route aggregator."""

from fastapi import APIRouter

from api.routes.salesforce_routes import auth, credentials

SALESFORCE_PREFIX = "/api/salesforce"

router = APIRouter(tags=["salesforce"])
router.include_router(credentials.router, prefix=SALESFORCE_PREFIX)
router.include_router(auth.router, prefix=SALESFORCE_PREFIX)

