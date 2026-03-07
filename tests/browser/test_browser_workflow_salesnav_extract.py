import asyncio
import types

from services.web_automation.browser.core.workflow import BrowserWorkflow
from services.web_automation.browser.workflows import recipes


def _run(coro):
    return asyncio.run(coro)


class _FakePage:
    async def evaluate(self, _script):
        return [
            {
                "company_name": "Acme",
                "name": "Acme",
                "sales_nav_url": "/sales/company/123?_ntb=abc",
                "industry": "Manufacturing",
                "strategic_priorities": ["Digital Transformation"],
                "interaction_map": {"company_name_click": True, "spotlight_click": True},
            },
            {
                "company_name": "Acme",
                "name": "Acme",
                "sales_nav_url": "/sales/company/123?_ntb=def",
                "industry": "Manufacturing",
                "interaction_map": {"company_name_click": True},
            },
            {
                "company_name": "Beta",
                "name": "Beta",
                "sales_nav_url": "https://www.linkedin.com/sales/company/456",
                "industry": "Industrial Automation",
                "interaction_map": {"company_name_click": True},
            },
        ]


class _FakeLeadPage:
    async def evaluate(self, _script):
        return [
            {
                "name": "Jane Doe",
                "sales_nav_url": "/sales/lead/ACwAAABBBB,NAME_SEARCH,XYZ?session=1",
                "public_url": "/in/jane-doe-123/",
                "title": "VP Operations",
                "company_name": "Acme",
                "interaction_map": {"lead_name_click": True, "view_profile_click": True},
            },
            {
                "name": "Jane Doe",
                "sales_nav_url": "/sales/lead/ACwAAABBBB,NAME_SEARCH,XYZ?session=2",
                "public_url": "/in/jane-doe-123/",
                "title": "VP Operations",
                "company_name": "Acme",
                "interaction_map": {"lead_name_click": True, "view_profile_click": True},
            },
            {
                "name": "John Smith",
                "sales_nav_url": "https://www.linkedin.com/sales/lead/ACwAAACCCC,NAME_SEARCH,XYZ",
                "public_url": "",
                "title": "Head of Finance",
                "company_name": "Beta",
                "interaction_map": {"lead_name_click": True, "message_click": True},
            },
        ]


class _FakeCompanyProfilePage:
    async def evaluate(self, _script):
        return {
            "company_name": "NVIDIA",
            "name": "NVIDIA",
            "sales_nav_url": "/sales/company/125222?_ntb=abc",
            "website": "https://www.nvidia.com/",
            "industry": "Semiconductors",
            "headquarters": "Santa Clara, California, United States",
            "employee_count": "10,001+ employees",
            "followers": "2,500,000 followers",
            "about": "Accelerated computing company.",
            "specialties": ["AI", "GPU", "Data Center"],
            "interaction_map": {
                "employees_search_click": True,
                "website_click": True,
                "company_profile_open": True,
            },
        }


def test_extract_uses_salesnav_dom_cards_when_skill_matches():
    wf = BrowserWorkflow(tab_id="tab-1")
    wf.skill_id = "linkedin-salesnav-accounts"
    wf.skill_meta = {"match_score": 97}
    wf.frontmatter = {"extract_company_href_contains": ["/sales/company/"]}

    async def fake_raw_page(self):
        return _FakePage()

    async def fake_scroll(self, **_kwargs):
        return None

    async def fake_wait_jitter(self, *args, **kwargs):
        return 0

    async def fake_capture(self, _rows, max_cards=8):
        return None

    wf._raw_page = types.MethodType(fake_raw_page, wf)
    wf.scroll = types.MethodType(fake_scroll, wf)
    wf.wait_jitter = types.MethodType(fake_wait_jitter, wf)
    wf._capture_salesnav_ai_summaries = types.MethodType(fake_capture, wf)

    out = _run(wf.extract("company", limit=5))
    assert len(out) == 2
    assert out[0]["company_name"] == "Acme"
    assert out[0]["sales_nav_url"].startswith("https://www.linkedin.com/sales/company/123")
    assert out[0]["interaction_map"]["company_name_click"] is True
    assert out[1]["company_name"] == "Beta"
    assert out[1]["industry"] == "Industrial Automation"


