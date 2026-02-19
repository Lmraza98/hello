import asyncio
import types

from services.web_automation.linkedin.salesnav.query_builder import SalesNavQueryBuildError
from services.web_automation.browser.skills.store import get_skill
from services.web_automation.browser.core.workflow import BrowserWorkflow
from services.web_automation.browser.workflows import recipes

SALESNAV_FILTER_CASES = {
    "annual_revenue": "10M-50M",
    "company_headcount": "1-10",
    "company_headcount_growth": "10-20%",
    "fortune": "Fortune 500",
    "headquarters_location": "United States",
    "industry": "Hospitals and Health Care",
    "number_of_followers": "1001-5000",
    "department_headcount": "Marketing 1-10",
    "department_headcount_growth": "Marketing 10-20%",
    "job_opportunities": "Has job opportunities",
    "recent_activities": "Posted on LinkedIn in last 30 days",
    "connection": "2nd degree",
    "companies_in_crm": "In CRM",
    "saved_accounts": "Saved",
    "account_lists": "Target Accounts",
}


def _run(coro):
    return asyncio.run(coro)


def _patch_recipe_waits(monkeypatch) -> None:
    async def _noop_wait(_wf, *_args, **_kwargs):
        return None

    monkeypatch.setattr(recipes, "_wait_ui_settle", _noop_wait)
    monkeypatch.setattr(recipes, "_wait_results_settle", _noop_wait)
    monkeypatch.setattr(recipes, "_wait_phase_cooldown", _noop_wait)


def test_salesnav_skill_frontmatter_has_all_filter_wiring():
    skill = get_skill("linkedin-salesnav-accounts")
    assert isinstance(skill, dict)
    frontmatter = skill.get("frontmatter")
    assert isinstance(frontmatter, dict)

    for name in SALESNAV_FILTER_CASES:
        expand_key = f"filter_{name}_expand_action"
        assert isinstance(frontmatter.get(expand_key), str) and frontmatter.get(expand_key)

        input_key = f"filter_{name}_input_action"
        select_key = f"filter_{name}_select_option"
        has_input = isinstance(frontmatter.get(input_key), str) and bool(frontmatter.get(input_key))
        has_select = str(frontmatter.get(select_key) or "").strip().lower() in {"true", "1", "yes"}
        assert has_input or has_select


async def _apply_all_filters_with_stubs() -> None:
    wf = BrowserWorkflow(tab_id="tab-0")
    skill = get_skill("linkedin-salesnav-accounts")
    assert isinstance(skill, dict)
    frontmatter = skill.get("frontmatter")
    assert isinstance(frontmatter, dict)
    wf.frontmatter = dict(frontmatter)

    async def fake_click(self, action: str, timeout_ms: int = 6000) -> bool:
        return True

    async def fake_fill_input(self, action: str, value: str, submit: bool = True) -> bool:
        return True

    async def fake_wait(self, ms: int) -> None:
        return None

    async def fake_safe_find_ref(self, *, text: str, role: str | None, timeout_ms: int, poll_ms: int):
        return "ref-1"

    async def fake_snapshot(self):
        return [{"label": str(v)} for v in SALESNAV_FILTER_CASES.values()]

    wf.click = types.MethodType(fake_click, wf)
    wf.fill_input = types.MethodType(fake_fill_input, wf)
    wf.wait = types.MethodType(fake_wait, wf)
    wf._safe_find_ref = types.MethodType(fake_safe_find_ref, wf)
    wf.snapshot = types.MethodType(fake_snapshot, wf)

    for name, value in SALESNAV_FILTER_CASES.items():
        ok = await wf.apply_filter(name, value)
        assert ok is True


def test_apply_filter_supports_all_salesnav_filters(monkeypatch):
    import services.web_automation.browser.core.workflow as workflow_module

    async def fake_browser_act(_req):
        return {"ok": True}

    monkeypatch.setattr(workflow_module, "browser_act", fake_browser_act)
    _run(_apply_all_filters_with_stubs())


