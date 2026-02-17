"""Versioned selector registry for Sales Navigator scraping."""


class SEL:
    SALES_HOME_URL = "https://www.linkedin.com/sales/home"
    ACCOUNT_SEARCH_URL = "https://www.linkedin.com/sales/search/company"

    SALES_SEARCH_INPUT = 'input[placeholder*="Search"]'
    ACCOUNT_SEARCH_TAB = 'button:has-text("Account"), button:has-text("Accounts")'
    DECISION_MAKERS_ENTRY = (
        'a:has-text("Decision maker"), '
        'a:has-text("decision maker"), '
        'button:has-text("Decision maker"), '
        '[data-test*="decision"], '
        'a:has-text("View decision")'
    )

    RESULTS_CONTAINER = "#search-results-container, [data-view-name='search-results-container']"
    LEAD_CARD = '[data-x-search-result="LEAD"]'
    COMPANY_CARD = '[data-x-search-result="COMPANY"], li[data-x-search-result="COMPANY"]'
    COMPANY_LINK = 'a[href*="/sales/company/"]'

    AUTH_LOGIN_FORM = 'input[name="session_key"], form[action*="login"], [data-id="sign-in-form"]'
    AUTH_WALL = '[data-test-id="authwall"], [data-test-id="checkpoint"]'

