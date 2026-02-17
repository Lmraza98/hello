"""Contacts API route aggregator."""

from fastapi import APIRouter

from api.routes.contact_routes import bulk, read, salesforce, write

CONTACTS_PREFIX = "/api/contacts"

router = APIRouter(tags=["contacts"])
router.include_router(read.router, prefix=CONTACTS_PREFIX)
router.include_router(salesforce.router, prefix=CONTACTS_PREFIX)
router.include_router(write.router, prefix=CONTACTS_PREFIX)
router.include_router(bulk.router, prefix=CONTACTS_PREFIX)
