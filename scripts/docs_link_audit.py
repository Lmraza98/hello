"""Audit internal docs links against docs routes and redirects.

Usage:
    python scripts/docs_link_audit.py
"""

from __future__ import annotations

import json
from pathlib import Path
import re
import sys


ROOT = Path(__file__).resolve().parents[1]
DOCS_DIR = ROOT / "docs"
DOCS_JSON_PATH = DOCS_DIR / "docs.json"
MD_EXTS = {".md", ".mdx"}


def _normalize_route(value: str) -> str:
    stripped = value.strip().strip("/")
    return "/" if not stripped else f"/{stripped}"


def _walk_files(path: Path) -> list[Path]:
    out: list[Path] = []
    for child in path.iterdir():
        if child.name.startswith("."):
            continue
        if child.is_dir():
            out.extend(_walk_files(child))
            continue
        if child.suffix.lower() in MD_EXTS:
            out.append(child)
    return out


def _extract_frontmatter(text: str) -> str | None:
    if not text.startswith("---"):
        return None
    match = re.search(r"^---\s*\n(.*?)\n---\s*\n?", text, flags=re.DOTALL)
    if not match:
        return None
    return match.group(1)


def _extract_permalink(frontmatter: str | None) -> str | None:
    if not frontmatter:
        return None
    match = re.search(r"^permalink:\s*(.+?)\s*$", frontmatter, flags=re.MULTILINE)
    if not match:
        return None
    return match.group(1).strip().strip("'\"")


def _strip_inline_code(line: str) -> str:
    return re.sub(r"`[^`]+`", "", line)


def _route_candidates(relative_doc: str) -> list[str]:
    slug = re.sub(r"\.(md|mdx)$", "", relative_doc, flags=re.IGNORECASE)
    candidates = [_normalize_route(slug)]
    if slug == "index":
        candidates.append("/")
    if slug.endswith("/index"):
        candidates.append(_normalize_route(slug[: -len("/index")]))
    return candidates


def main() -> int:
    if not DOCS_DIR.exists() or not DOCS_DIR.is_dir():
        print("docs:check-links: missing docs directory; run from repo root.", file=sys.stderr)
        return 1
    if not DOCS_JSON_PATH.exists():
        print("docs:check-links: missing docs/docs.json.", file=sys.stderr)
        return 1

    docs_config = json.loads(DOCS_JSON_PATH.read_text(encoding="utf-8"))
    redirects: dict[str, str] = {}
    for item in docs_config.get("redirects", []):
        source = _normalize_route(str(item.get("source", "")))
        destination = _normalize_route(str(item.get("destination", "")))
        redirects[source] = destination

    markdown_files = _walk_files(DOCS_DIR)
    markdown_rel = [path.relative_to(DOCS_DIR).as_posix() for path in markdown_files]
    markdown_rel_set = set(markdown_rel)

    routes: set[str] = set()
    for rel_path in markdown_rel:
        for candidate in _route_candidates(rel_path):
            routes.add(candidate)
        full_path = DOCS_DIR / rel_path
        text = full_path.read_text(encoding="utf-8")
        permalink = _extract_permalink(_extract_frontmatter(text))
        if permalink:
            routes.add(_normalize_route(permalink))

    def resolve_route(route: str) -> tuple[bool, str]:
        current = _normalize_route(route)
        seen = {current}
        while current in redirects:
            current = redirects[current]
            if current in seen:
                return False, current
            seen.add(current)
        return (current in routes), current

    markdown_link_re = re.compile(r"!?\[[^\]]*\]\(([^)]+)\)")
    broken: list[tuple[str, int, str, str]] = []
    checked = 0

    for rel_path in markdown_rel:
        full_path = DOCS_DIR / rel_path
        raw_text = full_path.read_text(encoding="utf-8")
        base_dir = Path(rel_path).parent.as_posix()
        lines = raw_text.splitlines()
        in_code_fence = False

        for idx, raw_line in enumerate(lines, start=1):
            line = raw_line.strip()
            if line.startswith("```"):
                in_code_fence = not in_code_fence
                continue
            if in_code_fence:
                continue

            line = _strip_inline_code(raw_line)
            for match in markdown_link_re.finditer(line):
                raw = (match.group(1) or "").strip()
                if not raw:
                    continue
                if re.match(r"^(https?:|mailto:|tel:|data:|#)", raw, flags=re.IGNORECASE):
                    continue

                path_part = raw.split("#", 1)[0].split("?", 1)[0].strip()
                if not path_part:
                    continue

                checked += 1
                if path_part.startswith("/"):
                    ok, terminal = resolve_route(path_part)
                    if ok:
                        continue
                    static_rel = path_part.lstrip("/")
                    if static_rel not in markdown_rel_set:
                        broken.append((rel_path, idx, raw, f"route/file not found (terminal: {terminal})"))
                    continue

                # Skip simple placeholders in code-ish prose.
                if not path_part.startswith(".") and "/" not in path_part:
                    continue

                joined = Path(base_dir) / path_part
                normalized = joined.as_posix()
                if re.search(r"\.[a-zA-Z0-9]+$", normalized):
                    if normalized not in markdown_rel_set:
                        broken.append((rel_path, idx, raw, "relative file not found"))
                    continue

                candidates = [
                    normalized,
                    f"{normalized}.md",
                    f"{normalized}.mdx",
                    f"{normalized}/index.md",
                    f"{normalized}/index.mdx",
                ]
                if not any(candidate in markdown_rel_set for candidate in candidates):
                    broken.append((rel_path, idx, raw, "relative doc target not found"))

    print(f"checked_internal_links={checked}")
    print(f"broken_links={len(broken)}")
    for rel_path, line_num, link, reason in broken:
        print(f"{rel_path}:{line_num} :: {link} :: {reason}")

    return 1 if broken else 0


if __name__ == "__main__":
    raise SystemExit(main())
