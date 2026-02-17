"""Run the full documentation quality pipeline.

Usage:
    python scripts/docs_ci.py
    python scripts/docs_ci.py --skip-export
"""

from __future__ import annotations

import argparse
from pathlib import Path
import subprocess
import sys


ROOT = Path(__file__).resolve().parents[1]


def _run_step(args: list[str], label: str) -> int:
    print(f"[docs-ci] {label}...")
    completed = subprocess.run(args, cwd=ROOT)
    if completed.returncode != 0:
        print(f"[docs-ci] FAILED: {label}")
        return completed.returncode
    print(f"[docs-ci] OK: {label}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--skip-export",
        action="store_true",
        help="Skip OpenAPI export step.",
    )
    args = parser.parse_args()

    python = sys.executable
    steps: list[tuple[list[str], str]] = []
    if not args.skip_export:
        steps.append(([python, "scripts/export_api_docs.py"], "export_api_docs"))
    steps.append(([python, "scripts/check_capabilities_generated.py"], "capabilities_generated_check"))
    steps.append(([python, "scripts/docs_list.py", "--strict"], "docs_list_strict"))
    steps.append(([python, "scripts/docs_link_audit.py"], "docs_link_audit"))

    for cmd, label in steps:
        rc = _run_step(cmd, label)
        if rc != 0:
            return rc

    print("[docs-ci] All checks passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
