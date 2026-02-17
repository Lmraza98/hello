"""
Salesforce session health management and re-authentication.

This module provides:
1. Session health polling (periodic check via storage state, NO browser)
2. Re-authentication triggering with auto-fill of credentials
3. Chat notifications when session expires

Design:
- Health checks are LIGHTWEIGHT: inspect the storage state file, never open a browser.
- A browser is only created when explicitly needed (lookup or re-auth).
- The shared bot is persistent between lookups but is never created speculatively.
"""

from __future__ import annotations

import asyncio
import json
from datetime import datetime
from enum import Enum
from pathlib import Path
from typing import Optional

import config
from services.salesforce.credentials import get_credentials, credentials_configured
from services.salesforce.bot import SalesforceBot
from api.routes.browser_stream import (
    broadcast_event,
    get_active_browser_page,
    set_active_browser_page,
)


class SalesforceAuthStatus(Enum):
    AUTHENTICATED = "authenticated"
    EXPIRED = "expired"
    NOT_CONFIGURED = "not_configured"
    UNKNOWN = "unknown"


# ── Shared bot instance and state ────────────────────────────────────
_shared_bot: Optional[SalesforceBot] = None
_bot_lock = asyncio.Lock()
_auth_status: SalesforceAuthStatus = SalesforceAuthStatus.UNKNOWN
_last_auth_check: Optional[datetime] = None
_reauth_in_progress = False
_shutdown_event: Optional[asyncio.Event] = None
_health_task: Optional[asyncio.Task] = None

# Session health polling interval (15 minutes)
HEALTH_POLL_INTERVAL_SECONDS = 15 * 60
MIN_CHECK_INTERVAL_SECONDS = 60


# ── Shared bot lifecycle ─────────────────────────────────────────────

def _is_bot_alive(bot: SalesforceBot) -> bool:
    """Return True only if the bot's browser, context, and page are all usable."""
    try:
        if bot.browser is None or not bot.browser.is_connected():
            return False
        if bot.page is None or bot.page.is_closed():
            return False
        if bot.context is None:
            return False
        return True
    except Exception:
        return False


async def _kill_bot(bot: SalesforceBot) -> None:
    """Silently tear down a bot, ignoring errors."""
    try:
        await bot.stop()
    except Exception:
        pass
    # Extra safety: kill playwright process
    try:
        if bot.playwright:
            await bot.playwright.stop()
    except Exception:
        pass


async def get_shared_bot() -> Optional[SalesforceBot]:
    """
    Get or create the shared SalesforceBot instance.

    The bot is started **non-headless** so the user can see MFA prompts.
    If the browser was closed or crashed it is transparently recreated.
    """
    global _shared_bot

    async with _bot_lock:
        # ── Existing bot: verify liveness ──
        if _shared_bot is not None:
            if _is_bot_alive(_shared_bot):
                return _shared_bot
            # Dead — tear down and recreate
            print("[SF Auth] Shared bot is dead, cleaning up...")
            await _kill_bot(_shared_bot)
            _shared_bot = None

        # ── Create fresh bot ──
        print("[SF Auth] Creating new shared SalesforceBot...")
        bot = SalesforceBot()
        try:
            # start() opens browser + runs _check_auth which may auto-fill creds.
            # Use allow_manual_login=False so start() never blocks waiting for MFA.
            # We'll handle MFA separately in trigger_reauth().
            await bot.start(headless=False, allow_manual_login=False)
        except Exception as e:
            print(f"[SF Auth] Failed to start bot: {e}")
            await _kill_bot(bot)
            return None

        if not _is_bot_alive(bot):
            print("[SF Auth] Bot started but page is already dead")
            await _kill_bot(bot)
            return None

        _shared_bot = bot
        print(f"[SF Auth] Shared bot ready  (authenticated={bot.is_authenticated})")
        return _shared_bot


async def stop_shared_bot() -> None:
    """Stop and clean up the shared bot instance."""
    global _shared_bot

    async with _bot_lock:
        if _shared_bot is not None:
            await _kill_bot(_shared_bot)
            _shared_bot = None


# ── Auth status (lightweight, no browser) ────────────────────────────

