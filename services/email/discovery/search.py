"""Search helpers for email discovery."""

from typing import Dict

from services.search.web_search import tavily_search_sync


def search_company_emails(company_name: str, domain: str = None) -> Dict:
    """
    Search the web for email pattern information about a company.
    """
    if domain and "." in domain:
        query = f"{company_name} email format @{domain} contact"
    else:
        query = f"{company_name} employee email format pattern contact"

    try:
        return tavily_search_sync(
            query=query,
            search_depth="basic",
            include_answer=True,
            max_results=5,
        )
    except Exception as e:
        print(f"[EmailDiscoverer] Search error for {company_name}: {e}")
        return {"error": str(e), "results": []}

