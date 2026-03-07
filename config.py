"""
Configuration for the outreach system.
All settings can be overridden via environment variables.
"""
import os
import json
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()

# Paths
BASE_DIR = Path(__file__).parent
DATA_DIR = BASE_DIR / "data"
PAGES_DIR = DATA_DIR / "pages"
SCREENSHOTS_DIR = DATA_DIR / "screenshots"
DB_PATH = DATA_DIR / "outreach.db"
BROWSER_SKILLS_DIR = Path(
    os.getenv("BROWSER_SKILLS_DIR", str(BASE_DIR / "skills" / "websites"))
)

# Ensure directories exist
DATA_DIR.mkdir(exist_ok=True)
PAGES_DIR.mkdir(exist_ok=True)
SCREENSHOTS_DIR.mkdir(exist_ok=True)
BROWSER_SKILLS_DIR.mkdir(parents=True, exist_ok=True)

# Salesforce
SALESFORCE_URL = os.getenv("SALESFORCE_URL", "https://login.salesforce.com")
SALESFORCE_STORAGE_STATE = DATA_DIR / "salesforce_auth.json"
SALESFORCE_NEW_LEAD_URL = os.getenv("SALESFORCE_NEW_LEAD_URL", "").strip()
# Optional semicolon-separated defaults appended to Salesforce defaultFieldValues.
# Example:
# SALESFORCE_DEFAULT_FIELD_VALUES=Lead_Country__c=United States;Inbound_Outbound__c=Inbound
SALESFORCE_DEFAULT_FIELD_VALUES = os.getenv("SALESFORCE_DEFAULT_FIELD_VALUES", "").strip()
SALESFORCE_SESSION_MAX_AGE_HOURS = float(os.getenv("SALESFORCE_SESSION_MAX_AGE_HOURS", "0") or "0")
LEADFORGE_ENABLE = os.getenv("LEADFORGE_ENABLE", "1").strip().lower() in {"1", "true", "yes", "on"}
LEADFORGE_SALESFORCE_ENABLED = os.getenv("LEADFORGE_SALESFORCE_ENABLED", "0").strip().lower() in {
    "1",
    "true",
    "yes",
    "on",
}
LEADFORGE_TRACE_VERBOSITY = os.getenv("LEADFORGE_TRACE_VERBOSITY", "full").strip().lower()
LEADFORGE_SOURCES_TAVILY = os.getenv("LEADFORGE_SOURCES_TAVILY", "1").strip().lower() in {"1", "true", "yes", "on"}
LEADFORGE_SOURCES_MAPS = os.getenv("LEADFORGE_SOURCES_MAPS", "1").strip().lower() in {"1", "true", "yes", "on"}
LEADFORGE_SOURCES_LICENSES = os.getenv("LEADFORGE_SOURCES_LICENSES", "1").strip().lower() in {"1", "true", "yes", "on"}
LEADFORGE_SOURCES_REVIEWS = os.getenv("LEADFORGE_SOURCES_REVIEWS", "1").strip().lower() in {"1", "true", "yes", "on"}
LEADFORGE_SOURCES_JOBS = os.getenv("LEADFORGE_SOURCES_JOBS", "1").strip().lower() in {"1", "true", "yes", "on"}
LEADFORGE_SOURCES_FIRECRAWL = os.getenv("LEADFORGE_SOURCES_FIRECRAWL", "1").strip().lower() in {
    "1",
    "true",
    "yes",
    "on",
}
LEADFORGE_FREE_LEADS_PER_MONTH = max(0, int(os.getenv("LEADFORGE_FREE_LEADS_PER_MONTH", "100") or "100"))
LEADFORGE_DEFAULT_USER_ID = os.getenv("LEADFORGE_DEFAULT_USER_ID", "local").strip() or "local"
LEADFORGE_HUBSPOT_WEBHOOK_URL = os.getenv("LEADFORGE_HUBSPOT_WEBHOOK_URL", "").strip()
LEADFORGE_PIPEDRIVE_WEBHOOK_URL = os.getenv("LEADFORGE_PIPEDRIVE_WEBHOOK_URL", "").strip()

# LLM Settings
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
LLM_MODEL = os.getenv("LLM_MODEL", "gemma3:12b")  # Local/default model for standard tasks
LLM_MODEL_SMART = os.getenv("LLM_MODEL_SMART", "qwen2.5:32b-instruct")  # Local/default model for complex reasoning

# Web Search (SearXNG - self-hosted search engine)
SEARXNG_URL = os.getenv("SEARXNG_URL", "http://localhost:8080")
# Legacy Tavily support (if you want to use Tavily instead)
TAVILY_API_KEY = os.getenv("TAVILY_API_KEY", "")
TAVILY_ENABLED = os.getenv("TAVILY_ENABLED", "false").strip().lower() == "true"
TAVILY_COST_PER_REQUEST_USD = float(os.getenv("TAVILY_COST_PER_REQUEST_USD", "0.005"))
LLM_MAX_INPUT_TOKENS = 800  # Aggressive trim
LLM_MAX_OUTPUT_TOKENS = 500  # Need enough for full JSON schema

