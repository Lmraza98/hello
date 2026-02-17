"""High-level scraper workflows."""

from typing import Any


async def scrape_linkedin_for_domain(domain: str, company_name: str | None = None) -> dict[str, Any]:
    """
    Convenience function to scrape LinkedIn for a single domain.
    """
    from services.linkedin.scraper_core import SalesNavigatorScraper

    scraper = SalesNavigatorScraper()
    try:
        await scraper.start(headless=False)
        if not await scraper.ensure_authenticated(interactive=True):
            return {
                "status": "auth_required",
                "error": "Login timeout",
                "company_name": company_name or domain.split(".")[0],
                "domain": domain,
                "employees": [],
            }

        target_company_name = company_name or domain.split(".")[0]
        return await scraper.scrape_company_contacts_raw(target_company_name, domain)
    except Exception as exc:
        return {
            "status": "error",
            "error": str(exc),
            "company_name": company_name or domain.split(".")[0],
            "domain": domain,
            "employees": [],
        }
    finally:
        await scraper.stop()
