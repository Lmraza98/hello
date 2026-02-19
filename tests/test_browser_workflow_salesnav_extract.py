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
            },
            {
                "company_name": "Acme",
                "name": "Acme",
                "sales_nav_url": "/sales/company/123?_ntb=def",
                "industry": "Manufacturing",
            },
            {
                "company_name": "Beta",
                "name": "Beta",
                "sales_nav_url": "https://www.linkedin.com/sales/company/456",
                "industry": "Industrial Automation",
            },
        ]


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
    assert out[1]["company_name"] == "Beta"
    assert out[1]["industry"] == "Industrial Automation"
