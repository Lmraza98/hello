"""Install repository git hooks for docs enforcement.

Usage:
    python scripts/install_git_hooks.py
"""

from __future__ import annotations

from pathlib import Path
import os
import stat
import subprocess
import sys


ROOT = Path(__file__).resolve().parents[1]
HOOKS_DIR = ROOT / ".githooks"
PRE_COMMIT = HOOKS_DIR / "pre-commit"


def _run(cmd: list[str]) -> int:
    completed = subprocess.run(cmd, cwd=ROOT, check=False)
    return completed.returncode


def main() -> int:
    if not HOOKS_DIR.exists():
        print(f"hooks install failed: missing {HOOKS_DIR}", file=sys.stderr)
        return 1
    if not PRE_COMMIT.exists():
        print(f"hooks install failed: missing {PRE_COMMIT}", file=sys.stderr)
        return 1

    try:
        mode = os.stat(PRE_COMMIT).st_mode
        os.chmod(PRE_COMMIT, mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
    except OSError as exc:
        print(f"warning: could not set executable bit on {PRE_COMMIT}: {exc}", file=sys.stderr)

    rc = _run(["git", "config", "core.hooksPath", str(HOOKS_DIR)])
    if rc != 0:
        print("hooks install failed: git config core.hooksPath returned non-zero", file=sys.stderr)
        return rc

    print(f"Installed git hooks path: {HOOKS_DIR}")
    print("Pre-commit now enforces docs_guard (--staged) and docs_ci (--skip-export).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

