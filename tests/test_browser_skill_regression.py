from pathlib import Path
import shutil
import uuid

from services.web_automation.browser.skills import store
from services.web_automation.browser.skills.store import _extract_regression_tests
from services.web_automation.browser.workflows.regression import (
    evaluate_promotion_gate,
    evaluate_regression_expectation,
)


def test_extract_regression_tests_from_markdown_section():
    content = """---
name: Example
version: 1
---

# Example

## Tests
- smoke | task=example_search | query=weather | min_items=1 | max_items=25 | extract_type=item
- pagination | task=example_search | query=forecast | min_items=10 | max_items=120
"""
    tests = _extract_regression_tests(content)
    assert len(tests) == 2
    assert tests[0]["name"] == "smoke"
    assert tests[0]["task"] == "example_search"
    assert tests[0]["min_items"] == 1
    assert tests[1]["name"] == "pagination"
    assert tests[1]["max_items"] == 120


def test_evaluate_regression_expectation():
    ok_case = evaluate_regression_expectation(count=12, min_items=5, max_items=20)
    assert ok_case["ok"] is True
    fail_case = evaluate_regression_expectation(count=2, min_items=5, max_items=20)
    assert fail_case["ok"] is False


def test_evaluate_promotion_gate():
    good = evaluate_promotion_gate(total=3, failures=0)
    assert good["ready_for_promotion"] is True
    blocked = evaluate_promotion_gate(total=3, failures=1)
    assert blocked["ready_for_promotion"] is False


def test_update_skill_frontmatter_sets_qa_fields(monkeypatch):
    test_dir = Path("data") / f"test_tmp_skills_promote_{uuid.uuid4().hex[:8]}"
    test_dir.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(store, "SKILLS_DIR", test_dir)
    monkeypatch.setattr(store, "ensure_seed_skills", lambda: None)

    content = """---
name: Promote Skill
description: test
domains:
  - example.com
tasks:
  - example_search
version: 1
---

# Promote
"""
    store.upsert_skill("promote-skill", content)
    updated = store.update_skill_frontmatter(
        "promote-skill",
        {
            "qa_status": "ready",
            "last_regression_total": 2,
            "last_regression_passes": 2,
            "last_regression_failures": 0,
            "last_regression_at": "2026-02-19T00:00:00+00:00",
        },
    )
    assert updated["qa_status"] == "ready"
    assert updated["ready_for_promotion"] is True
    assert updated["last_regression_failures"] == 0
    shutil.rmtree(test_dir, ignore_errors=True)
