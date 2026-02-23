import asyncio

from services.web_automation.linkedin.salesnav.core.filters import (
    normalize_salesnav_company_url,
    normalize_salesnav_lead_url,
    similarity_score,
    split_bullet_text,
)
from services.web_automation.linkedin.salesnav.core.nav import SalesNavNavigator
from services.web_automation.linkedin.salesnav.core.operations import (
    _is_retryable_error,
    run_operation_with_retries,
)
from services.web_automation.linkedin.salesnav.core.parsing import (
    employee_display_to_int,
    expand_headcount_range_to_salesnav_options,
    parse_employee_text,
    parse_headcount_bucket,
)
from services.web_automation.linkedin.salesnav.core.session import (
    SalesNavSessionManager,
    is_salesnav_authenticated_url,
    is_salesnav_host,
)
from services.web_automation.linkedin.salesnav.core.waits import SalesNavWaits


def _run(coro):
    return asyncio.run(coro)


def test_session_host_and_auth_url_contract():
    assert is_salesnav_host("https://www.linkedin.com/sales/home")
    assert not is_salesnav_host("https://example.com/sales/home")

    assert is_salesnav_authenticated_url("https://www.linkedin.com/sales/search/company")
    assert not is_salesnav_authenticated_url("https://www.linkedin.com/login")
    assert not is_salesnav_authenticated_url("https://www.linkedin.com/sales/login")
    assert not is_salesnav_authenticated_url("https://www.linkedin.com/sales/search/company?checkpoint=true")


def test_session_manager_delegates_auth_check():
    manager = SalesNavSessionManager(scraper=object())
    assert manager.is_authenticated_url("https://www.linkedin.com/sales/search/company")
    assert not manager.is_authenticated_url("https://www.linkedin.com/login")


def test_filters_normalization_and_similarity_contract():
    raw = "Construction â€¢ 8.5K+ employees on LinkedIn"
    parts = split_bullet_text(raw)
    assert len(parts) == 2
    assert parts[0].startswith("Construction")
    assert "employees" in parts[1]

    assert normalize_salesnav_company_url(" https://www.linkedin.com/sales/company/123?foo=1#bar ") == "https://www.linkedin.com/sales/company/123"
    assert normalize_salesnav_lead_url("https://www.linkedin.com/sales/lead/abc,def?x=1") == "https://www.linkedin.com/sales/lead/abc,def"

    assert similarity_score("Healthcare", "health care") > 0.75


def test_parsing_contract_for_headcount_and_employee_text():
    assert parse_headcount_bucket("1,001-5,000") == (1001, 5000)
    assert parse_headcount_bucket("10,001+") == (10001, None)
    assert parse_headcount_bucket("nope") is None

    assert expand_headcount_range_to_salesnav_options("11-500") == ["11-50", "51-200", "201-500"]
    assert expand_headcount_range_to_salesnav_options("10,001+") == ["10,001+"]
    assert expand_headcount_range_to_salesnav_options("bad") == []

    assert parse_employee_text("Construction Â· 8.5K+ employees on LinkedIn") == "8.5K+"
    assert employee_display_to_int("8.5K+") == 8500
    assert employee_display_to_int("2M") == 2_000_000
    assert employee_display_to_int("n/a") == 0


def test_operation_retryable_error_markers():
    assert _is_retryable_error(RuntimeError("navigation timeout"))
    assert _is_retryable_error(RuntimeError("Execution context was destroyed"))
    assert not _is_retryable_error(RuntimeError("validation failed"))


def test_run_operation_with_retries_recovers_retryable_error():
    state = {"calls": 0}

    async def _fn():
        state["calls"] += 1
        if state["calls"] == 1:
            raise RuntimeError("timeout while waiting for selector")
        return "ok"

    out = _run(
        run_operation_with_retries(
            op_name="unit_retry",
            fn=_fn,
            retries=1,
            retry_wait_seconds=0.01,
        )
    )
    assert out == "ok"
    assert state["calls"] == 2


def test_run_operation_with_retries_captures_debug_on_terminal_failure():
    class _Debug:
        def __init__(self):
            self.calls = []

        async def capture(self, op_name, context=None):
            self.calls.append((op_name, context or {}))

    dbg = _Debug()

    async def _fn():
        raise RuntimeError("hard failure")

    try:
        _run(
            run_operation_with_retries(
                op_name="unit_terminal",
                fn=_fn,
                retries=2,
                retry_wait_seconds=0.01,
                debug=dbg,
                debug_context={"area": "salesnav"},
            )
        )
        raise AssertionError("expected failure")
    except RuntimeError as exc:
        assert "hard failure" in str(exc)

    assert len(dbg.calls) == 1
    opname, ctx = dbg.calls[0]
    assert opname == "unit_terminal"
    assert ctx.get("attempts") == 3
    assert ctx.get("area") == "salesnav"


class _FakeLocator:
    def __init__(self, page):
        self.page = page

    @property
    def first(self):
        return self

    async def count(self):
        return 1

    async def get_attribute(self, name):
        if name == "aria-selected":
            return self.page.selected
        return None

    async def click(self):
        self.page.clicked = True

    def nth(self, _index):
        return self

    async def wait_for(self, **_kwargs):
        return None


class _FakePage:
    def __init__(self):
        self.url = "https://www.linkedin.com/sales/home"
        self.selected = "false"
        self.clicked = False
        self.gotos = []

    async def goto(self, url, timeout=0):
        self.gotos.append((url, timeout))
        self.url = url

    async def wait_for_load_state(self, *_args, **_kwargs):
        return None

    async def wait_for_selector(self, *_args, **_kwargs):
        return None

    def locator(self, _sel):
        return _FakeLocator(self)


class _FakeScraper:
    def __init__(self):
        self.page = _FakePage()
        self.debugger = None
        self.waits = SalesNavWaits(self)


def test_waits_url_contains_contract():
    scraper = _FakeScraper()
    waits = scraper.waits
    assert _run(waits.wait_for_url_contains("sales/home", timeout_seconds=0.2))
    assert not _run(waits.wait_for_url_contains("does-not-exist", timeout_seconds=0.2))


def test_navigator_go_to_account_search_happy_path_clicks_tab():
    scraper = _FakeScraper()
    navigator = SalesNavNavigator(scraper)
    ok = _run(navigator.go_to_account_search())
    assert ok is True
    assert scraper.page.gotos
    assert "sales/search/company" in scraper.page.gotos[0][0]
    assert scraper.page.clicked is True