class _FakeWorkflow:
    def __init__(self, *, tab_id=None, current_url_value: str | None = None):
        self.tab_id = tab_id or "tab-0"
        self.skill_id = "linkedin-salesnav-accounts"
        self.skill_meta = {"match_score": 99}
        self.frontmatter = {
            "default_extract_kind_for_task_salesnav_search_account": "company",
            "default_extract_kind": "company",
        }
        self.last_debug = {}
        self.applied = []
        self.fill_calls = 0
        self.fill_queries = []
        self.navigated_urls = []
        self.navigate_to_entry_calls = 0
        self.current_url_value = current_url_value or "https://www.linkedin.com/sales/search/company"

    async def bind_skill(self, *, task, url=None, query=None):
        return True

    async def navigate_to_entry(self):
        self.navigate_to_entry_calls += 1
        return True

    async def navigate(self, _url):
        self.navigated_urls.append(str(_url))
        self.current_url_value = str(_url)
        return True

    async def wait(self, _ms):
        return None

    async def fill_input(self, _action, _query, submit=True):
        self.fill_calls += 1
        self.fill_queries.append(str(_query))
        return True

    async def apply_filter(self, name, value):
        self.applied.append((name, value))
        self.last_debug[f"filter_{name}"] = {"ok": True}
        return True

    async def current_url(self):
        return self.current_url_value

    def available_extract_kinds(self):
        return ["company"]

    def _extract_rules(self, _kind):
        return {"href_contains": ["/sales/company/"]}

    async def extract(self, _extract_type, _limit):
        return [{"name": "Acme", "sales_nav_url": "https://www.linkedin.com/sales/company/1"}]

    async def snapshot(self):
        return []


class _FakePeopleWorkflow(_FakeWorkflow):
    def __init__(self):
        super().__init__()
        self.skill_id = "linkedin-salesnav-people"
        self.frontmatter = {"default_extract_kind_for_task_salesnav_people_search": "lead", "default_extract_kind": "lead"}
        self.extract_calls = 0
        self.extract_batches = [[{"name": "VP Ops", "title": "Vice President of Operations"}]]

    def available_extract_kinds(self):
        return ["lead"]

    def _extract_rules(self, _kind):
        return {"href_contains": ["/sales/lead/"]}

    async def extract(self, _extract_type, _limit):
        idx = min(self.extract_calls, len(self.extract_batches) - 1)
        self.extract_calls += 1
        return list(self.extract_batches[idx])


async def _run_recipe_with_full_parsed_filters(monkeypatch):
    parsed = {
        "keywords": ["ai-powered cybersecurity saas"],
        "industry": ["Hospitals and Health Care"],
        "headquarters_location": ["United States"],
        "company_headcount": "1-10",
        "annual_revenue": "10M-50M",
        "company_headcount_growth": "10-20%",
        "fortune": "Fortune 500",
        "number_of_followers": "1001-5000",
        "department_headcount": "Marketing 1-10",
        "department_headcount_growth": "Marketing 10-20%",
        "job_opportunities": "Has job opportunities",
        "recent_activities": "Posted on LinkedIn in last 30 days",
        "connection": "2nd degree",
        "companies_in_crm": "In CRM",
        "saved_accounts": "Saved",
        "account_lists": "Target Accounts",
    }

    monkeypatch.setattr(recipes, "BrowserWorkflow", _FakeWorkflow)
    monkeypatch.setattr(recipes, "_is_natural_language", lambda _q: True)
    monkeypatch.setattr(recipes, "_decompose_salesnav_query", lambda _q: parsed)

    async def _noop_guard(_wf, stage: str):
        return None

    async def _noop_suggestion(_wf):
        return False

    monkeypatch.setattr(recipes, "_guard_challenges", _noop_guard)
    monkeypatch.setattr(recipes, "_maybe_click_salesnav_accounts_suggestion", _noop_suggestion)
    monkeypatch.setattr(
        recipes,
        "build_salesnav_account_search_url",
        lambda keyword, filters: types.SimpleNamespace(
            url="https://www.linkedin.com/sales/search/company?query=%28keywords%3Aai-powered%2Cfilters%3AList%28%29%29&viewAllFilters=true",
            applied_filters={k: {"value": v, "applied": True, "source": "url_query"} for k, v in parsed.items() if k != "keywords"},
        ),
    )
    _patch_recipe_waits(monkeypatch)

    result = await recipes.search_and_extract(
        task="salesnav_search_account",
        query="search for these companies on sales navigator SaaS companies specializing in AI-powered cybersecurity for the healthcare industry",
        limit=5,
    )
    assert result.get("ok") is True

    applied = result.get("applied_filters")
    assert isinstance(applied, dict)
    for name in SALESNAV_FILTER_CASES:
        assert name in applied


