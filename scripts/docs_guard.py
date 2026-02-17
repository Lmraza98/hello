"""Guardrail that enforces docs updates alongside behavior changes.

Usage:
    python scripts/docs_guard.py
    python scripts/docs_guard.py --staged
"""

from __future__ import annotations

import argparse
from pathlib import Path
import subprocess
import sys


ROOT = Path(__file__).resolve().parents[1]

CODE_PREFIXES = (
    "api/",
    "services/",
    "ui/src/",
    "zco-bi/src/",
    "zco-bi/scripts/",
)
CODE_FILES = {
    "app.py",
    "main.py",
    "config.py",
    "database.py",
}
DOC_PREFIXES = (
    "docs/",
)
DOC_FILES = {
    "README.md",
}
DOC_SUFFIXES = (".md", ".mdx", ".json")


def _git_changed_files(staged: bool) -> list[str]:
    cmd = ["git", "diff", "--name-only"]
    if staged:
        cmd.append("--cached")
    completed = subprocess.run(
        cmd,
        cwd=ROOT,
        text=True,
        capture_output=True,
        check=False,
    )
    if completed.returncode != 0:
        raise RuntimeError(completed.stderr.strip() or "git diff failed")
    return [line.strip().replace("\\", "/") for line in completed.stdout.splitlines() if line.strip()]


def _is_behavior_file(path: str) -> bool:
    if path in CODE_FILES:
        return True
    return any(path.startswith(prefix) for prefix in CODE_PREFIXES)


def _is_doc_file(path: str) -> bool:
    if path in DOC_FILES:
        return True
    if any(path.startswith(prefix) for prefix in DOC_PREFIXES):
        return path.endswith(DOC_SUFFIXES)
    return False


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--staged",
        action="store_true",
        help="Inspect staged changes only.",
    )
    args = parser.parse_args()

    try:
        changed = _git_changed_files(staged=args.staged)
    except Exception as exc:
        print(f"docs-guard: {exc}", file=sys.stderr)
        return 2

    behavior_changes = [path for path in changed if _is_behavior_file(path)]
    doc_changes = [path for path in changed if _is_doc_file(path)]

    if not behavior_changes:
        print("docs-guard: no behavior-file changes detected; nothing to enforce.")
        return 0

    if doc_changes:
        print("docs-guard: docs updates detected with behavior changes.")
        print(f"  behavior_files={len(behavior_changes)} docs_files={len(doc_changes)}")
        return 0

    print("docs-guard: behavior changes found without docs updates.", file=sys.stderr)
    print("Changed behavior files:", file=sys.stderr)
    for path in behavior_changes[:20]:
        print(f"  - {path}", file=sys.stderr)
    if len(behavior_changes) > 20:
        print(f"  ... and {len(behavior_changes) - 20} more", file=sys.stderr)
    print("", file=sys.stderr)
    print("Add/update docs in docs/ (or README.md), then rerun:", file=sys.stderr)
    print("  python scripts/docs_ci.py", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
