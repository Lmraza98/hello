"""Email API route aggregator."""

from fastapi import APIRouter

from api.routes.email_routes import campaign_management, delivery, engagement

router = APIRouter(prefix="/api/emails", tags=["emails"])
router.include_router(campaign_management.router)
router.include_router(delivery.router)
router.include_router(engagement.router)