def test_extract_uses_salesnav_company_profile_dom_on_company_profile_url():
    wf = BrowserWorkflow(tab_id="tab-1")
    wf.skill_id = "linkedin-salesnav-accounts"
    wf.skill_meta = {"match_score": 98}
    wf.frontmatter = {"extract_company_href_contains": ["/sales/company/"]}

    async def fake_raw_page(self):
        return _FakeCompanyProfilePage()

    async def fake_current_url(self):
        return "https://www.linkedin.com/sales/company/125222?_ntb=yRQdLouQQXqs3hHn%2B7%2FG5Q%3D%3D"

    async def fail_scroll(self, **_kwargs):
        raise AssertionError("company-profile path should not use results scrolling")

    wf._raw_page = types.MethodType(fake_raw_page, wf)
    wf.current_url = types.MethodType(fake_current_url, wf)
    wf.scroll = types.MethodType(fail_scroll, wf)

    out = _run(wf.extract("company", limit=5))
    assert len(out) == 1
    row = out[0]
    assert row["company_name"] == "NVIDIA"
    assert row["sales_nav_url"].startswith("https://www.linkedin.com/sales/company/125222")
    assert row["website"] == "https://www.nvidia.com/"
    assert row["industry"] == "Semiconductors"
    assert row["headquarters"] == "Santa Clara, California, United States"
    assert row["employee_count"] == "10,001+ employees"
    assert row["followers"] == "2,500,000 followers"
    assert row["about"] == "Accelerated computing company."
    assert row["interaction_map"]["employees_search_click"] is True


def test_extract_uses_salesnav_dom_lead_cards_when_skill_matches():
    wf = BrowserWorkflow(tab_id="tab-1")
    wf.skill_id = "linkedin-salesnav-people"
    wf.skill_meta = {"match_score": 96}
    wf.frontmatter = {"extract_lead_href_contains": ["/sales/lead/", "/in/"]}

    async def fake_raw_page(self):
        return _FakeLeadPage()

    async def fake_scroll(self, **_kwargs):
        return None

    async def fake_wait_jitter(self, *args, **kwargs):
        return 0

    wf._raw_page = types.MethodType(fake_raw_page, wf)
    wf.scroll = types.MethodType(fake_scroll, wf)
    wf.wait_jitter = types.MethodType(fake_wait_jitter, wf)

    out = _run(wf.extract("lead", limit=5))
    assert len(out) == 2

    jane = out[0]
    assert jane["name"] == "Jane Doe"
    assert jane["sales_nav_url"].startswith("https://www.linkedin.com/sales/lead/ACwAAABBBB")
    assert jane["public_url"] == "https://www.linkedin.com/in/jane-doe-123/"
    assert jane["linkedin_url"] == "https://www.linkedin.com/in/jane-doe-123/"
    assert jane["has_public_url"] is True
    assert jane["interaction_map"]["view_profile_click"] is True

    john = out[1]
    assert john["name"] == "John Smith"
    assert john["public_url"] is None
    assert john["linkedin_url"].startswith("https://www.linkedin.com/sales/lead/ACwAAACCCC")
    assert john["has_public_url"] is False


def test_list_sub_items_requires_parent_click_for_salesnav_employee_lookup(monkeypatch):
    class _FakeWorkflow:
        def __init__(self, tab_id=None):
            self.tab_id = tab_id or "tab-0"
            self.skill_id = "linkedin-salesnav-accounts"
            self.skill_meta = {"match_score": 99}
            self.frontmatter = {
                "extract_lead_label_field": "name",
                "extract_lead_url_field": "linkedin_url",
            }

    async def fake_search_and_extract(**_kwargs):
        return {
            "ok": True,
            "tab_id": "tab-0",
            "url": "https://www.linkedin.com/sales/search/company",
            "click": {"clicked": False, "ambiguous": False, "candidates": []},
        }

    monkeypatch.setattr(recipes, "BrowserWorkflow", _FakeWorkflow)
    monkeypatch.setattr(recipes, "search_and_extract", fake_search_and_extract)

    out = _run(
        recipes.list_sub_items(
            task="salesnav_list_employees",
            tab_id="tab-0",
            parent_query="Zco Corporation",
            parent_task="salesnav_search_account",
            extract_type="lead",
            limit=25,
        )
    )

    assert out["ok"] is False
    assert out["error"]["code"] == "parent_not_opened"


