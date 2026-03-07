"""
Background Salesforce queue for lookup and optional single-lead creation.

Existing behavior remains lookup-first for existing call sites.
Inbound Outlook flow can enqueue create-if-missing jobs.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from typing import Optional

import database as db
from api.routes.browser_stream import broadcast_event, get_active_browser_page, set_active_browser_page
from services.web_automation.salesforce.credentials import credentials_configured
from services.web_automation.browser.workflows.task_manager import workflow_task_manager


@dataclass(frozen=True)
class SalesforceLookupJob:
    contact_id: int
    name: str
    create_if_missing: bool = False


_queue: "asyncio.Queue[SalesforceLookupJob]" = asyncio.Queue()
_worker_task: Optional[asyncio.Task] = None
_shutdown_event: Optional[asyncio.Event] = None
_loop: Optional[asyncio.AbstractEventLoop] = None
_SYNC_TERMINAL_OR_ACTIVE = {"queued", "creating", "success"}
_BUSY_WAIT_INTERVAL_SECONDS = 0.25
_BUSY_WAIT_MAX_SECONDS = 20.0
_INBOUND_PREEMPT_AFTER_SECONDS = 3.0


def _enqueue_job(job: SalesforceLookupJob) -> None:
    try:
        loop = asyncio.get_running_loop()
        loop.call_soon(_queue.put_nowait, job)
        return
    except RuntimeError:
        pass

    if _loop:
        _loop.call_soon_threadsafe(_queue.put_nowait, job)
    else:
        _queue.put_nowait(job)


def enqueue_salesforce_lookup(contact_id: int, name: str) -> None:
    """Enqueue a lookup-only Salesforce job."""
    if not name or not str(name).strip():
        return
    _enqueue_job(SalesforceLookupJob(contact_id=int(contact_id), name=str(name).strip(), create_if_missing=False))


def enqueue_salesforce_create(contact_id: int, name: str) -> None:
    """Enqueue a create-if-missing Salesforce job for a single contact."""
    if not name or not str(name).strip():
        return
    with db.get_db() as conn:
        cur = conn.cursor()
        cur.execute(
            "UPDATE linkedin_contacts SET salesforce_sync_status = 'queued' WHERE id = ?",
            (int(contact_id),),
        )
    _enqueue_job(SalesforceLookupJob(contact_id=int(contact_id), name=str(name).strip(), create_if_missing=True))


def enqueue_pending_inbound_salesforce_creates(limit: int = 500) -> int:
    """
    Backfill queue for existing inbound contacts that still need Salesforce sync.
    - If sync_status is success but URL is still empty, enqueue lookup-only URL resolution.
    - Otherwise enqueue create-if-missing flow.
    Returns number of contacts queued in this call.
    """
    bounded_limit = max(1, min(int(limit or 500), 5000))
    queued = 0
    with db.get_db() as conn:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT id, name, salesforce_sync_status
            FROM linkedin_contacts
            WHERE lower(COALESCE(salesforce_status, '')) LIKE 'inbound%'
              AND COALESCE(NULLIF(salesforce_url, ''), '') = ''
            ORDER BY datetime(scraped_at) DESC, id DESC
            LIMIT ?
            """,
            (bounded_limit,),
        )
        rows = cur.fetchall()

    for row in rows:
        sync_status = ((row["salesforce_sync_status"] or "").strip().lower())
        contact_id = int(row["id"])
        contact_name = ((row["name"] or "").strip() or "Unknown Lead")
        if sync_status == "success":
            # Lead likely created but URL missing; resolve URL without creating duplicates.
            enqueue_salesforce_lookup(contact_id, contact_name)
        else:
            enqueue_salesforce_create(contact_id, contact_name)
        queued += 1
    return queued