async def get_auth_status() -> SalesforceAuthStatus:
    """
    Return the cached auth status, refreshing from the storage state file
    if the cached value is stale.

    **Never opens a browser.**
    """
    global _auth_status, _last_auth_check

    if not credentials_configured():
        return SalesforceAuthStatus.NOT_CONFIGURED

    now = datetime.now()
    if (
        _last_auth_check is None
        or (now - _last_auth_check).total_seconds() > MIN_CHECK_INTERVAL_SECONDS
    ):
        _auth_status = _check_storage_state_health()
        _last_auth_check = now

    return _auth_status


def _check_storage_state_health() -> SalesforceAuthStatus:
    """
    Inspect the Playwright storage-state JSON file to guess whether the
    session is likely still valid.

    Heuristic: if the file exists, is non-empty, and was modified within the
    last 24 hours we assume the session is probably good.  If the file is
    older than 24 h we assume it has likely expired.  If no file exists we
    report NOT_CONFIGURED.
    """
    storage_path: Path = config.SALESFORCE_STORAGE_STATE
    if not storage_path.exists():
        return SalesforceAuthStatus.NOT_CONFIGURED

    try:
        data = json.loads(storage_path.read_text(encoding="utf-8"))
        # Must have at least one cookie to be useful.
        cookies = data.get("cookies") or []
        if not cookies:
            return SalesforceAuthStatus.EXPIRED
    except Exception:
        return SalesforceAuthStatus.UNKNOWN

    # Check file age as rough expiry heuristic.
    try:
        mtime = datetime.fromtimestamp(storage_path.stat().st_mtime)
        age_hours = (datetime.now() - mtime).total_seconds() / 3600
        if age_hours > 24:
            return SalesforceAuthStatus.EXPIRED
    except Exception:
        pass

    # If the shared bot exists and has done a real check, trust that.
    if _shared_bot is not None and _is_bot_alive(_shared_bot):
        if _shared_bot.is_authenticated:
            return SalesforceAuthStatus.AUTHENTICATED
        else:
            return SalesforceAuthStatus.EXPIRED

    # File looks recent — optimistically assume it's valid.
    return SalesforceAuthStatus.AUTHENTICATED


def is_reauth_in_progress() -> bool:
    """Check if a re-authentication is currently in progress."""
    return _reauth_in_progress


# ── Re-authentication flow ───────────────────────────────────────────

async def trigger_reauth() -> bool:
    """
    Trigger interactive re-authentication:

    1. Get (or create) the shared bot
    2. Navigate to login.salesforce.com
    3. Auto-fill stored credentials
    4. Wait for user to complete MFA (visible in browser viewer)
    5. Save session on success

    Returns True on success.
    """
    global _reauth_in_progress, _auth_status, _shared_bot

    if _reauth_in_progress:
        print("[SF Auth] Re-auth already in progress")
        return False

    if not credentials_configured():
        print("[SF Auth] No credentials configured")
        return False

    creds = get_credentials()
    if not creds:
        print("[SF Auth] Could not load credentials")
        return False

    _reauth_in_progress = True

    try:
        await broadcast_event("browser_automation_start", {
            "action": "salesforce_reauth",
            "message": "Authenticating to Salesforce...",
        })

        bot = await get_shared_bot()
        if bot is None or not _is_bot_alive(bot):
            print("[SF Auth] Could not obtain a live bot")
            await broadcast_event("salesforce_auth_failed", {
                "message": "Could not start browser — try again",
            })
            return False

        # Show the page in the browser viewer
        set_active_browser_page(bot.page)

        # Navigate to the login page
        try:
            print("[SF Auth] Navigating to login.salesforce.com")
            await bot.page.goto("https://login.salesforce.com", timeout=20_000)
            await bot.page.wait_for_load_state("networkidle", timeout=15_000)
        except Exception as e:
            print(f"[SF Auth] Navigation error: {e}")
            # Check if the page is still alive after the error
            if not _is_bot_alive(bot):
                print("[SF Auth] Bot died during navigation, resetting")
                await _kill_bot(bot)
                _shared_bot = None
                await broadcast_event("salesforce_auth_failed", {
                    "message": "Browser crashed — try again",
                })
                return False

        # Are we on the login page?
        url = bot.page.url.lower()
        auth_pages = ["login", "secur", "verification", "identity"]

        if any(p in url for p in auth_pages):
            print(f"[SF Auth] On login page, auto-filling for {creds['username']}")
            success = await _autofill_login(bot, creds["username"], creds["password"])

            if success:
                result = await _wait_for_auth_completion(bot)
                if result:
                    _auth_status = SalesforceAuthStatus.AUTHENTICATED
                    _last_auth_check = datetime.now()
                    await broadcast_event("salesforce_auth_success", {
                        "message": "Salesforce session restored",
                    })
                    return True
                else:
                    _auth_status = SalesforceAuthStatus.EXPIRED
                    await broadcast_event("salesforce_auth_failed", {
                        "message": "Login failed or timed out",
                    })
                    return False
            else:
                await broadcast_event("salesforce_auth_failed", {
                    "message": "Could not auto-fill login form",
                })
                return False
        else:
            # Might already be authenticated (session was valid after all)
            try:
                lightning = bot.page.locator(".slds-global-header, .oneGlobalNav")
                if await lightning.count() > 0:
                    bot.is_authenticated = True
                    _auth_status = SalesforceAuthStatus.AUTHENTICATED
                    _last_auth_check = datetime.now()
                    await broadcast_event("salesforce_auth_success", {
                        "message": "Salesforce session is already active",
                    })
                    return True
            except Exception:
                pass
            print(f"[SF Auth] Unexpected page: {bot.page.url}")
            return False

    except Exception as e:
        print(f"[SF Auth] Re-auth error: {e}")
        # If the bot is dead, clean it up
        if _shared_bot is not None and not _is_bot_alive(_shared_bot):
            await _kill_bot(_shared_bot)
            _shared_bot = None
        return False

    finally:
        _reauth_in_progress = False
        try:
            set_active_browser_page(None)
        except Exception:
            pass
        await broadcast_event("browser_automation_stop", {"action": "salesforce_reauth"})


