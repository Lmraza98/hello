"""List documentation files and their metadata.

LeadPilot-style workflow:
- each docs page should define frontmatter `summary` and optional `read_when`
- this script gives a compact listing for humans and agents

Usage:
    python scripts/docs_list.py
    python scripts/docs_list.py --strict
"""

from __future__ import annotations

import argparse
from pathlib import Path
import re
import sys


ROOT = Path(__file__).resolve().parents[1]
DOCS_DIR = ROOT / "docs"
EXCLUDED_DIRS = {"archive", "research"}
MD_EXTS = {".md", ".mdx"}


def _compact(values: list[str]) -> list[str]:
    out: list[str] = []
    for value in values:
        normalized = value.strip()
        if normalized:
            out.append(normalized)
    return out


def _walk_docs(path: Path) -> list[Path]:
    files: list[Path] = []
    for child in path.iterdir():
        if child.name.startswith("."):
            continue
        if child.is_dir():
            if child.name in EXCLUDED_DIRS:
                continue
            files.extend(_walk_docs(child))
            continue
        if child.suffix.lower() in MD_EXTS:
            files.append(child)
    return sorted(files)


def _extract_frontmatter(text: str) -> tuple[str | None, str]:
    if not text.startswith("---"):
        return None, "missing front matter"
    match = re.search(r"^---\s*\n(.*?)\n---\s*\n?", text, flags=re.DOTALL)
    if not match:
        return None, "unterminated front matter"
    return match.group(1), ""


def _extract_metadata(text: str) -> tuple[str | None, list[str], str]:
    frontmatter, error = _extract_frontmatter(text)
    if frontmatter is None:
        return None, [], error

    summary: str | None = None
    read_when: list[str] = []
    collecting_read_when = False

    for raw_line in frontmatter.splitlines():
        line = raw_line.strip()
        if line.startswith("summary:"):
            raw_value = line.split(":", 1)[1].strip()
            summary = raw_value.strip("'\"")
            collecting_read_when = False
            continue

        if line.startswith("read_when:"):
            collecting_read_when = True
            inline = line.split(":", 1)[1].strip()
            if inline.startswith("[") and inline.endswith("]"):
                values = [
                    item.strip().strip("'\"")
                    for item in inline[1:-1].split(",")
                    if item.strip()
                ]
                read_when.extend(values)
            continue

        if collecting_read_when:
            if line.startswith("- "):
                read_when.append(line[2:].strip().strip("'\""))
                continue
            if line == "":
                continue
            collecting_read_when = False

    if not summary:
        return None, _compact(read_when), "summary key missing"

    return summary, _compact(read_when), ""


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--strict",
        action="store_true",
        help="Exit non-zero when a docs page is missing required metadata.",
    )
    args = parser.parse_args()

    if not DOCS_DIR.exists() or not DOCS_DIR.is_dir():
        print("docs:list: missing docs directory. Run from repo root.", file=sys.stderr)
        return 1

    print("Listing all markdown files in docs folder:")
    missing_metadata = 0

    for file_path in _walk_docs(DOCS_DIR):
        rel = file_path.relative_to(DOCS_DIR).as_posix()
        summary, read_when, error = _extract_metadata(file_path.read_text(encoding="utf-8"))
        if summary:
            print(f"{rel} - {summary}")
            if read_when:
                print(f"  Read when: {'; '.join(read_when)}")
        else:
            missing_metadata += 1
            suffix = f" - [{error}]" if error else ""
            print(f"{rel}{suffix}")

    print(
        '\nReminder: keep docs up to date as behavior changes. When your task matches any "Read when" hint, read that doc before coding.',
    )

    if args.strict and missing_metadata > 0:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