# Cost monitoring config
_openai_pricing_default = {
    # USD per 1M tokens
    "gpt-4o": {"input_per_1m": 5.0, "output_per_1m": 15.0},
    "gpt-4o-mini": {"input_per_1m": 0.15, "output_per_1m": 0.6},
}
try:
    OPENAI_PRICING_USD_PER_1M = json.loads(
        os.getenv("OPENAI_PRICING_USD_PER_1M_JSON", json.dumps(_openai_pricing_default))
    )
except Exception:
    OPENAI_PRICING_USD_PER_1M = _openai_pricing_default

# Crawler Settings
MAX_PAGES_PER_DOMAIN = 8
RENDER_TIMEOUT_MS = 15000
REQUEST_TIMEOUT_SECONDS = 10
USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"

# Contact page patterns
CONTACT_PAGE_SLUGS = [
    "/about", "/about-us", "/team", "/our-team", "/leadership",
    "/company", "/contact", "/contact-us", "/people", "/staff",
    "/management", "/executives", "/founders"
]
CONTACT_ANCHOR_KEYWORDS = [
    "team", "leadership", "contact", "about", "staff", "people",
    "management", "founders", "company", "meet"
]

# Scoring thresholds
MIN_CONFIDENCE_TO_SEND = 0.6
MIN_FIT_SCORE_TO_SEND = 0.5

# Volume limits
DAILY_SEND_LIMIT = 250
LLM_CALLS_PER_DAY_CAP = 200  # Hard cap to stay under budget

# Parallel processing
NUM_BROWSER_WORKERS = 30     # Salesforce workers (can handle higher volume)
LINKEDIN_WORKERS = 2         # LinkedIn workers (2-3 is usually safe)
HEADLESS_MODE = False        # Set True for background operation (after auth)
AUTH_TIMEOUT_MINUTES = 15    # How long to wait for Salesforce login
LINKEDIN_TIMEOUT_MINUTES = 15  # How long to wait for LinkedIn login
SALESNAV_INIT_SCRIPT_ENABLED = os.getenv("SALESNAV_INIT_SCRIPT_ENABLED", "true").strip().lower() == "true"
SALESNAV_STEALTH_ARGS_ENABLED = os.getenv("SALESNAV_STEALTH_ARGS_ENABLED", "true").strip().lower() == "true"
SALESNAV_SLOW_MO_MS = int(os.getenv("SALESNAV_SLOW_MO_MS", "100"))
SALESNAV_PACING_BASE_SECONDS = float(os.getenv("SALESNAV_PACING_BASE_SECONDS", "0.8"))
SALESNAV_PACING_VARIANCE_SECONDS = float(os.getenv("SALESNAV_PACING_VARIANCE_SECONDS", "0.3"))
SALESNAV_PACING_MIN_SECONDS = float(os.getenv("SALESNAV_PACING_MIN_SECONDS", "0.1"))
SALESNAV_PACING_MAX_SECONDS = float(os.getenv("SALESNAV_PACING_MAX_SECONDS", "5.0"))

# Templates
DEFAULT_SUBJECT_TEMPLATE = "Quick question for {company}"
DEFAULT_BODY_TEMPLATE = """{personalization}

I help companies like {company} {value_prop}.

Would it make sense to have a brief call this week to see if there's a fit?"""

OPT_OUT_LINE = "Reply 'unsubscribe' to opt out of future messages."

# Sender info (customize in .env)
SENDER_NAME = os.getenv("SENDER_NAME", "Your Name")
VALUE_PROP = os.getenv("VALUE_PROP", "streamline their outreach")

# Microsoft Graph API (Outlook reply monitoring)
MS_GRAPH_CLIENT_ID = os.getenv("MS_GRAPH_CLIENT_ID", "32547efa-377d-44b7-95de-29664cf800d6")
MS_GRAPH_TENANT_ID = os.getenv("MS_GRAPH_TENANT_ID", "5b9e54d1-e719-4b6e-a4e4-5afb715bbe7e")
MS_GRAPH_SCOPES = ["Mail.Read"]
MS_GRAPH_TOKEN_CACHE_PATH = DATA_DIR / "ms_graph_token_cache.json"

# Phone Discovery APIs
TWILIO_ACCOUNT_SID = os.getenv("TWILIO_ACCOUNT_SID", "")
TWILIO_AUTH_TOKEN = os.getenv("TWILIO_AUTH_TOKEN", "")
# PhoneInfoga is CLI-based, no API key needed

# Hybrid search vector backend selector: auto | sqlite_vec | fallback
VECTOR_BACKEND = os.getenv("VECTOR_BACKEND", "auto").strip().lower()

# Entity search refresh policy on read: missing | stale | off
ENTITY_SEARCH_REFRESH_MODE = os.getenv("ENTITY_SEARCH_REFRESH_MODE", "missing").strip().lower()
