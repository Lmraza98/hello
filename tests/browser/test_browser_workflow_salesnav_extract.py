import asyncio
import types

from services.web_automation.browser.core.workflow import BrowserWorkflow


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
