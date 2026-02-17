"""Salesforce automation services — bot, auth, pages, credentials, upload, bulk import."""
from services.salesforce.bot import SalesforceBot
from services.salesforce.pages import GlobalSearch, LeadPage, EmailComposer, ActivityTimeline
from services.salesforce.credentials import get_credentials, credentials_configured, save_credentials, clear_credentials
from services.salesforce.auth_manager import (
    get_shared_bot, stop_shared_bot, get_auth_status, trigger_reauth,
    is_reauth_in_progress, start_session_health_worker, stop_session_health_worker,
    SalesforceAuthStatus,
)
from services.salesforce.lookup_queue import (
    enqueue_salesforce_lookup, start_salesforce_lookup_worker, stop_salesforce_lookup_worker,
)