def test_search_and_extract_applies_all_parsed_salesnav_filters(monkeypatch):
    _run(_run_recipe_with_full_parsed_filters(monkeypatch))


async def _run_recipe_uses_url_builder_without_typing(monkeypatch):
    wf = _FakeWorkflow()
    monkeypatch.setattr(recipes, "BrowserWorkflow", lambda **kwargs: wf)
    monkeypatch.setattr(recipes, "_is_natural_language", lambda _q: False)

    async def _noop_guard(_wf, stage: str):
        return None

    async def _noop_suggestion(_wf):
        return False

    monkeypatch.setattr(recipes, "_guard_challenges", _noop_guard)
    monkeypatch.setattr(recipes, "_maybe_click_salesnav_accounts_suggestion", _noop_suggestion)
    monkeypatch.setattr(
        recipes,
        "build_salesnav_account_search_url",
        lambda keyword, filters: types.SimpleNamespace(
            url="https://www.linkedin.com/sales/search/company?query=%28spellCorrectionEnabled%3Atrue%2Ckeywords%3Ahealthcare%2Cfilters%3AList%28%28type%3AINDUSTRY%2Cvalues%3AList%28%28id%3A14%2Ctext%3AHospitals%2520and%2520Health%2520Care%2CselectionType%3AINCLUDED%29%29%29%29%29&viewAllFilters=true",
            applied_filters={"industry": {"value": "Hospitals and Health Care", "applied": True, "source": "url_query"}},
        ),
    )
    _patch_recipe_waits(monkeypatch)

    result = await recipes.search_and_extract(
        task="salesnav_search_account",
        query="SaaS AI-powered cybersecurity",
        filter_values={"industry": "Hospitals and Health Care"},
        limit=5,
    )
    assert result.get("ok") is True
    assert wf.fill_calls == 0
    assert wf.navigate_to_entry_calls == 0
    assert len(wf.navigated_urls) >= 1
    assert "query=" in wf.navigated_urls[-1]
    assert wf.applied == []


def test_search_and_extract_uses_url_builder_without_typing(monkeypatch):
    _run(_run_recipe_uses_url_builder_without_typing(monkeypatch))


async def _run_recipe_uses_single_keyword_for_salesnav(monkeypatch):
    wf = _FakeWorkflow()
    captured = {}
    monkeypatch.setattr(recipes, "BrowserWorkflow", lambda **kwargs: wf)
    monkeypatch.setattr(recipes, "_is_natural_language", lambda _q: True)
    monkeypatch.setattr(
        recipes,
        "_decompose_salesnav_query",
        lambda _q: {"keywords": ["ai-powered cybersecurity saas"], "industry": ["Hospitals and Health Care"], "headquarters_location": []},
    )

    async def _noop_guard(_wf, stage: str):
        return None

    async def _noop_suggestion(_wf):
        return False

    def _fake_builder(keyword, filters):
        captured["keyword"] = keyword
        captured["filters"] = filters
        return types.SimpleNamespace(
            url="https://www.linkedin.com/sales/search/company?query=%28keywords%3Aai-powered%29&viewAllFilters=true",
            applied_filters={},
        )

    monkeypatch.setattr(recipes, "_guard_challenges", _noop_guard)
    monkeypatch.setattr(recipes, "_maybe_click_salesnav_accounts_suggestion", _noop_suggestion)
    monkeypatch.setattr(recipes, "build_salesnav_account_search_url", _fake_builder)
    _patch_recipe_waits(monkeypatch)

    result = await recipes.search_and_extract(
        task="salesnav_search_account",
        query="SaaS companies specializing in AI-powered cybersecurity for the healthcare industry",
        limit=5,
    )
    assert result.get("ok") is True
    assert wf.fill_calls == 0
    assert wf.navigate_to_entry_calls == 0
    assert captured.get("keyword") == "ai-powered"


