"""Live SalesNav filter checks via direct URL query construction.

This avoids sidebar interaction drift by navigating straight to URL-encoded
SalesNav filter query strings, then capturing screenshots per filter.
"""

from __future__ import annotations

import asyncio
import base64
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import quote, unquote

from api.routes.browser_nav import BrowserActRequest, BrowserScreenshotRequest, browser_act, browser_screenshot
from services.browser_workflow import BrowserWorkflow

BASE_SEARCH_URL = "https://www.linkedin.com/sales/search/company"

# Department select IDs from SalesNav dropdown.
DEPARTMENT_IDS: dict[str, int] = {
    "Accounting": 1,
    "Administrative": 2,
    "Arts and Design": 3,
    "Business Development": 4,
    "Community and Social Services": 5,
    "Consulting": 6,
    "Education": 7,
    "Engineering": 8,
    "Entrepreneurship": 9,
    "Finance": 10,
    "Healthcare Services": 11,
    "Human Resources": 12,
    "Information Technology": 13,
    "Legal": 14,
    "Marketing": 15,
    "Media and Communication": 16,
    "Military and Protective Services": 17,
    "Operations": 18,
    "Product Management": 19,
    "Program and Project Management": 20,
    "Purchasing": 21,
    "Quality Assurance": 22,
    "Real Estate": 23,
    "Research": 24,
    "Sales": 25,
    "Support": 26,
}


def _filter_query_url(filter_clause: str) -> str:
    # SalesNav query DSL: query=(filters:List((type:...)))
    raw_query = f"(filters:List(({filter_clause})))"
    encoded = quote(raw_query, safe="")
    return f"{BASE_SEARCH_URL}?query={encoded}&viewAllFilters=true"


URL_FILTER_CASES: list[dict[str, str]] = [
    {
        "name": "industry",
        "value": "Hospitals and Health Care",
        "type_token": "INDUSTRY",
        "clause": "type:INDUSTRY,values:List((id:14,text:Hospitals%20and%20Health%20Care,selectionType:INCLUDED))",
    },
    {
        "name": "company_headcount",
        "value": "1-10",
        "type_token": "COMPANY_HEADCOUNT",
        "clause": "type:COMPANY_HEADCOUNT,values:List((id:B,text:1-10,selectionType:INCLUDED))",
    },
    {
        "name": "fortune",
        "value": "Fortune 50",
        "type_token": "FORTUNE",
        "clause": "type:FORTUNE,values:List((id:1,text:Fortune%2050,selectionType:INCLUDED))",
    },
    {
        "name": "headquarters_location",
        "value": "United States",
        "type_token": "REGION",
        "clause": "type:REGION,values:List((id:103644278,text:United%20States,selectionType:INCLUDED))",
    },
    {
        "name": "number_of_followers",
        "value": "1001-5000",
        "type_token": "NUM_OF_FOLLOWERS",
        "clause": "type:NUM_OF_FOLLOWERS,values:List((id:NFR4,text:1001-5000,selectionType:INCLUDED))",
    },
    {
        "name": "job_opportunities",
        "value": "Hiring on LinkedIn",
        "type_token": "JOB_OPPORTUNITIES",
        "clause": "type:JOB_OPPORTUNITIES,values:List((id:JO1,text:Hiring%20on%20Linkedin,selectionType:INCLUDED))",
    },
    {
        "name": "recent_activities",
        "value": "Senior leadership changes in last 3 months",
        "type_token": "ACCOUNT_ACTIVITIES",
        "clause": "type:ACCOUNT_ACTIVITIES,values:List((id:SLC,text:Senior%20leadership%20changes%20in%20last%203%20months,selectionType:INCLUDED))",
    },
    {
        "name": "connection",
        "value": "1st Degree Connections",
        "type_token": "RELATIONSHIP",
        "clause": "type:RELATIONSHIP,values:List((id:F,text:1st%20Degree%20Connections,selectionType:INCLUDED))",
    },
    {
        "name": "company_headcount_growth",
        "value": "1-19%",
        "type_token": "COMPANY_HEADCOUNT_GROWTH",
        "clause": "type:COMPANY_HEADCOUNT_GROWTH,rangeValue:(min:1,max:19)",
    },
    {
        "name": "department_headcount",
        "value": "Marketing 1-10",
        "type_token": "DEPARTMENT_HEADCOUNT",
        "clause": f"type:DEPARTMENT_HEADCOUNT,rangeValue:(min:1,max:10),selectedSubFilter:{DEPARTMENT_IDS['Marketing']}",
    },
    {
        "name": "department_headcount_growth",
        "value": "Marketing 1-19%",
        "type_token": "DEPARTMENT_HEADCOUNT_GROWTH",
        "clause": f"type:DEPARTMENT_HEADCOUNT_GROWTH,rangeValue:(min:1,max:19),selectedSubFilter:{DEPARTMENT_IDS['Marketing']}",
    },
    {
        "name": "annual_revenue",
        "value": "USD 1-10",
        "type_token": "ANNUAL_REVENUE",
        "clause": "type:ANNUAL_REVENUE,rangeValue:(min:1,max:10),selectedSubFilter:USD",
    },
]


