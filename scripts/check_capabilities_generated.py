"""Ensure generated UI capability artifacts are up to date.

Usage:
    python scripts/check_capabilities_generated.py
"""

from __future__ import annotations

from pathlib import Path
import subprocess
import sys


ROOT = Path(__file__).resolve().parents[1]
TARGETS = [
    "ui/src/capabilities/generated/schema.ts",
    "ui/src/capabilities/generated/registry.json",
    "ui/src/capabilities/generated/AGENT_CAPABILITIES.md",
]


def main() -> int:
    python = sys.executable
    gen = subprocess.run([python, "scripts/generate_capabilities.py"], cwd=ROOT, check=False)
    if gen.returncode != 0:
        return gen.returncode

    diff = subprocess.run(
        ["git", "diff", "--name-only", "--", *TARGETS],
        cwd=ROOT,
        text=True,
        capture_output=True,
        check=False,
    )
    if diff.returncode != 0:
        print(diff.stderr.strip() or "git diff failed", file=sys.stderr)
        return diff.returncode

    changed = [line.strip() for line in diff.stdout.splitlines() if line.strip()]
    if changed:
        print("Capability artifacts are out of date. Regenerate and commit:", file=sys.stderr)
        for path in changed:
            print(f"  - {path}", file=sys.stderr)
        print("Run: npm --prefix ui run generate:capabilities", file=sys.stderr)
        return 1

    print("Capability artifacts are up to date.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
