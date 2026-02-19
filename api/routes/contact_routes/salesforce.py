"""Salesforce-related contact endpoints."""

from fastapi import APIRouter, HTTPException

import config
import database as db
from api.routes._helpers import COMMON_ERROR_RESPONSES, require_row_updated
from api.routes.contact_routes.models import (
    ContactSalesforceAuthResponse,
    ContactSalesforceQueuedResponse,
    ContactSalesforceSimpleResponse,
    ContactSalesforceUrlResponse,
    SalesforceUrlRequest,
)
from services.web_automation.salesforce.lookup_queue import enqueue_salesforce_lookup, is_browser_busy

router = APIRouter()


@router.post("/salesforce-auth", response_model=ContactSalesforceAuthResponse, responses=COMMON_ERROR_RESPONSES)
async def salesforce_auth_session():
    """
    Open a browser window to authenticate with Salesforce.
    Waits for the browser to be closed manually before saving session.
    """
    import asyncio
    from playwright.async_api import async_playwright

    try:
        print("[Salesforce Auth] Starting browser...")
        playwright = await async_playwright().start()

        browser = await playwright.chromium.launch(headless=False, slow_mo=50)

        storage_path = config.DATA_DIR / "salesforce_auth.json"
        if storage_path.exists():
            print("[Salesforce Auth] Loading existing session...")
            context = await browser.new_context(
                storage_state=str(storage_path),
                viewport={"width": 1920, "height": 1080},
            )
        else:
            print("[Salesforce Auth] Creating new session...")
            context = await browser.new_context(viewport={"width": 1920, "height": 1080})

        page = await context.new_page()
        print("[Salesforce Auth] Navigating to Salesforce...")
        salesforce_url = config.SALESFORCE_URL
        print("[Salesforce URL]: ", salesforce_url)
        await page.goto(salesforce_url, wait_until="domcontentloaded", timeout=120000)

        print("=" * 60)
        print("[Salesforce Auth] BROWSER IS NOW OPEN")
        print("[Salesforce Auth] Please log in to Salesforce.")
        print("[Salesforce Auth] When done, CLOSE THE BROWSER WINDOW to save session.")
        print("=" * 60)

        try:
            while browser.is_connected():
                await asyncio.sleep(1)
        except Exception as e:
            print(f"[Salesforce Auth] Browser closed or disconnected: {e}")

        print("[Salesforce Auth] Saving session...")
        try:
            await context.storage_state(path=str(storage_path))
            print(f"[Salesforce Auth] Session saved to {storage_path}")
        except Exception as e:
            print(f"[Salesforce Auth] Could not save session: {e}")

        try:
            await context.close()
        except Exception:
            pass
        try:
            await browser.close()
        except Exception:
            pass
        try:
            await playwright.stop()
        except Exception:
            pass

        return ContactSalesforceAuthResponse(success=True, message="Session saved. You can now use bulk upload.")
    except Exception as e:
        import traceback

        print(f"[Salesforce Auth] ERROR: {e}")
        print(traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{contact_id}/salesforce-url", response_model=ContactSalesforceUrlResponse, responses=COMMON_ERROR_RESPONSES)
def save_salesforce_url(contact_id: int, body: SalesforceUrlRequest):
    url = (body.salesforce_url or "").strip()
    if "lightning.force.com" not in url or "/lightning/r/Lead/" not in url:
        raise HTTPException(status_code=400, detail="Invalid Salesforce Lead URL")

    with db.get_db() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "UPDATE linkedin_contacts SET salesforce_url = ?, salesforce_status = 'uploaded' WHERE id = ?",
            (url, contact_id),
        )
        require_row_updated(cursor.rowcount, "Contact not found")

    return ContactSalesforceUrlResponse(success=True, salesforce_url=url)


@router.post("/{contact_id}/salesforce-skip", response_model=ContactSalesforceSimpleResponse, responses=COMMON_ERROR_RESPONSES)
def skip_salesforce(contact_id: int):
    with db.get_db() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "UPDATE linkedin_contacts SET salesforce_status = 'skipped' WHERE id = ?",
            (contact_id,),
        )
        require_row_updated(cursor.rowcount, "Contact not found")
    return ContactSalesforceSimpleResponse(success=True)


@router.post("/{contact_id}/salesforce-search", response_model=ContactSalesforceQueuedResponse, responses=COMMON_ERROR_RESPONSES)
def search_salesforce(contact_id: int):
    with db.get_db() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "UPDATE linkedin_contacts SET salesforce_status = 'queued' WHERE id = ?",
            (contact_id,),
        )
        require_row_updated(cursor.rowcount, "Contact not found")

        cursor.execute("SELECT name FROM linkedin_contacts WHERE id = ?", (contact_id,))
        row = cursor.fetchone()
        name = (row[0] if isinstance(row, (list, tuple)) else row["name"]) if row else None

    enqueue_salesforce_lookup(contact_id, name or "")
    return ContactSalesforceQueuedResponse(success=True, queued=True, busy=is_browser_busy())