async def _save_screenshot(tab_id: str, path: Path) -> dict[str, Any]:
    shot = await browser_screenshot(BrowserScreenshotRequest(tab_id=tab_id, full_page=False))
    payload = shot if isinstance(shot, dict) else {}
    b64 = str(payload.get("base64") or "")
    if b64:
        path.write_bytes(base64.b64decode(b64))
    return payload


async def _mitigate_overlays(wf: BrowserWorkflow) -> None:
    try:
        await browser_act(BrowserActRequest(ref=0, action="press", value="Escape", tab_id=wf.tab_id))
    except Exception:
        pass
    try:
        await wf.dismiss_common_overlays(max_passes=2)
    except Exception:
        pass


async def run() -> None:
    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    out_dir = Path("data/debug/salesnav_filter_url") / ts
    out_dir.mkdir(parents=True, exist_ok=True)

    wf = BrowserWorkflow(tab_id=None)
    if not await wf.bind_skill(task="salesnav_search_account", url=None, query="healthcare"):
        raise RuntimeError("Could not bind SalesNav account skill.")

    manifest: dict[str, Any] = {
        "started_at": ts,
        "mode": "url_filters",
        "base_url": BASE_SEARCH_URL,
        "results": [],
    }

    for idx, case in enumerate(URL_FILTER_CASES, start=1):
        name = case["name"]
        value = case["value"]
        url = _filter_query_url(case["clause"])
        row: dict[str, Any] = {"index": idx, "filter": name, "value": value, "url": url}
        try:
            await wf.navigate(url, timeout_ms=25_000)
            await wf.wait(2_000)
            await _mitigate_overlays(wf)
            await wf.wait(400)

            tab_id = str(wf.tab_id or "")
            if not tab_id:
                raise RuntimeError("No tab_id resolved after navigation.")

            shot_file = out_dir / f"{idx:02d}_{name}.jpg"
            await _save_screenshot(tab_id, shot_file)
            current_url = (await wf.current_url()) or ""
            decoded_url = unquote(current_url)
            token = f"type:{case['type_token']}"
            ok = token in decoded_url

            row.update(
                {
                    "ok": ok,
                    "current_url": current_url,
                    "screenshot": str(shot_file).replace("\\", "/"),
                }
            )
        except Exception as exc:
            row.update({"ok": False, "error": str(exc), "current_url": (await wf.current_url()) or ""})
        manifest["results"].append(row)
        print(f"[{idx:02d}/{len(URL_FILTER_CASES)}] {name} -> ok={row.get('ok')}")

    manifest["finished_at"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    manifest_path = out_dir / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")

    passed = sum(1 for r in manifest["results"] if r.get("ok"))
    total = len(manifest["results"])
    print(f"\nSaved results to: {manifest_path}")
    print(f"URL-filter checks passed: {passed}/{total}")


if __name__ == "__main__":
    asyncio.run(run())
