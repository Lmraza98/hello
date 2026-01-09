"""
Configuration for the outreach system.
All settings can be overridden via environment variables.
"""
import os
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()

# Paths
BASE_DIR = Path(__file__).parent
DATA_DIR = BASE_DIR / "data"
PAGES_DIR = DATA_DIR / "pages"
SCREENSHOTS_DIR = DATA_DIR / "screenshots"
DB_PATH = DATA_DIR / "outreach.db"

# Ensure directories exist
DATA_DIR.mkdir(exist_ok=True)
PAGES_DIR.mkdir(exist_ok=True)
SCREENSHOTS_DIR.mkdir(exist_ok=True)

# Salesforce
SALESFORCE_URL = os.getenv("SALESFORCE_URL", "https://login.salesforce.com")
SALESFORCE_STORAGE_STATE = DATA_DIR / "salesforce_auth.json"

# LLM Settings
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
LLM_MODEL = os.getenv("LLM_MODEL", "gpt-4o-mini")  # Cost-effective for extraction
LLM_MODEL_SMART = os.getenv("LLM_MODEL_SMART", "gpt-4o")  # For complex reasoning

# Web Search (Tavily - get free key at https://tavily.com)
TAVILY_API_KEY = os.getenv("TAVILY_API_KEY", "")
LLM_MAX_INPUT_TOKENS = 800  # Aggressive trim
LLM_MAX_OUTPUT_TOKENS = 500  # Need enough for full JSON schema

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
LINKEDIN_WORKERS = 3         # LinkedIn workers (keep LOW to avoid rate limits!)
HEADLESS_MODE = False        # Set True for background operation (after auth)
AUTH_TIMEOUT_MINUTES = 15    # How long to wait for Salesforce login
LINKEDIN_TIMEOUT_MINUTES = 15  # How long to wait for LinkedIn login

# Templates
DEFAULT_SUBJECT_TEMPLATE = "Quick question for {company}"
DEFAULT_BODY_TEMPLATE = """{personalization}

I help companies like {company} {value_prop}.

Would it make sense to have a brief call this week to see if there's a fit?

Best,
{sender_name}

{opt_out_line}"""

OPT_OUT_LINE = "Reply 'unsubscribe' to opt out of future messages."

# Sender info (customize in .env)
SENDER_NAME = os.getenv("SENDER_NAME", "Your Name")
VALUE_PROP = os.getenv("VALUE_PROP", "streamline their outreach")