def test_search_and_extract_uses_single_keyword_for_salesnav(monkeypatch):
    _run(_run_recipe_uses_single_keyword_for_salesnav(monkeypatch))


async def _run_recipe_returns_unmapped_error_when_builder_fails(monkeypatch):
    wf = _FakeWorkflow()
    monkeypatch.setattr(recipes, "BrowserWorkflow", lambda **kwargs: wf)
    monkeypatch.setattr(recipes, "_is_natural_language", lambda _q: False)

    async def _noop_guard(_wf, stage: str):
        return None

    async def _noop_suggestion(_wf):
        return False

    def _boom_builder(keyword, filters):
        raise SalesNavQueryBuildError([{"filter": "industry", "value": "Construction", "reason": "unmapped_industry_id"}])

    monkeypatch.setattr(recipes, "_guard_challenges", _noop_guard)
    monkeypatch.setattr(recipes, "_maybe_click_salesnav_accounts_suggestion", _noop_suggestion)
    monkeypatch.setattr(recipes, "build_salesnav_account_search_url", _boom_builder)
    _patch_recipe_waits(monkeypatch)

    result = await recipes.search_and_extract(
        task="salesnav_search_account",
        query="construction",
        filter_values={"industry": "Construction"},
        limit=5,
    )
    assert result.get("ok") is False
    err = result.get("error") or {}
    assert err.get("code") == "salesnav_filter_unmapped"
    assert isinstance(result.get("unmapped_filters"), list)


def test_search_and_extract_returns_unmapped_error_when_builder_fails(monkeypatch):
    _run(_run_recipe_returns_unmapped_error_when_builder_fails(monkeypatch))


async def _run_people_recipe_uses_url_builder_without_typing(monkeypatch):
    wf = _FakePeopleWorkflow()
    monkeypatch.setattr(recipes, "BrowserWorkflow", lambda **kwargs: wf)
    monkeypatch.setattr(recipes, "_is_natural_language", lambda _q: False)

    async def _noop_guard(_wf, stage: str):
        return None

    monkeypatch.setattr(recipes, "_guard_challenges", _noop_guard)
    monkeypatch.setattr(
        recipes,
        "build_salesnav_people_search_url",
        lambda keyword, filters: types.SimpleNamespace(
            url="https://www.linkedin.com/sales/search/people?query=%28filters%3AList%28%29%29&viewAllFilters=true",
            applied_filters={"function": {"value": "Operations", "applied": True, "source": "url_query"}},
        ),
    )
    _patch_recipe_waits(monkeypatch)

    result = await recipes.search_and_extract(
        task="salesnav_people_search",
        query="VP of Operations",
        filter_values={"function": "Operations", "seniority_level": "Vice President"},
        limit=5,
    )
    assert result.get("ok") is True
    assert wf.fill_calls == 0
    assert wf.navigate_to_entry_calls == 0
    assert len(wf.navigated_urls) >= 1
    assert "query=" in wf.navigated_urls[-1]


def test_people_search_uses_url_builder_without_typing(monkeypatch):
    _run(_run_people_recipe_uses_url_builder_without_typing(monkeypatch))


