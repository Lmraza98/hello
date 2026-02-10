"""
Microsoft Graph API Authentication — MSAL interactive login with token caching.

Uses device-code flow. Tokens are cached to disk and refreshed automatically.
A background thread handles the blocking MSAL poll so no HTTP endpoint blocks.
"""
import atexit
import threading
from typing import Optional, Dict

import msal

import config


# Module-level singletons
_app: Optional[msal.PublicClientApplication] = None
_token_cache: Optional[msal.SerializableTokenCache] = None

# Auth flow state
_auth_thread: Optional[threading.Thread] = None
_auth_error: Optional[str] = None


def _get_token_cache() -> msal.SerializableTokenCache:
    """Load or create a persistent token cache."""
    global _token_cache
    if _token_cache is not None:
        return _token_cache

    _token_cache = msal.SerializableTokenCache()

    cache_path = config.MS_GRAPH_TOKEN_CACHE_PATH
    if cache_path.exists():
        try:
            _token_cache.deserialize(cache_path.read_text())
        except Exception as e:
            print(f"[GraphAuth] Warning: could not load token cache: {e}")

    def _save_cache():
        if _token_cache and _token_cache.has_state_changed:
            try:
                config.MS_GRAPH_TOKEN_CACHE_PATH.write_text(_token_cache.serialize())
            except Exception:
                pass

    atexit.register(_save_cache)
    return _token_cache


def _save_cache_now():
    """Immediately persist the token cache to disk."""
    cache = _get_token_cache()
    try:
        config.MS_GRAPH_TOKEN_CACHE_PATH.write_text(cache.serialize())
        print("[GraphAuth] Token cache saved to disk.")
    except Exception as e:
        print(f"[GraphAuth] Failed to save token cache: {e}")


def _get_app() -> msal.PublicClientApplication:
    """Get or create the MSAL public-client application."""
    global _app
    if _app is not None:
        return _app

    authority = f"https://login.microsoftonline.com/{config.MS_GRAPH_TENANT_ID}"
    _app = msal.PublicClientApplication(
        client_id=config.MS_GRAPH_CLIENT_ID,
        authority=authority,
        token_cache=_get_token_cache(),
    )
    return _app


def get_access_token(interactive: bool = False) -> Optional[str]:
    """
    Return a valid Graph API access token, or None if not authenticated.
    """
    app = _get_app()
    scopes = config.MS_GRAPH_SCOPES

    accounts = app.get_accounts()
    if accounts:
        result = app.acquire_token_silent(scopes, account=accounts[0])
        if result and "access_token" in result:
            return result["access_token"]

    if not interactive:
        return None

    # CLI-only interactive flow
    flow = app.initiate_device_flow(scopes=scopes)
    if "user_code" not in flow:
        return None

    print(f"\nGo to: {flow['verification_uri']}")
    print(f"Enter: {flow['user_code']}\n")

    result = app.acquire_token_by_device_flow(flow)
    if "access_token" in result:
        _save_cache_now()
        return result["access_token"]
    return None


def _run_device_flow_thread(flow: Dict):
    """Background thread that blocks on acquire_token_by_device_flow.
    When the user completes sign-in at microsoft.com/devicelogin,
    MSAL returns the token and we save it to the cache."""
    global _auth_thread, _auth_error
    app = _get_app()

    print("[GraphAuth] Background thread: waiting for user to complete sign-in...")
    try:
        result = app.acquire_token_by_device_flow(flow)

        if "access_token" in result:
            _save_cache_now()
            account = result.get("id_token_claims", {}).get("preferred_username", "unknown")
            print(f"[GraphAuth] Authentication successful! Account: {account}")
            _auth_error = None
        else:
            err = result.get("error_description", result.get("error", "Unknown error"))
            print(f"[GraphAuth] Authentication failed: {err}")
            _auth_error = err
    except Exception as e:
        print(f"[GraphAuth] Background thread error: {e}")
        import traceback
        traceback.print_exc()
        _auth_error = str(e)
    finally:
        _auth_thread = None
        print("[GraphAuth] Background thread finished.")


def initiate_auth() -> Dict:
    """
    Start a device-code auth flow. Returns verification_uri + user_code.
    Spins up a daemon background thread that waits for sign-in completion.
    """
    global _auth_thread, _auth_error
    app = _get_app()
    scopes = config.MS_GRAPH_SCOPES

    # Already authenticated?
    accounts = app.get_accounts()
    if accounts:
        result = app.acquire_token_silent(scopes, account=accounts[0])
        if result and "access_token" in result:
            return {
                "success": True,
                "already_authenticated": True,
                "account": accounts[0].get("username"),
            }

    # Already have a flow running?
    if _auth_thread and _auth_thread.is_alive():
        return {
            "success": False,
            "error": "Auth flow already in progress. Complete sign-in or wait for it to expire.",
        }

    # Initiate device-code flow
    flow = app.initiate_device_flow(scopes=scopes)
    if "user_code" not in flow:
        return {
            "success": False,
            "error": flow.get("error_description", "Failed to initiate device flow"),
        }

    # Start background thread to wait for completion
    _auth_error = None
    _auth_thread = threading.Thread(
        target=_run_device_flow_thread,
        args=(flow,),
        daemon=True,  # Won't prevent process exit
        name="graph-auth-device-flow",
    )
    _auth_thread.start()

    print(f"[GraphAuth] Device-code flow started. Code: {flow['user_code']}")

    return {
        "success": True,
        "verification_uri": flow.get("verification_uri"),
        "user_code": flow.get("user_code"),
        "message": flow.get("message"),
        "expires_in": flow.get("expires_in", 900),
    }


def is_authenticated() -> bool:
    """Check whether we have a cached token (without prompting)."""
    return get_access_token(interactive=False) is not None


def is_auth_in_progress() -> bool:
    """Check if there's an active device-code flow running in background."""
    return _auth_thread is not None and _auth_thread.is_alive()


def get_auth_status() -> Dict:
    """Return a status dict for the API. This is FAST — no blocking calls."""
    app = _get_app()
    accounts = app.get_accounts()
    authenticated = False

    # Try silent token acquisition (uses cache, no network call)
    if accounts:
        result = app.acquire_token_silent(config.MS_GRAPH_SCOPES, account=accounts[0])
        if result and "access_token" in result:
            authenticated = True

    return {
        "authenticated": authenticated,
        "account": accounts[0]["username"] if accounts else None,
        "client_id": config.MS_GRAPH_CLIENT_ID[:8] + "...",
        "tenant_id": config.MS_GRAPH_TENANT_ID[:8] + "...",
        "auth_in_progress": is_auth_in_progress(),
        "auth_error": _auth_error,
    }


def logout():
    """Clear cached tokens."""
    global _app, _token_cache, _auth_error
    if config.MS_GRAPH_TOKEN_CACHE_PATH.exists():
        config.MS_GRAPH_TOKEN_CACHE_PATH.unlink()
    _app = None
    _token_cache = None
    _auth_error = None
    print("[GraphAuth] Logged out – token cache cleared.")
