"""Sales Navigator scraper compatibility module.

The implementation is split by concern:
- `scraper_core.py`: core Playwright scraper class
- `workflows.py`: high-level workflow helpers
"""

from services.web_automation.linkedin.scraper_core import SalesNavigatorScraper
from services.web_automation.linkedin.workflows import scrape_linkedin_for_domain

__all__ = [
    "SalesNavigatorScraper",
    "scrape_linkedin_for_domain",
]
