from __future__ import annotations

import ast
import json
from dataclasses import dataclass
from pathlib import Path


APP_DIR = Path(__file__).resolve().parents[1]
TESTS_DIR = APP_DIR / "tests"
OUT_PATH = APP_DIR / "config" / "launcher_case_deps.v1.json"

BACKEND_GATE = "tests/launcher/test_live_readiness_gates.py::test_gate_backend_api_ready"
BRIDGE_GATE = "tests/launcher/test_live_readiness_gates.py::test_gate_bridge_ready"
LIVE_FILE = "tests/api_routes/browser/test_workflow_builder_live_e2e.py"
LIVE_ORDER = [
    "test_live_tabs",
    "test_live_observation_pack",
    "test_live_validate_candidate",
    "test_live_annotate_candidate",
    "test_live_synthesize_from_feedback",
    "test_live_tasks",
]
LIVE_NODES = [f"{LIVE_FILE}::{name}" for name in LIVE_ORDER]
FIXED_DEPS: dict[str, list[str]] = {
    BACKEND_GATE: [],
    BRIDGE_GATE: [BACKEND_GATE],
}


@dataclass(slots=True)
class CaseRow:
    nodeid: str
    file: str
    order: int


def discover_cases() -> list[CaseRow]:
    rows: list[CaseRow] = []
    for path in sorted(TESTS_DIR.rglob("test_*.py")):
        rel = path.relative_to(APP_DIR).as_posix()
        try:
            tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        except Exception:
            continue
        order = 0
        for node in tree.body:
            if isinstance(node, ast.FunctionDef) and node.name.startswith("test_"):
                rows.append(CaseRow(nodeid=f"{rel}::{node.name}", file=rel, order=order))
                order += 1
            if isinstance(node, ast.ClassDef) and node.name.startswith("Test"):
                for child in node.body:
                    if isinstance(child, ast.FunctionDef) and child.name.startswith("test_"):
                        rows.append(CaseRow(nodeid=f"{rel}::{node.name}::{child.name}", file=rel, order=order))
                        order += 1
    return rows


def domain_key(file_path: str) -> str:
    if file_path.startswith("tests/api_routes/browser/"):
        return "api_browser"
    if file_path.startswith("tests/browser/"):
        return "browser"
    if file_path.startswith("tests/salesnav/"):
        return "salesnav"
    if file_path.startswith("tests/workflow_core/"):
        return "workflow_core"
    if file_path.startswith("tests/launcher/"):
        return "launcher"
    if file_path.startswith("tests/platform/"):
        return "platform"
    if file_path.startswith("tests/api_routes/"):
        return "api_routes"
    return "other"


def base_deps(nodeid: str, file_path: str) -> list[str]:
    if nodeid == BACKEND_GATE:
        return []
    if nodeid == BRIDGE_GATE:
        return [BACKEND_GATE]
    if file_path == LIVE_FILE:
        return [BRIDGE_GATE]
    if file_path.startswith("tests/api_routes/browser/") or file_path.startswith("tests/browser/"):
        return [BRIDGE_GATE]
    return [BACKEND_GATE]


def build_deps(rows: list[CaseRow]) -> dict[str, list[str]]:
    by_file: dict[str, list[CaseRow]] = {}
    for row in rows:
        by_file.setdefault(row.file, []).append(row)
    for file_rows in by_file.values():
        file_rows.sort(key=lambda r: r.order)
    domain_files: dict[str, list[str]] = {}
    for file_path in by_file:
        domain_files.setdefault(domain_key(file_path), []).append(file_path)
    for files in domain_files.values():
        files.sort()
    domain_anchor_file: dict[str, str] = {domain: files[0] for domain, files in domain_files.items() if files}

    deps_by_id: dict[str, list[str]] = {row.nodeid: [] for row in rows}

    # Chain tests within each file and attach base gate deps only to file entry nodes.
    # This keeps semantic prerequisites while avoiding edge explosion from gate->every-node.
    for file_path, file_rows in by_file.items():
        if file_path == LIVE_FILE:
            continue
        for idx, row in enumerate(file_rows):
            if row.nodeid in FIXED_DEPS:
                continue
            if idx == 0:
                # Gate deps only on the first file anchor per domain to avoid
                # large fan-out edge bundles in aggregate graph rendering.
                if domain_anchor_file.get(domain_key(file_path)) == file_path:
                    deps_by_id[row.nodeid].extend(base_deps(row.nodeid, row.file))
            else:
                deps_by_id[row.nodeid].append(file_rows[idx - 1].nodeid)

    # Chain files within domains to avoid free-floating domain roots.
    for domain, files in domain_files.items():
        prev_last: str | None = None
        for file_path in files:
            if file_path == LIVE_FILE:
                continue
            file_rows = by_file[file_path]
            if not file_rows:
                continue
            first_id = file_rows[0].nodeid
            if first_id in FIXED_DEPS:
                prev_last = file_rows[-1].nodeid
                continue
            if prev_last and prev_last != first_id:
                deps_by_id[first_id].append(prev_last)
            prev_last = file_rows[-1].nodeid

    # Explicit deterministic live flow override.
    for idx, nodeid in enumerate(LIVE_NODES):
        if nodeid not in deps_by_id:
            continue
        if idx == 0:
            deps_by_id[nodeid] = [BRIDGE_GATE]
        else:
            deps_by_id[nodeid] = [LIVE_NODES[idx - 1]]

    # Fixed gate dependencies must stay fixed and acyclic.
    for nodeid, deps in FIXED_DEPS.items():
        if nodeid in deps_by_id:
            deps_by_id[nodeid] = list(deps)

    # Normalize deps.
    normalized: dict[str, list[str]] = {}
    valid_ids = set(deps_by_id.keys())
    for nodeid, deps in deps_by_id.items():
        seen: set[str] = set()
        out: list[str] = []
        for dep in deps:
            if not dep or dep == nodeid:
                continue
            if dep not in valid_ids:
                continue
            if dep in seen:
                continue
            seen.add(dep)
            out.append(dep)
        normalized[nodeid] = out
    return normalized


def main() -> None:
    rows = discover_cases()
    deps_by_id = build_deps(rows)
    payload = {
        "version": "1",
        "description": "Auto-generated launcher case dependency map for pytest child DAG.",
        "steps": [{"id": nodeid, "deps": deps_by_id[nodeid]} for nodeid in sorted(deps_by_id.keys())],
    }
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {OUT_PATH} with {len(payload['steps'])} steps")


if __name__ == "__main__":
    main()