async def _autofill_login(bot: SalesforceBot, username: str, password: str) -> bool:
    """
    Auto-fill the Salesforce login form.

    Handles the Salesforce "Saved Username" (LoginHint) feature where the
    username <input> is hidden and replaced by an identity card.  In that case
    we skip straight to the password field.

    Returns True if the Login button was clicked.
    """
    try:
        page = bot.page
        await asyncio.sleep(1.5)

        # Selectors in priority order
        username_sels = ["#username", "input[name='username']", "input[type='email']"]
        password_sels = ["input#password", "input[name='pw']", "input[type='password']"]
        login_sels = ["#Login", "input[name='Login']", "input[type='submit']", "button[type='submit']"]

        # ── Username ──
        # Salesforce may hide the username field when a "Saved Username" identity
        # card is showing.  In that case the hidden <input> already has the value,
        # so we can skip filling it.
        filled = False
        for sel in username_sels:
            try:
                field = page.locator(sel).first
                if await field.count() > 0:
                    if await field.is_visible():
                        # Normal visible field — click and fill
                        await field.click()
                        await field.fill(username)
                        filled = True
                        print(f"[SF Auth] Username filled ({sel})")
                        break
                    else:
                        # Hidden field (LoginHint/Saved Username mode).
                        # Check if it already contains the right value.
                        current_val = await field.input_value()
                        if current_val and current_val.strip():
                            filled = True
                            print(f"[SF Auth] Username already set via identity card: {current_val}")
                            break
            except Exception as e:
                print(f"[SF Auth] Username {sel}: {e}")
        if not filled:
            print("[SF Auth] Could not find or verify username field")
            return False

        await asyncio.sleep(0.3)

        # ── Password ──
        filled = False
        for sel in password_sels:
            try:
                field = page.locator(sel).first
                if await field.count() > 0 and await field.is_visible():
                    await field.click()
                    await field.fill(password)
                    filled = True
                    print(f"[SF Auth] Password filled ({sel})")
                    break
            except Exception as e:
                print(f"[SF Auth] Password {sel}: {e}")
        if not filled:
            print("[SF Auth] Could not find password field")
            return False

        await asyncio.sleep(0.5)

        # ── Login button ──
        for sel in login_sels:
            try:
                btn = page.locator(sel).first
                if await btn.count() > 0 and await btn.is_visible():
                    await btn.click()
                    print(f"[SF Auth] Login clicked ({sel})")
                    return True
            except Exception as e:
                print(f"[SF Auth] Login btn {sel}: {e}")

        print("[SF Auth] Could not find login button")
        return False

    except Exception as e:
        print(f"[SF Auth] Auto-fill error: {e}")
        return False