async def _run_people_recipe_retries_without_keyword_in_compound_mode(monkeypatch):
    wf = _FakePeopleWorkflow()
    wf.extract_batches = [
        [],
        [{"name": "Jane VP", "title": "Vice President of Operations"}],
    ]
    monkeypatch.setattr(recipes, "BrowserWorkflow", lambda **kwargs: wf)
    monkeypatch.setattr(recipes, "_is_natural_language", lambda _q: False)

    async def _noop_guard(_wf, stage: str):
        return None

    monkeypatch.setattr(recipes, "_guard_challenges", _noop_guard)
    seen_keywords: list[str] = []

    def _fake_people_builder(keyword, filters):
        seen_keywords.append(str(keyword or ""))
        suffix = "no-keyword" if not str(keyword or "").strip() else "with-keyword"
        return types.SimpleNamespace(
            url=f"https://www.linkedin.com/sales/search/people?query={suffix}&viewAllFilters=true",
            applied_filters={"function": {"value": "Operations", "applied": True, "source": "url_query"}},
        )

    monkeypatch.setattr(recipes, "build_salesnav_people_search_url", _fake_people_builder)
    _patch_recipe_waits(monkeypatch)

    result = await recipes.search_and_extract(
        task="salesnav_people_search",
        query="VP of Operations Industrial Air Centers",
        filter_values={"function": "Operations", "seniority_level": "Vice President"},
        compound_lead_mode=True,
        limit=5,
    )
    assert result.get("ok") is True
    assert len(result.get("items") or []) == 1
    assert seen_keywords[:2] == ["VP", ""]
    meta = result.get("people_search") or {}
    keyword_retry = meta.get("keyword_retry") or {}
    assert keyword_retry.get("used") is True
    assert keyword_retry.get("count") == 1


def test_people_search_retries_without_keyword_in_compound_mode(monkeypatch):
    _run(_run_people_recipe_retries_without_keyword_in_compound_mode(monkeypatch))


async def _run_people_recipe_falls_back_when_exact_company_returns_empty(monkeypatch):
    wf = _FakePeopleWorkflow()
    wf.extract_batches = [
        [],
        [{"name": "VP Ops", "title": "Vice President of Operations"}],
    ]
    monkeypatch.setattr(recipes, "BrowserWorkflow", lambda **kwargs: wf)
    monkeypatch.setattr(recipes, "_is_natural_language", lambda _q: False)

    async def _noop_guard(_wf, stage: str):
        return None

    monkeypatch.setattr(recipes, "_guard_challenges", _noop_guard)
    async def _fake_resolve_people_current_company_identity(**kwargs):
        return {"name": "Exact Corp", "urn": "urn:li:organization:123", "source": "provided"}

    monkeypatch.setattr(recipes, "_resolve_people_current_company_identity", _fake_resolve_people_current_company_identity)

    def _fake_people_builder(keyword, filters):
        has_current = "current_company" in (filters or {})
        url = (
            "https://www.linkedin.com/sales/search/people?query=exact&viewAllFilters=true"
            if has_current
            else "https://www.linkedin.com/sales/search/people?query=fallback&viewAllFilters=true"
        )
        applied = {"function": {"value": "Operations", "applied": True, "source": "url_query"}}
        if has_current:
            applied["current_company"] = {"value": ["Exact Corp"], "applied": True, "source": "url_query"}
        return types.SimpleNamespace(url=url, applied_filters=applied)

    monkeypatch.setattr(recipes, "build_salesnav_people_search_url", _fake_people_builder)
    _patch_recipe_waits(monkeypatch)

    result = await recipes.search_and_extract(
        task="salesnav_people_search",
        query="VP of Operations",
        filter_values={
            "current_company": "Some Co",
            "current_company_sales_nav_url": "https://www.linkedin.com/sales/company/123",
            "function": "Operations",
            "seniority_level": "Vice President",
        },
        limit=5,
    )
    assert result.get("ok") is True
    assert len(result.get("items") or []) == 1
    assert len(wf.navigated_urls) >= 2
    assert "query=fallback" in wf.navigated_urls[-1]
    meta = result.get("people_search") or {}
    fallback = meta.get("keyword_fallback") or {}
    assert fallback.get("used") is True


def test_people_search_falls_back_when_exact_company_returns_empty(monkeypatch):
    _run(_run_people_recipe_falls_back_when_exact_company_returns_empty(monkeypatch))


