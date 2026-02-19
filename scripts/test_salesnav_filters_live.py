"""Live SalesNav filter exerciser.

Runs each configured account-search filter individually in the browser,
captures before/after screenshots, and writes a JSON manifest with outcomes.
"""

from __future__ import annotations

import asyncio
import base64
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from api.routes.browser_nav import BrowserActRequest, BrowserScreenshotRequest, browser_act, browser_screenshot
from services.web_automation.browser.core.workflow import BrowserWorkflow
from services.web_automation.browser.workflows import recipes

FILTER_CASES: dict[str, str] = {
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


async def _save_screenshot(tab_id: str, path: Path) -> dict[str, Any]:
    shot = await browser_screenshot(BrowserScreenshotRequest(tab_id=tab_id, full_page=False))
    payload = shot if isinstance(shot, dict) else {}
    b64 = str(payload.get("base64") or "")
    if b64:
        path.write_bytes(base64.b64decode(b64))
    return payload


async def _prepare_search_state(wf: BrowserWorkflow, keyword: str) -> None:
    await wf.navigate_to_entry(timeout_ms=20_000)
    await wf.wait(1_000)
    await recipes._wait_phase_cooldown(wf)
    await wf.fill_input("search_keywords_input", keyword, submit=False)
    await recipes._wait_results_settle(wf, 2_000)
    await recipes._maybe_click_salesnav_accounts_suggestion(wf)
    await recipes._maybe_expand_salesnav_all_filters(wf)
    await wf.wait(600)


async def _mitigate_help_overlay(wf: BrowserWorkflow) -> None:
    # 1) Global escape first.
    try:
        await browser_act(BrowserActRequest(ref=0, action="press", value="Escape", tab_id=wf.tab_id))
        await wf.wait(250)
    except Exception:
        pass

    # 2) Best-effort generic overlay close.
    try:
        await wf.dismiss_common_overlays(max_passes=2)
    except Exception:
        pass

    # 3) Explicitly close help/tutorial/support widgets when visible.
    try:
        refs = await wf.snapshot()
    except Exception:
        refs = []
    for item in refs:
        role = str(item.get("role") or "").strip().lower()
        label = str(item.get("label") or "").strip().lower()
        if role not in {"button", "link", "a"}:
            continue
        if not label:
            continue
        is_close = any(tok in label for tok in ("close", "dismiss", "not now", "got it", "skip"))
        is_helpish = any(tok in label for tok in ("help", "support", "tour", "tip", "assistant"))
        if not (is_close or is_helpish):
            continue
        ref = item.get("ref")
        if ref is None:
            continue
        try:
            await browser_act(BrowserActRequest(ref=str(ref), action="click", tab_id=wf.tab_id))
            await wf.wait(220)
        except Exception:
            continue

    # 4) Last resort: hide floating help widgets that intercept clicks.
    try:
        await browser_act(
            BrowserActRequest(
                action="evaluate",
                tab_id=wf.tab_id,
                value=(
                    "(() => {"
                    "const sels = ["
                    "'[aria-label*=\"help\" i]',"
                    "'[aria-label*=\"support\" i]',"
                    "'[class*=\"help\" i]',"
                    "'[class*=\"support\" i]',"
                    "'[id*=\"help\" i]',"
                    "'[id*=\"intercom\" i]'"
                    "];"
                    "for (const s of sels) {"
                    "  for (const el of document.querySelectorAll(s)) {"
                    "    const txt = ((el.getAttribute('aria-label')||'') + ' ' + (el.id||'') + ' ' + (el.className||'')).toLowerCase();"
                    "    if (/help|support|assistant|intercom|tour|tip/.test(txt)) {"
                    "      el.style.pointerEvents = 'none';"
                    "      el.style.visibility = 'hidden';"
                    "      el.style.opacity = '0';"
                    "    }"
                    "  }"
                    "}"
                    "return true;"
                    "})()"
                ),
            )
        )
    except Exception:
        pass


async def run() -> None:
    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    out_dir = Path("data/debug/salesnav_filter_live") / ts
    out_dir.mkdir(parents=True, exist_ok=True)

    wf = BrowserWorkflow(tab_id=None)
    if not await wf.bind_skill(task="salesnav_search_account", url=None, query="healthcare"):
        raise RuntimeError("Could not bind SalesNav account skill.")

    manifest: dict[str, Any] = {
        "started_at": ts,
        "task": "salesnav_search_account",
        "results": [],
    }

    for idx, (name, value) in enumerate(FILTER_CASES.items(), start=1):
        row: dict[str, Any] = {"filter": name, "value": value, "index": idx}
        try:
            await _prepare_search_state(wf, keyword="AI")
            await _mitigate_help_overlay(wf)
            tab_id = str(wf.tab_id or "")
            if not tab_id:
                raise RuntimeError("No tab_id available after search setup.")

            before_file = out_dir / f"{idx:02d}_{name}_before.jpg"
            await _save_screenshot(tab_id, before_file)

            ok = await wf.apply_filter(name, value)
            if not ok:
                await _mitigate_help_overlay(wf)
                ok = await wf.apply_filter(name, value)
            await recipes._wait_results_settle(wf, 2_200)
            await wf.wait(400)

            after_file = out_dir / f"{idx:02d}_{name}_after.jpg"
            await _save_screenshot(tab_id, after_file)

            row.update(
                {
                    "ok": bool(ok),
                    "tab_id": tab_id,
                    "url": (await wf.current_url()) or "",
                    "before_screenshot": str(before_file).replace("\\", "/"),
                    "after_screenshot": str(after_file).replace("\\", "/"),
                    "debug": wf.last_debug.get(f"filter_{name}"),
                }
            )
        except Exception as exc:
            row.update(
                {
                    "ok": False,
                    "error": str(exc),
                    "url": (await wf.current_url()) or "",
                }
            )
        manifest["results"].append(row)
        print(f"[{idx:02d}/{len(FILTER_CASES)}] {name} -> ok={row.get('ok')}")

    manifest["finished_at"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    manifest_path = out_dir / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")

    passed = sum(1 for r in manifest["results"] if r.get("ok"))
    total = len(manifest["results"])
    print(f"\nSaved results to: {manifest_path}")
    print(f"Filter checks passed: {passed}/{total}")


if __name__ == "__main__":
    asyncio.run(run())