async def _wait_for_auth_completion(bot: SalesforceBot, timeout_minutes: int = 5) -> bool:
    """Wait for auth to complete (MFA, redirect, etc.)."""
    timeout_seconds = timeout_minutes * 60
    start = datetime.now()
    mfa_keywords = ["verification", "identity", "mfa", "2fa", "toopher", "verify"]
    mfa_notified = False

    await asyncio.sleep(3)  # let the post-login redirect happen

    while (datetime.now() - start).total_seconds() < timeout_seconds:
        if not _is_bot_alive(bot):
            print("[SF Auth] Bot died while waiting for auth")
            return False

        try:
            url = bot.page.url.lower()

            # MFA page
            if any(kw in url for kw in mfa_keywords):
                if not mfa_notified:
                    await broadcast_event("salesforce_mfa_required", {
                        "message": "Complete MFA verification in the browser viewer",
                    })
                    mfa_notified = True
                elapsed = int((datetime.now() - start).total_seconds())
                print(f"[SF Auth] MFA required, waiting... ({elapsed}s)")
                await asyncio.sleep(3)
                continue

            # Still on login page — check for error
            if any(kw in url for kw in ["login", "secur"]):
                error = bot.page.locator(".loginError, #error, .error-message, .mb12.error")
                if await error.count() > 0:
                    error_text = await error.first.inner_text()
                    print(f"[SF Auth] Login error: {error_text}")
                    await broadcast_event("salesforce_auth_failed", {
                        "message": f"Login failed: {error_text[:120]}",
                    })
                    return False
                await asyncio.sleep(2)
                continue

            # Lightning loaded → success
            if "lightning" in url:
                lightning = bot.page.locator(".slds-global-header, .oneGlobalNav")
                if await lightning.count() > 0:
                    bot.is_authenticated = True
                    await bot.context.storage_state(path=str(config.SALESFORCE_STORAGE_STATE))
                    print("[SF Auth] Authenticated — session saved")
                    return True

            await asyncio.sleep(2)

        except Exception as e:
            print(f"[SF Auth] Wait error: {e}")
            await asyncio.sleep(2)

    print(f"[SF Auth] Timeout after {timeout_minutes}min")
    return False


# ── Session health worker (lightweight, no browser) ──────────────────

async def start_session_health_worker() -> None:
    """Start the background session health polling task."""
    global _health_task, _shutdown_event

    if _health_task and not _health_task.done():
        return

    _shutdown_event = asyncio.Event()
    _health_task = asyncio.create_task(_session_health_loop(), name="sf_health")
    print("[SF Auth] Session health worker started")


async def stop_session_health_worker() -> None:
    """Stop the session health worker and shared bot."""
    global _health_task, _shutdown_event

    if _shutdown_event:
        _shutdown_event.set()

    if _health_task:
        try:
            await asyncio.wait_for(_health_task, timeout=5)
        except Exception:
            _health_task.cancel()
        _health_task = None

    _shutdown_event = None
    await stop_shared_bot()
    print("[SF Auth] Session health worker stopped")


async def _session_health_loop() -> None:
    """
    Periodically check session health by inspecting the storage state file.
    **Never opens a browser** — only reads a JSON file.
    """
    assert _shutdown_event is not None

    # Delay first check so the app can finish starting up.
    await asyncio.sleep(30)

    while not _shutdown_event.is_set():
        try:
            # Sleep for the poll interval (or until shutdown).
            try:
                await asyncio.wait_for(
                    _shutdown_event.wait(), timeout=HEALTH_POLL_INTERVAL_SECONDS
                )
                break  # shutdown requested
            except asyncio.TimeoutError:
                pass

            if not credentials_configured():
                continue

            if _reauth_in_progress:
                continue

            status = _check_storage_state_health()
            print(f"[SF Auth] Health check: {status.value}")

            if status == SalesforceAuthStatus.EXPIRED:
                await broadcast_event("salesforce_session_expired", {
                    "message": "Your Salesforce session has expired. Re-authenticate in Settings or via chat.",
                })

        except Exception as e:
            print(f"[SF Auth] Health check error: {e}")
