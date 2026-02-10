"""
Background Salesforce Lead URL lookup queue.

When a contact is saved to the local DB, we can (optionally) check Salesforce UI
via Playwright to see if a matching Lead already exists and capture its URL.

Design goals:
- Non-blocking: enqueue work and return immediately to the API caller.
- Safe: never creates/updates Salesforce records; lookup-only.
- Cooperative: waits until the shared browser stream is idle before taking over
  the active page used by the UI BrowserViewer stream.
- Uses shared bot instance from auth manager for efficiency and better auth handling.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from typing import Optional

import database as db
from api.routes.browser_stream import broadcast_event, get_active_browser_page, set_active_browser_page
from services.salesforce_credentials import credentials_configured


@dataclass(frozen=True)
class SalesforceLookupJob:
    contact_id: int
    name: str


_queue: "asyncio.Queue[SalesforceLookupJob]" = asyncio.Queue()
_worker_task: Optional[asyncio.Task] = None
_shutdown_event: Optional[asyncio.Event] = None
_loop: Optional[asyncio.AbstractEventLoop] = None


def enqueue_salesforce_lookup(contact_id: int, name: str) -> None:
    """
    Enqueue a lookup job.

    Must be called from the main event loop thread (i.e. from async routes or startup tasks).
    """
    if not name or not str(name).strip():
        return
    job = SalesforceLookupJob(contact_id=int(contact_id), name=str(name).strip())

    # Thread-safe enqueue (sync FastAPI routes may run in a threadpool).
    try:
        loop = asyncio.get_running_loop()
        loop.call_soon(_queue.put_nowait, job)
        return
    except RuntimeError:
        pass

    if _loop:
        _loop.call_soon_threadsafe(_queue.put_nowait, job)
    else:
        # Fallback: best effort.
        _queue.put_nowait(job)


def is_browser_busy() -> bool:
    return get_active_browser_page() is not None


async def start_salesforce_lookup_worker() -> None:
    global _worker_task, _shutdown_event, _loop
    if _worker_task and not _worker_task.done():
        return

    _loop = asyncio.get_running_loop()
    _shutdown_event = asyncio.Event()
    _worker_task = asyncio.create_task(_worker_loop(), name="salesforce_lookup_worker")


async def stop_salesforce_lookup_worker() -> None:
    global _worker_task, _shutdown_event, _loop
    if _shutdown_event:
        _shutdown_event.set()
    if _worker_task:
        try:
            await asyncio.wait_for(_worker_task, timeout=5)
        except Exception:
            _worker_task.cancel()
        _worker_task = None
    _shutdown_event = None
    _loop = None


async def _worker_loop() -> None:
    assert _shutdown_event is not None

    while not _shutdown_event.is_set():
        try:
            job = await asyncio.wait_for(_queue.get(), timeout=0.5)
        except asyncio.TimeoutError:
            continue

        try:
            print(f"[SF Lookup] picked up contact_id={job.contact_id} name={job.name!r}")
            await _process_job(job)
        except Exception as exc:
            print(f"[SF Lookup] job failed for contact_id={job.contact_id}: {exc}")
        finally:
            _queue.task_done()


def _requeue(contact_id: int) -> None:
    """Set status back to 'queued' so the job can be retried."""
    with db.get_db() as conn:
        cur = conn.cursor()
        cur.execute(
            "UPDATE linkedin_contacts SET salesforce_status = 'queued' WHERE id = ?",
            (contact_id,),
        )


async def _process_job(job: SalesforceLookupJob) -> None:
    # Import here to avoid circular imports at module level
    from services.salesforce_auth_manager import (
        get_shared_bot,
        trigger_reauth,
        is_reauth_in_progress,
        _is_bot_alive,
    )

    # ── Pre-flight checks ────────────────────────────────────────────
    if not credentials_configured():
        print("[SF Lookup] No credentials configured — skipping")
        await broadcast_event("salesforce_no_credentials", {
            "message": "Set up Salesforce credentials in Settings to enable lookups.",
        })
        with db.get_db() as conn:
            cur = conn.cursor()
            cur.execute(
                "UPDATE linkedin_contacts SET salesforce_status = 'skipped' WHERE id = ?",
                (job.contact_id,),
            )
        return

    # Already has a URL?
    with db.get_db() as conn:
        cur = conn.cursor()
        cur.execute("SELECT salesforce_url FROM linkedin_contacts WHERE id = ?", (job.contact_id,))
        row = cur.fetchone()
        if not row:
            return
        existing_url = row[0] if isinstance(row, (list, tuple)) else row["salesforce_url"]
        if existing_url:
            return

    # Mark as checking
    with db.get_db() as conn:
        cur = conn.cursor()
        cur.execute(
            "UPDATE linkedin_contacts SET salesforce_status = 'checking' WHERE id = ?",
            (job.contact_id,),
        )
    print(f"[SF Lookup] checking contact_id={job.contact_id}")

    # Wait for the shared browser stream to be idle
    wait_count = 0
    while get_active_browser_page() is not None:
        await asyncio.sleep(1)
        wait_count += 1
        if wait_count > 300:
            print("[SF Lookup] Timeout waiting for browser")
            _requeue(job.contact_id)
            return
        if _shutdown_event and _shutdown_event.is_set():
            return

    # ── Main work ────────────────────────────────────────────────────
    try:
        await broadcast_event("browser_automation_start", {
            "action": "salesforce_lookup", "query": job.name,
        })

        # Get the shared bot (creates browser if needed, never blocks for MFA)
        bot = await get_shared_bot()
        if bot is None or not _is_bot_alive(bot):
            print("[SF Lookup] Could not get a live bot")
            _requeue(job.contact_id)
            return

        set_active_browser_page(bot.page)

        # ── Authenticate if needed ───────────────────────────────────
        if not bot.is_authenticated:
            print("[SF Lookup] Bot is not authenticated")

            if is_reauth_in_progress():
                print("[SF Lookup] Re-auth already in progress, queuing for later")
                _requeue(job.contact_id)
                return

            print("[SF Lookup] Triggering re-authentication...")
            await broadcast_event("salesforce_auth_required", {
                "message": "Salesforce needs authentication. Complete MFA if prompted.",
            })

            ok = await trigger_reauth()
            if not ok:
                print("[SF Lookup] Re-authentication failed")
                _requeue(job.contact_id)
                return

            # Refresh bot reference (trigger_reauth may have recreated it)
            bot = await get_shared_bot()
            if bot is None or not _is_bot_alive(bot) or not bot.is_authenticated:
                print("[SF Lookup] Still not authenticated after re-auth")
                _requeue(job.contact_id)
                return

            # Re-set the active page (it may be a new page object)
            set_active_browser_page(bot.page)

        # ── Perform the lookup ───────────────────────────────────────
        url = await bot.find_lead_url_by_name(job.name)

        if not url:
            print(f"[SF Lookup] not found for contact_id={job.contact_id}")
            with db.get_db() as conn:
                cur = conn.cursor()
                cur.execute(
                    "UPDATE linkedin_contacts SET salesforce_status = 'not_found' WHERE id = ?",
                    (job.contact_id,),
                )
            return

        print(f"[SF Lookup] found url for contact_id={job.contact_id}: {url}")
        with db.get_db() as conn:
            cur = conn.cursor()
            cur.execute(
                "UPDATE linkedin_contacts SET salesforce_url = ?, salesforce_status = 'uploaded' WHERE id = ?",
                (url, job.contact_id),
            )

    except Exception as exc:
        print(f"[SF Lookup] Error during lookup: {exc}")
        _requeue(job.contact_id)

    finally:
        try:
            set_active_browser_page(None)
        except Exception:
            pass
        await broadcast_event("browser_automation_stop", {"action": "salesforce_lookup"})