def _build_inbound_description(contact_id: int) -> str:
    with db.get_db() as conn:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT source_sender, lead_title, lead_industry, lead_company
            FROM inbound_lead_events
            WHERE contact_id = ?
            ORDER BY datetime(COALESCE(received_at, detected_at)) DESC, id DESC
            LIMIT 1
            """,
            (int(contact_id),),
        )
        row = cur.fetchone()
    if not row:
        return "Source: Inbound Outlook lead auto-sync"
    parts: list[str] = ["Source: Inbound Outlook lead auto-sync"]
    source_sender = (row["source_sender"] or "").strip()
    if source_sender:
        parts.append(f"Sender: {source_sender}")
    lead_title = (row["lead_title"] or "").strip()
    if lead_title:
        parts.append(f"Title: {lead_title}")
    lead_industry = (row["lead_industry"] or "").strip()
    if lead_industry:
        parts.append(f"Industry: {lead_industry}")
    lead_company = (row["lead_company"] or "").strip()
    if lead_company:
        parts.append(f"Company: {lead_company}")
    return "\n".join(parts)


def _normalize_match_value(value: Optional[str]) -> str:
    return " ".join((value or "").strip().lower().split())


def _find_existing_contact_salesforce_url(
    *,
    contact_id: int,
    full_name: Optional[str],
    company_name: Optional[str],
    email: Optional[str],
) -> tuple[Optional[str], Optional[str]]:
    """
    Find an already-linked Salesforce lead URL from another local contact row.
    Returns (url, reason) where reason is `email` or `name_company`.
    """
    email_key = (email or "").strip().lower()
    name_key = _normalize_match_value(full_name)
    company_key = _normalize_match_value(company_name)
    predicates: list[str] = []
    params: list[object] = [int(contact_id)]
    if email_key:
        predicates.append("lower(COALESCE(email_generated, '')) = ?")
        params.append(email_key)
    if name_key and company_key:
        predicates.append(
            "(lower(trim(COALESCE(name, ''))) = ? AND lower(trim(COALESCE(company_name, ''))) = ?)"
        )
        params.extend([name_key, company_key])
    if not predicates:
        return None, None

    query = f"""
        SELECT salesforce_url, email_generated, name, company_name
        FROM linkedin_contacts
        WHERE id <> ?
          AND COALESCE(NULLIF(salesforce_url, ''), '') <> ''
          AND ({' OR '.join(predicates)})
        ORDER BY datetime(COALESCE(scraped_at, salesforce_uploaded_at)) DESC, id DESC
        LIMIT 1
    """
    with db.get_db() as conn:
        cur = conn.cursor()
        cur.execute(query, tuple(params))
        row = cur.fetchone()
    if not row:
        return None, None
    url = (row["salesforce_url"] or "").strip()
    if not url:
        return None, None
    reason = (
        "email"
        if email_key and ((row["email_generated"] or "").strip().lower() == email_key)
        else "name_company"
    )
    return url, reason


async def _find_existing_lead_in_salesforce(
    *,
    bot,
    full_name: Optional[str],
    email: Optional[str],
    phone: Optional[str],
    company_name: Optional[str],
) -> tuple[Optional[str], Optional[str]]:
    """
    Query Salesforce before create to avoid duplicate lead creation.
    Returns (url, matched_by) on first match.
    Only deterministic keys are used here (email/phone). Name-only matching is
    intentionally excluded because it causes false-positive reuse for common names.
    """
    preferred_name = (full_name or "").strip() or None
    attempts: list[tuple[str, str]] = []
    if (email or "").strip():
        attempts.append(((email or "").strip(), "email"))
    if (phone or "").strip():
        attempts.append(((phone or "").strip(), "phone"))
    # Do not search by name/company for duplicate suppression. Those queries can
    # return unrelated leads and attach the wrong Salesforce URL.

    seen: set[str] = set()
    for query, matched_by in attempts:
        key = query.lower()
        if key in seen:
            continue
        seen.add(key)
        try:
            found = await bot.find_first_lead_url_by_query(
                query=query,
                preferred_name=preferred_name,
                strict_preferred=True,
            )
        except Exception as exc:
            print(f"[SF Queue] pre-create Salesforce lookup failed ({matched_by}): {exc}")
            continue
        resolved = bot.resolve_lead_record_url(found)
        if resolved:
            return resolved, matched_by
    return None, None


def is_browser_busy() -> bool:
    return get_active_browser_page() is not None


async def start_salesforce_lookup_worker() -> None:
    global _worker_task, _shutdown_event, _loop
    if _worker_task and not _worker_task.done():
        return
    _loop = asyncio.get_running_loop()
    _shutdown_event = asyncio.Event()
    _bootstrap_create_queue_from_db(limit=2000)
    _worker_task = asyncio.create_task(_worker_loop(), name="salesforce_lookup_worker")


def _bootstrap_create_queue_from_db(limit: int = 1000) -> int:
    """
    Rehydrate in-memory create queue from DB rows marked queued.
    This makes queue processing restart-safe.
    """
    bounded_limit = max(1, min(int(limit or 1000), 5000))
    with db.get_db() as conn:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT id, name
            FROM linkedin_contacts
            WHERE lower(COALESCE(salesforce_status, '')) LIKE 'inbound%'
              AND lower(COALESCE(salesforce_sync_status, '')) = 'queued'
              AND COALESCE(NULLIF(salesforce_url, ''), '') = ''
            ORDER BY datetime(scraped_at) DESC, id DESC
            LIMIT ?
            """,
            (bounded_limit,),
        )
        rows = cur.fetchall()

    for row in rows:
        _enqueue_job(
            SalesforceLookupJob(
                contact_id=int(row["id"]),
                name=((row["name"] or "").strip() or "Unknown Lead"),
                create_if_missing=True,
            )
        )
    if rows:
        print(f"[SF Queue] bootstrapped {len(rows)} queued inbound create jobs from DB")
    return len(rows)


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
    bootstrap_interval_seconds = 30.0
    last_bootstrap = asyncio.get_running_loop().time()
    while not _shutdown_event.is_set():
        try:
            job = await asyncio.wait_for(_queue.get(), timeout=0.5)
        except asyncio.TimeoutError:
            now = asyncio.get_running_loop().time()
            if now - last_bootstrap >= bootstrap_interval_seconds:
                try:
                    _bootstrap_create_queue_from_db(limit=500)
                except Exception as exc:
                    print(f"[SF Queue] periodic bootstrap failed: {exc}")
                last_bootstrap = now
            continue
        try:
            print(
                f"[SF Queue] picked up contact_id={job.contact_id} name={job.name!r} "
                f"create_if_missing={job.create_if_missing}"
            )
            await _process_job(job)
        except Exception as exc:
            print(f"[SF Queue] job failed for contact_id={job.contact_id}: {exc}")
        finally:
            _queue.task_done()


