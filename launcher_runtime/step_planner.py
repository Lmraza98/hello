from __future__ import annotations

from dataclasses import dataclass, field


class StepPlanError(ValueError):
    """Raised when a step plan cannot be built."""


@dataclass(slots=True)
class StepNode:
    id: str
    label: str
    deps: list[str] = field(default_factory=list)
    kind: str = "action"
    cache_key: str | None = None
    provides: list[str] = field(default_factory=list)
    command_template: list[str] = field(default_factory=list)
    args: list[str] = field(default_factory=list)
    cwd: str = "."
    env_allowlist: list[str] = field(default_factory=list)
    timeout_sec: int = 300
    retries: int = 0


@dataclass(slots=True)
class PlannedStep:
    order: int
    step: StepNode


def _collect_with_deps(step_ids: list[str], steps: dict[str, StepNode]) -> set[str]:
    selected: set[str] = set()

    def visit(step_id: str) -> None:
        if step_id in selected:
            return
        if step_id not in steps:
            raise StepPlanError(f"unknown step id: {step_id}")
        selected.add(step_id)
        for dep in steps[step_id].deps:
            visit(dep)

    for sid in step_ids:
        visit(sid)
    return selected


def _topological_sort(selected: set[str], steps: dict[str, StepNode]) -> list[StepNode]:
    ordered: list[StepNode] = []
    temp: set[str] = set()
    perm: set[str] = set()

    def dfs(step_id: str) -> None:
        if step_id in perm:
            return
        if step_id in temp:
            raise StepPlanError(f"dependency cycle detected at {step_id}")
        temp.add(step_id)
        for dep in steps[step_id].deps:
            if dep in selected:
                dfs(dep)
        temp.remove(step_id)
        perm.add(step_id)
        ordered.append(steps[step_id])

    for sid in sorted(selected):
        dfs(sid)
    return ordered


def build_step_plan(steps: dict[str, StepNode], *, step_ids: list[str]) -> list[PlannedStep]:
    if not step_ids:
        raise StepPlanError("no step ids provided")
    selected = _collect_with_deps(step_ids, steps)
    ordered = _topological_sort(selected, steps)
    return [PlannedStep(order=i + 1, step=step) for i, step in enumerate(ordered)]

