from __future__ import annotations

from dataclasses import dataclass

from .catalog import TestCatalog, TestCase


class PlanError(ValueError):
    """Raised when a run plan cannot be built."""


@dataclass(slots=True)
class PlannedTest:
    order: int
    test: TestCase


def _collect_with_deps(test_ids: list[str], tests: dict[str, TestCase]) -> set[str]:
    selected: set[str] = set()

    def visit(test_id: str) -> None:
        if test_id in selected:
            return
        if test_id not in tests:
            raise PlanError(f"unknown test id: {test_id}")
        selected.add(test_id)
        for dep in tests[test_id].depends_on:
            visit(dep)

    for test_id in test_ids:
        visit(test_id)
    return selected


def _topological_sort(selected: set[str], tests: dict[str, TestCase]) -> list[TestCase]:
    ordered: list[TestCase] = []
    temp: set[str] = set()
    perm: set[str] = set()

    def dfs(test_id: str) -> None:
        if test_id in perm:
            return
        if test_id in temp:
            raise PlanError(f"dependency cycle detected at {test_id}")
        temp.add(test_id)
        for dep in tests[test_id].depends_on:
            if dep in selected:
                dfs(dep)
        temp.remove(test_id)
        perm.add(test_id)
        ordered.append(tests[test_id])

    for tid in sorted(selected):
        dfs(tid)

    return ordered


def build_run_plan(catalog: TestCatalog, *, test_ids: list[str] | None = None, tags: list[str] | None = None) -> list[PlannedTest]:
    tests = catalog.tests_by_id()
    enabled = {tid: t for tid, t in tests.items() if t.enabled}
    if not enabled:
        raise PlanError("catalog has no enabled tests")

    if test_ids:
        selected = _collect_with_deps(test_ids, enabled)
    else:
        selected = set(enabled.keys())

    if tags:
        tag_set = {tag.strip().lower() for tag in tags if tag.strip()}
        selected = {
            tid
            for tid in selected
            if any(tag.lower() in tag_set for tag in enabled[tid].tags)
        }
        if not selected:
            raise PlanError("no tests matched the selected tags")
        selected = _collect_with_deps(sorted(selected), enabled)

    ordered = _topological_sort(selected, enabled)
    return [PlannedTest(order=i + 1, test=test) for i, test in enumerate(ordered)]