def _requeue(contact_id: int, *, create_if_missing: bool) -> None:
    with db.get_db() as conn:
        cur = conn.cursor()
        if create_if_missing:
            cur.execute(
                "UPDATE linkedin_contacts SET salesforce_sync_status = 'queued' WHERE id = ?",
                (contact_id,),
            )
        else:
            cur.execute(
                "UPDATE linkedin_contacts SET salesforce_status = 'queued' WHERE id = ?",
                (contact_id,),
            )


async def _process_job(job: SalesforceLookupJob) -> None:
    from services.web_automation.salesforce.auth_manager import (
        _is_bot_alive,
        get_shared_bot,
        is_reauth_in_progress,
        trigger_reauth,
    )

    task_id: str | None = None
    if job.create_if_missing:
        task_id = await workflow_task_manager.start_inline(
            stage="salesforce_create_queued",
            progress_pct=5,
            diagnostics={
                "task_type": "salesforce_sync",
                "operation": "salesforce_create",
                "contact_id": job.contact_id,
                "query": job.name,
                "goal": f"Create Salesforce lead for {job.name}",
                "website": "salesforce.com",
            },
        )

    if not credentials_configured():
        await broadcast_event(
            "salesforce_no_credentials",
            {"message": "Set up Salesforce credentials in Settings to enable Salesforce sync."},
        )
        with db.get_db() as conn:
            cur = conn.cursor()
            if job.create_if_missing:
                cur.execute(
                    "UPDATE linkedin_contacts SET salesforce_sync_status = 'failed_no_credentials' WHERE id = ?",
                    (job.contact_id,),
                )
            else:
                cur.execute(
                    "UPDATE linkedin_contacts SET salesforce_status = 'skipped' WHERE id = ?",
                    (job.contact_id,),
                )
        if task_id:
            await workflow_task_manager.fail_inline(
                task_id,
                code="salesforce_no_credentials",
                message="Salesforce credentials are not configured.",
                retry_suggestion="Configure Salesforce credentials in Settings, then requeue inbound contacts.",
                stage="failed_no_credentials",
                diagnostics={"contact_id": job.contact_id, "query": job.name},
            )
        return

    with db.get_db() as conn:
        cur = conn.cursor()
        cur.execute("SELECT salesforce_url FROM linkedin_contacts WHERE id = ?", (job.contact_id,))
        row = cur.fetchone()
        if not row:
            return
        existing_url = row[0] if isinstance(row, (list, tuple)) else row["salesforce_url"]
        if existing_url:
            if job.create_if_missing:
                cur.execute(
                    "UPDATE linkedin_contacts SET salesforce_sync_status = 'success' WHERE id = ?",
                    (job.contact_id,),
                )
                if task_id:
                    await workflow_task_manager.finish_inline(
                        task_id,
                        result={"ok": True, "status": "already_exists", "url": existing_url, "contact_id": job.contact_id},
                        stage="already_exists",
                        progress_pct=100,
                        diagnostics={"contact_id": job.contact_id, "query": job.name},
                    )
            return

    with db.get_db() as conn:
        cur = conn.cursor()
        if job.create_if_missing:
            cur.execute(
                "UPDATE linkedin_contacts SET salesforce_sync_status = 'creating' WHERE id = ?",
                (job.contact_id,),
            )
        else:
            cur.execute(
                "UPDATE linkedin_contacts SET salesforce_status = 'checking' WHERE id = ?",
                (job.contact_id,),
            )

    waited = 0.0
    while True:
        active_page = get_active_browser_page()
        if active_page is None:
            break
        try:
            if hasattr(active_page, "is_closed") and active_page.is_closed():
                # Clear stale global pointer so queued jobs are not blocked forever.
                set_active_browser_page(None)
                break
        except Exception:
            # If we cannot interrogate the page safely, clear and continue.
            set_active_browser_page(None)
            break
        # For inbound create jobs, avoid long queue latency; preempt quickly.
        if job.create_if_missing and waited >= _INBOUND_PREEMPT_AFTER_SECONDS:
            print(
                f"[SF Queue] preempting busy browser after {waited:.1f}s "
                f"for inbound create contact_id={job.contact_id}"
            )
            set_active_browser_page(None)
            break
        await asyncio.sleep(_BUSY_WAIT_INTERVAL_SECONDS)
        waited += _BUSY_WAIT_INTERVAL_SECONDS
        if waited > _BUSY_WAIT_MAX_SECONDS:
            _requeue(job.contact_id, create_if_missing=job.create_if_missing)
            if task_id:
                await workflow_task_manager.fail_inline(
                    task_id,
                    code="salesforce_wait_timeout",
                    message="Timed out waiting for active browser to become available.",
                    retry_suggestion="Retry after current browser automation completes.",
                    stage="requeued_wait_timeout",
                    diagnostics={"contact_id": job.contact_id, "query": job.name},
                )
            return
        if _shutdown_event and _shutdown_event.is_set():
            return

    try:
        await broadcast_event(
            "browser_automation_start",
            {
                "action": "salesforce_create" if job.create_if_missing else "salesforce_lookup",
                "query": job.name,
            },
        )
        bot = await get_shared_bot()
        if bot is None or not _is_bot_alive(bot):
            _requeue(job.contact_id, create_if_missing=job.create_if_missing)
            if task_id:
                await workflow_task_manager.fail_inline(
                    task_id,
                    code="salesforce_bot_unavailable",
                    message="Salesforce bot was unavailable; job requeued.",
                    retry_suggestion="Keep launcher/backend running and retry.",
                    stage="requeued_bot_unavailable",
                    diagnostics={"contact_id": job.contact_id, "query": job.name},
                )
            return

        set_active_browser_page(bot.page)
        await _ensure_salesforce_navigation(bot)

        if not bot.is_authenticated:
            if is_reauth_in_progress():
                _requeue(job.contact_id, create_if_missing=job.create_if_missing)
                if task_id:
                    await workflow_task_manager.fail_inline(
                        task_id,
                        code="salesforce_auth_in_progress",
                        message="Salesforce re-authentication is already in progress; job requeued.",
                        retry_suggestion="Complete auth flow and retry.",
                        stage="requeued_auth_in_progress",
                        diagnostics={"contact_id": job.contact_id, "query": job.name},
                    )
                return
            await broadcast_event(
                "salesforce_auth_required",
                {"message": "Salesforce needs authentication. Complete MFA if prompted."},
            )
            ok = await trigger_reauth()
            if not ok:
                with db.get_db() as conn:
                    cur = conn.cursor()
                    if job.create_if_missing:
                        cur.execute(
                            "UPDATE linkedin_contacts SET salesforce_sync_status = 'failed_auth' WHERE id = ?",
                            (job.contact_id,),
                        )
                    else:
                        _requeue(job.contact_id, create_if_missing=False)
                if task_id:
                    await workflow_task_manager.fail_inline(
                        task_id,
                        code="salesforce_auth_failed",
                        message="Salesforce authentication failed.",
                        retry_suggestion="Re-authenticate Salesforce and retry.",
                        stage="failed_auth",
                        diagnostics={"contact_id": job.contact_id, "query": job.name},
                    )
                return
            bot = await get_shared_bot()
            if bot is None or not _is_bot_alive(bot) or not bot.is_authenticated:
                with db.get_db() as conn:
                    cur = conn.cursor()
                    if job.create_if_missing:
                        cur.execute(
                            "UPDATE linkedin_contacts SET salesforce_sync_status = 'failed_auth' WHERE id = ?",
                            (job.contact_id,),
                        )
                    else:
                        _requeue(job.contact_id, create_if_missing=False)
                if task_id:
                    await workflow_task_manager.fail_inline(
                        task_id,
                        code="salesforce_auth_failed",
                        message="Salesforce bot not authenticated after reauth.",
                        retry_suggestion="Retry auth and run again.",
                        stage="failed_auth",
                        diagnostics={"contact_id": job.contact_id, "query": job.name},
                    )
                return
            set_active_browser_page(bot.page)
            await _ensure_salesforce_navigation(bot)

        if job.create_if_missing:
            with db.get_db() as conn:
                cur = conn.cursor()
                cur.execute(
                    """
                    SELECT name, company_name, title, email_generated, phone, domain
                    FROM linkedin_contacts
                    WHERE id = ?
                    """,
                    (job.contact_id,),
                )
                row = cur.fetchone()
            if not row:
                if task_id:
                    await workflow_task_manager.fail_inline(
                        task_id,
                        code="contact_not_found",
                        message="Contact not found for Salesforce create job.",
                        stage="failed_missing_contact",
                        diagnostics={"contact_id": job.contact_id, "query": job.name},
                    )
                return
            item = dict(row)
            full_name = (item.get("name") or "").strip()
            company_name = (item.get("company_name") or "").strip()
            email_generated = (item.get("email_generated") or "").strip()
            first_name = None
            last_name = None
            if full_name:
                parts = full_name.split()
                first_name = parts[0] if len(parts) > 1 else None
                last_name = parts[-1] if len(parts) > 1 else parts[0]

            # Guard 1: local duplicate suppression.
            local_url, local_reason = _find_existing_contact_salesforce_url(
                contact_id=job.contact_id,
                full_name=full_name,
                company_name=company_name,
                email=email_generated,
            )
            if local_url:
                with db.get_db() as conn:
                    cur = conn.cursor()
                    cur.execute(
                        "UPDATE linkedin_contacts SET salesforce_url = ?, salesforce_sync_status = 'success' WHERE id = ?",
                        (local_url, job.contact_id),
                    )
                if task_id:
                    await workflow_task_manager.finish_inline(
                        task_id,
                        result={
                            "ok": True,
                            "status": "reused_existing_local",
                            "matched_by": local_reason,
                            "url": local_url,
                            "contact_id": job.contact_id,
                        },
                        stage="salesforce_existing_local",
                        progress_pct=100,
                        diagnostics={"contact_id": job.contact_id, "query": job.name, "tab_id": "salesforce"},
                    )
                return

            # Guard 2: Salesforce pre-create lookup suppression.
            existing_url, matched_by = await _find_existing_lead_in_salesforce(
                bot=bot,
                full_name=full_name,
                email=email_generated,
                phone=(item.get("phone") or "").strip(),
                company_name=company_name,
            )
            if existing_url:
                with db.get_db() as conn:
                    cur = conn.cursor()
                    cur.execute(
                        "UPDATE linkedin_contacts SET salesforce_url = ?, salesforce_sync_status = 'success' WHERE id = ?",
                        (existing_url, job.contact_id),
                    )
                if task_id:
                    await workflow_task_manager.finish_inline(
                        task_id,
                        result={
                            "ok": True,
                            "status": "reused_existing_salesforce",
                            "matched_by": matched_by,
                            "url": existing_url,
                            "contact_id": job.contact_id,
                        },
                        stage="salesforce_existing_remote",
                        progress_pct=100,
                        diagnostics={"contact_id": job.contact_id, "query": job.name, "tab_id": "salesforce"},
                    )
                return

            description = _build_inbound_description(job.contact_id)
            url = await bot.create_or_update_lead(
                first_name=first_name,
                last_name=last_name or "Lead",
                company=(company_name or "Inbound Lead"),
                title=(item.get("title") or None),
                email=(email_generated or None),
                phone=(item.get("phone") or None),
                website=(f"https://{item.get('domain')}" if item.get("domain") else None),
                description=description,
                lead_source="Small Business Expo",
            )
            if url == "duplicate://detected":
                with db.get_db() as conn:
                    cur = conn.cursor()
                    cur.execute(
                        "UPDATE linkedin_contacts SET salesforce_sync_status = 'skipped_duplicate' WHERE id = ?",
                        (job.contact_id,),
                    )
                if task_id:
                    await workflow_task_manager.finish_inline(
                        task_id,
                        result={
                            "ok": True,
                            "status": "skipped_duplicate",
                            "contact_id": job.contact_id,
                        },
                        stage="salesforce_duplicate_detected",
                        progress_pct=100,
                        diagnostics={"contact_id": job.contact_id, "query": job.name, "tab_id": "salesforce"},
                    )
                return
            resolved_url = bot.resolve_lead_record_url(url)
            if not resolved_url:
                # Give Lightning a short moment to settle and try once more.
                try:
                    await asyncio.sleep(1.0)
                except Exception:
                    pass
                resolved_url = bot.resolve_lead_record_url(url)
            if not resolved_url:
                # Fallback: decode one.app search state (base64 hash) and
                # resolve the created lead from search results.
                fallback_queries = [
                    (item.get("email_generated") or "").strip(),
                    full_name,
                    (item.get("company_name") or "").strip(),
                ]
                resolved_url = await bot.resolve_lead_url_from_search_context(
                    candidate_url=url,
                    preferred_name=full_name,
                    fallback_queries=fallback_queries,
                )
            with db.get_db() as conn:
                cur = conn.cursor()
                if resolved_url:
                    cur.execute(
                        "UPDATE linkedin_contacts SET salesforce_url = ?, salesforce_sync_status = 'success' WHERE id = ?",
                        (resolved_url, job.contact_id),
                    )
                    if task_id:
                        await workflow_task_manager.finish_inline(
                            task_id,
                            result={"ok": True, "url": resolved_url, "contact_id": job.contact_id},
                            stage="salesforce_created",
                            progress_pct=100,
                            diagnostics={"contact_id": job.contact_id, "query": job.name, "tab_id": "salesforce"},
                        )
                else:
                    cur.execute(
                        "UPDATE linkedin_contacts SET salesforce_sync_status = 'failed' WHERE id = ?",
                        (job.contact_id,),
                    )
                    if task_id:
                        await workflow_task_manager.fail_inline(
                            task_id,
                            code="salesforce_create_failed",
                            message="Salesforce lead create returned no URL.",
                            retry_suggestion="Retry and inspect Salesforce automation logs.",
                            stage="failed_create",
                            diagnostics={"contact_id": job.contact_id, "query": job.name},
                        )
            return

        # URL-only lookup mode: resolve via direct one.app search URL, no global-search typing.
        url = await bot.resolve_lead_url_from_search_context(
            candidate_url=None,
            preferred_name=job.name,
            fallback_queries=[job.name],
        )
        if not url:
            with db.get_db() as conn:
                cur = conn.cursor()
                cur.execute(
                    "UPDATE linkedin_contacts SET salesforce_status = 'not_found' WHERE id = ?",
                    (job.contact_id,),
                )
            return

        with db.get_db() as conn:
            cur = conn.cursor()
            cur.execute(
                "UPDATE linkedin_contacts SET salesforce_url = ?, salesforce_status = 'uploaded' WHERE id = ?",
                (url, job.contact_id),
            )

    except Exception as exc:
        print(f"[SF Queue] Error during processing: {exc}")
        if job.create_if_missing:
            with db.get_db() as conn:
                cur = conn.cursor()
                cur.execute(
                    "UPDATE linkedin_contacts SET salesforce_sync_status = 'failed' WHERE id = ?",
                    (job.contact_id,),
                )
            if task_id:
                await workflow_task_manager.fail_inline(
                    task_id,
                    code="salesforce_queue_exception",
                    message=str(exc),
                    retry_suggestion="Retry job and check bridge/browser health.",
                    stage="failed_exception",
                    diagnostics={"contact_id": job.contact_id, "query": job.name},
                )
        else:
            _requeue(job.contact_id, create_if_missing=False)
    finally:
        try:
            set_active_browser_page(None)
        except Exception:
            pass
        await broadcast_event(
            "browser_automation_stop",
            {"action": "salesforce_create" if job.create_if_missing else "salesforce_lookup"},
        )


async def _ensure_salesforce_navigation(bot) -> None:
    """
    Recover from blank tabs by forcing navigation to Salesforce login.
    This prevents "queued" jobs from appearing idle with an empty address bar.
    """
    try:
        page = bot.page
        url = (str(getattr(page, "url", "") or "")).strip().lower()
        if url in {"", "about:blank", "data:,"}:
            await page.goto("https://login.salesforce.com", timeout=20_000)
            try:
                await page.wait_for_load_state("domcontentloaded", timeout=10_000)
            except Exception:
                pass
            print("[SF Queue] Recovered blank page by navigating to login.salesforce.com")
    except Exception as exc:
        print(f"[SF Queue] Blank-page recovery navigation failed: {exc}")