async def _apply_bool_frontmatter_flags() -> tuple[list[bool], dict]:
    wf = BrowserWorkflow(tab_id="tab-0")
    wf.frontmatter = {
        "filter_industry_expand_action": "industry_filter",
        "filter_industry_input_action": "industry_input",
        "filter_industry_submit": False,
        "filter_industry_select_option": True,
        "filter_industry_confirm_action": "industry_include_button",
        "filter_industry_verify": False,
    }
    submit_values: list[bool] = []

    async def fake_click(self, action: str, timeout_ms: int = 6000) -> bool:
        return True

    async def fake_fill_input(self, action: str, value: str, submit: bool = True) -> bool:
        submit_values.append(bool(submit))
        return True

    async def fake_wait(self, ms: int) -> None:
        return None

    async def fake_safe_find_ref(self, *, text: str, role: str | None, timeout_ms: int, poll_ms: int):
        return "ref-1"

    wf.click = types.MethodType(fake_click, wf)
    wf.fill_input = types.MethodType(fake_fill_input, wf)
    wf.wait = types.MethodType(fake_wait, wf)
    wf._safe_find_ref = types.MethodType(fake_safe_find_ref, wf)

    ok = await wf.apply_filter("industry", "Hospitals and Health Care")
    return submit_values, wf.last_debug.get("filter_industry", {}) | {"ok": ok}


def test_apply_filter_honors_boolean_frontmatter_flags(monkeypatch):
    import services.web_automation.browser.core.workflow as workflow_module

    async def fake_browser_act(_req):
        return {"ok": True}

    monkeypatch.setattr(workflow_module, "browser_act", fake_browser_act)
    submit_values, debug = _run(_apply_bool_frontmatter_flags())
    assert submit_values == [False]
    steps = debug.get("steps") if isinstance(debug, dict) else []
    assert any(step.get("step") == "select_option" and step.get("ok") is True for step in steps)


async def _apply_filter_falls_back_to_direct_option_when_input_fails() -> tuple[bool, dict]:
    wf = BrowserWorkflow(tab_id="tab-0")
    wf.frontmatter = {
        "filter_industry_expand_action": "industry_filter",
        "filter_industry_input_action": "industry_input",
        "filter_industry_select_option": True,
        "filter_industry_verify": False,
    }

    async def fake_click(self, action: str, timeout_ms: int = 6000) -> bool:
        return True

    async def fake_fill_input(self, action: str, value: str, submit: bool = True) -> bool:
        return False

    async def fake_wait(self, ms: int) -> None:
        return None

    async def fake_safe_find_ref(self, *, text: str, role: str | None, timeout_ms: int, poll_ms: int):
        if text == "Hospitals and Health Care":
            return "ref-option"
        return None

    wf.click = types.MethodType(fake_click, wf)
    wf.fill_input = types.MethodType(fake_fill_input, wf)
    wf.wait = types.MethodType(fake_wait, wf)
    wf._safe_find_ref = types.MethodType(fake_safe_find_ref, wf)

    ok = await wf.apply_filter("industry", "Hospitals and Health Care")
    return ok, wf.last_debug.get("filter_industry", {})


def test_apply_filter_can_select_option_even_when_input_typing_fails(monkeypatch):
    import services.web_automation.browser.core.workflow as workflow_module

    async def fake_browser_act(_req):
        return {"ok": True}

    monkeypatch.setattr(workflow_module, "browser_act", fake_browser_act)
    ok, debug = _run(_apply_filter_falls_back_to_direct_option_when_input_fails())
    assert ok is True
    steps = debug.get("steps") if isinstance(debug, dict) else []
    assert any(step.get("step") == "select_option_without_input" and step.get("ok") is True for step in steps)


async def _run_click_accounts_suggestion(monkeypatch) -> bool:
    wf = _FakeWorkflow()
    clicked = {"count": 0}

    async def fake_act(req):
        if str(req.ref) == "ref-accounts" and req.action == "click":
            clicked["count"] += 1
        return {"ok": True}

    async def fake_snapshot():
        return [
            {"ref": "ref-other", "role": "option", "label": "foo - search for leads"},
            {"ref": "ref-accounts", "role": "option", "label": "foo - search for accounts"},
        ]

    wf.snapshot = fake_snapshot
    monkeypatch.setattr(recipes, "browser_act", fake_act)
    _patch_recipe_waits(monkeypatch)
    ok = await recipes._maybe_click_salesnav_accounts_suggestion(wf)
    return bool(ok and clicked["count"] == 1)


def test_salesnav_accounts_suggestion_clicks_option(monkeypatch):
    assert _run(_run_click_accounts_suggestion(monkeypatch)) is True