def test_list_sub_items_fails_if_employee_results_page_was_not_opened(monkeypatch):
    class _FakeWorkflow:
        def __init__(self, tab_id=None):
            self.tab_id = tab_id or "tab-0"
            self.skill_id = "linkedin-salesnav-accounts"
            self.skill_meta = {"match_score": 99}
            self.frontmatter = {
                "extract_lead_label_field": "name",
                "extract_lead_url_field": "linkedin_url",
            }
            self._urls = iter(
                [
                    "https://www.linkedin.com/sales/company/123",
                    "https://www.linkedin.com/sales/home",
                ]
            )

        async def current_url(self):
            return next(self._urls, "https://www.linkedin.com/sales/home")

        async def bind_skill(self, **_kwargs):
            return True

        async def dismiss_common_overlays(self, **_kwargs):
            return None

        async def click_and_follow_tab(self, *_args, **_kwargs):
            return True

    async def fake_search_and_extract(**_kwargs):
        return {
            "ok": True,
            "tab_id": "tab-0",
            "url": "https://www.linkedin.com/sales/company/123",
            "click": {"clicked": True, "ambiguous": False},
        }

    async def fake_wait(*_args, **_kwargs):
        return None

    monkeypatch.setattr(recipes, "BrowserWorkflow", _FakeWorkflow)
    monkeypatch.setattr(recipes, "search_and_extract", fake_search_and_extract)
    monkeypatch.setattr(recipes, "_guard_with_timeout", fake_wait)
    monkeypatch.setattr(recipes, "_wait_ui_settle", fake_wait)

    out = _run(
        recipes.list_sub_items(
            task="salesnav_list_employees",
            tab_id="tab-0",
            parent_query="Zco Corporation",
            parent_task="salesnav_search_account",
            extract_type="lead",
            limit=25,
        )
    )

    assert out["ok"] is False
    assert out["error"]["code"] == "employee_results_not_opened"
    assert out["url"] == "https://www.linkedin.com/sales/home"


def test_list_sub_items_fails_validation_on_empty_salesnav_employee_results(monkeypatch):
    class _FakeWorkflow:
        def __init__(self, tab_id=None):
            self.tab_id = tab_id or "tab-0"
            self.skill_id = "linkedin-salesnav-accounts"
            self.skill_meta = {"match_score": 99}
            self.frontmatter = {
                "extract_lead_label_field": "name",
                "extract_lead_url_field": "linkedin_url",
            }
            self._urls = iter(
                [
                    "https://www.linkedin.com/sales/company/123",
                    "https://www.linkedin.com/sales/search/people?query=(keywords:Zco)",
                    "https://www.linkedin.com/sales/search/people?query=(keywords:Zco)",
                ]
            )

        async def current_url(self):
            return next(self._urls, "https://www.linkedin.com/sales/search/people?query=(keywords:Zco)")

        async def bind_skill(self, **_kwargs):
            return True

        async def dismiss_common_overlays(self, **_kwargs):
            return None

        async def click_and_follow_tab(self, *_args, **_kwargs):
            return True

        async def paginate_and_extract(self, *_args, **_kwargs):
            return []

    async def fake_search_and_extract(**_kwargs):
        return {
            "ok": True,
            "tab_id": "tab-0",
            "url": "https://www.linkedin.com/sales/company/123",
            "click": {"clicked": True, "ambiguous": False},
        }

    async def fake_wait(*_args, **_kwargs):
        return None

    monkeypatch.setattr(recipes, "BrowserWorkflow", _FakeWorkflow)
    monkeypatch.setattr(recipes, "search_and_extract", fake_search_and_extract)
    monkeypatch.setattr(recipes, "_guard_with_timeout", fake_wait)
    monkeypatch.setattr(recipes, "_wait_ui_settle", fake_wait)
    monkeypatch.setattr(recipes, "_extract_salesnav_employees_with_public_urls", fake_wait)

    out = _run(
        recipes.list_sub_items(
            task="salesnav_list_employees",
            tab_id="tab-0",
            parent_query="Zco Corporation",
            parent_task="salesnav_search_account",
            extract_type="lead",
            limit=25,
        )
    )

    assert out["ok"] is False
    assert out["error"]["code"] == "validation_failed"
    assert out["stop_reason"] == "STOP_VALIDATION_FAILED"
