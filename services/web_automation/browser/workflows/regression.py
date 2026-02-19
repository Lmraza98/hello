"""Skill regression runner for workflow recipes.

Runs lightweight deterministic checks for skill-defined test cases.
"""

from __future__ import annotations

from typing import Any

from services.web_automation.browser.core.workflow import BrowserWorkflow
from services.web_automation.browser.skills.store import get_regression_tests, get_skill
from services.web_automation.browser.workflows.recipes import search_and_extract


def evaluate_regression_expectation(
    *,
    count: int,
    min_items: int | None = None,
    max_items: int | None = None,
) -> dict[str, Any]:
    min_n = int(min_items) if min_items is not None else 1
    max_n = int(max_items) if max_items is not None else 200
    ok = min_n <= int(count) <= max_n
    return {
        "ok": ok,
        "count": int(count),
        "min_items": min_n,
        "max_items": max_n,
    }


def evaluate_promotion_gate(*, total: int, failures: int) -> dict[str, Any]:
    t = max(0, int(total))
    f = max(0, int(failures))
    ready = bool(t > 0 and f == 0)
    return {
        "ready_for_promotion": ready,
        "reason": "all_tests_passed" if ready else ("no_tests_executed" if t == 0 else "regression_failures_present"),
        "total": t,
        "failures": f,
    }


async def run_skill_regression_suite(
    *,
    skill_id: str,
    tab_id: str | None = None,
    limit_tests: int | None = None,
) -> dict[str, Any]:
    skill = get_skill(skill_id)
    if not isinstance(skill, dict):
        return {"ok": False, "error": {"code": "skill_not_found", "message": f"Unknown skill: {skill_id}"}}

    frontmatter = skill.get("frontmatter") if isinstance(skill.get("frontmatter"), dict) else {}
    tests = get_regression_tests(skill_id)
    if not tests:
        default_task = ""
        tasks = frontmatter.get("tasks") if isinstance(frontmatter, dict) else []
        if isinstance(tasks, list) and tasks:
            default_task = str(tasks[0] or "").strip()
        tests = [
            {
                "name": "smoke",
                "task": default_task,
                "query": str(frontmatter.get("smoke_query") or frontmatter.get("example_query") or "").strip(),
                "extract_type": str(frontmatter.get("default_extract_kind") or "").strip(),
                "min_items": int(frontmatter.get("validation_min_items") or 1),
                "max_items": int(frontmatter.get("validation_max_items") or 200),
            }
        ]

    selected = tests[: max(1, int(limit_tests or len(tests)))]
    results: list[dict[str, Any]] = []
    passes = 0
    failures = 0

    for case in selected:
        name = str(case.get("name") or "test").strip() or "test"
        task = str(case.get("task") or "").strip()
        query = str(case.get("query") or "").strip()
        extract_type = str(case.get("extract_type") or "").strip() or None
        min_items = int(case.get("min_items") or 1)
        max_items = int(case.get("max_items") or 200)
        if not task:
            tasks = frontmatter.get("tasks") if isinstance(frontmatter, dict) else []
            if isinstance(tasks, list) and tasks:
                task = str(tasks[0] or "").strip()

        if not task:
            failures += 1
            results.append(
                {
                    "name": name,
                    "ok": False,
                    "error": {"code": "invalid_test", "message": "Missing task in regression case."},
                }
            )
            continue

        entry_url = str(case.get("start_url") or frontmatter.get("entry_url") or "").strip()
        current_tab_id = tab_id
        if entry_url:
            wf = BrowserWorkflow(tab_id=tab_id)
            try:
                await wf.navigate(entry_url)
                current_tab_id = wf.tab_id
            except Exception as exc:
                failures += 1
                results.append(
                    {
                        "name": name,
                        "ok": False,
                        "error": {"code": "navigate_failed", "message": str(exc)},
                    }
                )
                continue

        run = await search_and_extract(
            task=task,
            query=query,
            extract_type=extract_type,
            tab_id=current_tab_id,
            limit=max(1, max_items),
            wait_ms=1200,
            progress_cb=None,
        )
        if not isinstance(run, dict) or not run.get("ok"):
            failures += 1
            results.append(
                {
                    "name": name,
                    "ok": False,
                    "error": run.get("error") if isinstance(run, dict) else {"code": "run_failed", "message": "Unknown"},
                }
            )
            continue

        count = int(run.get("count") or 0)
        expectation = evaluate_regression_expectation(count=count, min_items=min_items, max_items=max_items)
        case_ok = bool(expectation.get("ok"))
        if case_ok:
            passes += 1
        else:
            failures += 1
        results.append(
            {
                "name": name,
                "ok": case_ok,
                "task": task,
                "query": query,
                "extract_type": run.get("extract_type"),
                "count": count,
                "expectation": expectation,
                "stop_reason": run.get("stop_reason"),
                "item_validation": run.get("item_validation"),
            }
        )

    return {
        "ok": True,
        "skill_id": skill_id,
        "total": len(results),
        "passes": passes,
        "failures": failures,
        "promotion_gate": evaluate_promotion_gate(total=len(results), failures=failures),
        "results": results,
    }
