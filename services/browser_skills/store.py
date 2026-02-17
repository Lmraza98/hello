"""Markdown-backed website skill store for browser automation.

Skills are plain .md files with YAML-like frontmatter and optional sections:

---
name: LinkedIn Sales Navigator Accounts
description: Search/filter/extract accounts from Sales Navigator.
domains:
  - linkedin.com/sales/search/company
tasks:
  - salesnav_search_account
tags:
  - linkedin
  - salesnav
version: 1
---

## Action Hints
- search_input | role=input | text=search
- headquarters_location_filter | role=button | text=headquarters location
- headquarters_location_input | role=input | text=add locations
"""

from __future__ import annotations

import datetime as dt
import os
from pathlib import Path
import re
from typing import Any

import config


SKILLS_DIR = Path(
    os.getenv(
        "BROWSER_SKILLS_DIR",
        str(config.BROWSER_SKILLS_DIR),
    )
)
FRONTMATTER_RE = re.compile(r"^---\s*\n(.*?)\n---\s*\n?", flags=re.DOTALL)
ACTION_HINTS_SECTION_RE = re.compile(
    r"(?ms)^##\s+Action Hints\s*\n(.*?)(?=^##\s|\Z)"
)
REPAIR_LOG_SECTION_RE = re.compile(r"(?ms)^##\s+Repair Log\s*\n(.*?)(?=^##\s|\Z)")
FRONTMATTER_LIST_FIELDS = {
    "domains",
    "tasks",
    "tags",
}


def _is_frontmatter_list_field(key: str) -> bool:
    """Return True if a frontmatter key should be parsed as a list.

    Keep this generic so skills can define arbitrary extraction kinds:
    - extract_<kind>_href_contains
    - extract_<kind>_banned_prefixes / _banned_contains / _banned_exact
    - extract_<kind>_strip_suffixes
    """
    if key in FRONTMATTER_LIST_FIELDS:
        return True
    if not isinstance(key, str):
        return False
    if key.startswith("extract_") and (
        key.endswith("_href_contains")
        or key.endswith("_banned_prefixes")
        or key.endswith("_banned_contains")
        or key.endswith("_banned_exact")
        or key.endswith("_strip_suffixes")
    ):
        return True
    return False


def _ensure_skills_dir() -> None:
    SKILLS_DIR.mkdir(parents=True, exist_ok=True)


def _normalize_skill_id(skill_id: str) -> str:
    value = re.sub(r"[^a-zA-Z0-9._-]+", "-", (skill_id or "").strip().lower())
    value = re.sub(r"-{2,}", "-", value).strip("-")
    return value


def _skill_path(skill_id: str) -> Path:
    safe_id = _normalize_skill_id(skill_id)
    if not safe_id:
        raise ValueError("invalid skill_id")
    return SKILLS_DIR / f"{safe_id}.md"


def _strip_quotes(value: str) -> str:
    v = value.strip()
    if len(v) >= 2 and ((v[0] == v[-1] == '"') or (v[0] == v[-1] == "'")):
        return v[1:-1]
    return v


def _extract_frontmatter(content: str) -> tuple[dict[str, Any], str]:
    match = FRONTMATTER_RE.search(content)
    if not match:
        return {}, content
    raw = match.group(1)
    body = content[match.end() :]
    lines = raw.splitlines()
    parsed: dict[str, Any] = {}
    current_list_key: str | None = None
    for raw_line in lines:
        line = raw_line.rstrip()
        stripped = line.strip()
        if not stripped:
            continue

        if stripped.startswith("- ") and current_list_key:
            parsed.setdefault(current_list_key, [])
            parsed[current_list_key].append(_strip_quotes(stripped[2:].strip()))
            continue

        m = re.match(r"^([A-Za-z0-9_.-]+):\s*(.*)$", stripped)
        if not m:
            current_list_key = None
            continue
        key = m.group(1).strip()
        value = m.group(2).strip()
        if not value:
            if _is_frontmatter_list_field(key):
                parsed[key] = []
                current_list_key = key
            else:
                parsed[key] = ""
                current_list_key = None
            continue

        current_list_key = None
        if _is_frontmatter_list_field(key):
            if value.startswith("[") and value.endswith("]"):
                inner = value[1:-1].strip()
                parsed[key] = (
                    [_strip_quotes(item.strip()) for item in inner.split(",") if item.strip()]
                    if inner
                    else []
                )
            else:
                parsed[key] = [_strip_quotes(value)]
        elif key == "version":
            try:
                parsed[key] = int(value)
            except Exception:
                parsed[key] = value
        else:
            parsed[key] = _strip_quotes(value)
    return parsed, body


def _render_frontmatter(frontmatter: dict[str, Any]) -> str:
    lines: list[str] = ["---"]
    ordered_keys = ["name", "description", "domains", "tasks", "tags", "version"]
    keys = ordered_keys + [k for k in frontmatter.keys() if k not in ordered_keys]
    seen: set[str] = set()
    for key in keys:
        if key in seen or key not in frontmatter:
            continue
        seen.add(key)
        value = frontmatter[key]
        if isinstance(value, list):
            lines.append(f"{key}:")
            for item in value:
                lines.append(f"  - {str(item).strip()}")
            continue
        lines.append(f"{key}: {value}")
    lines.append("---")
    return "\n".join(lines)


def _parse_action_hint_line(line: str) -> dict[str, str] | None:
    stripped = line.strip()
    if not stripped.startswith("- "):
        return None
    payload = stripped[2:].strip()
    if not payload:
        return None
    parts = [part.strip() for part in payload.split("|")]
    action = parts[0]
    if not action:
        return None
    role = ""
    text = ""
    for part in parts[1:]:
        if "=" not in part:
            continue
        k, v = part.split("=", 1)
        key = k.strip().lower()
        val = v.strip()
        if key == "role":
            role = val
        elif key == "text":
            text = val
    if not text:
        return None
    return {"action": action, "role": role, "text": text}


def _extract_action_hints(content: str) -> list[dict[str, str]]:
    section = ACTION_HINTS_SECTION_RE.search(content)
    if not section:
        return []
    block = section.group(1)
    hints: list[dict[str, str]] = []
    for raw_line in block.splitlines():
        parsed = _parse_action_hint_line(raw_line)
        if parsed:
            hints.append(parsed)
    return hints


def _count_repair_log_entries(content: str) -> int:
    section = REPAIR_LOG_SECTION_RE.search(content)
    if not section:
        return 0
    block = section.group(1)
    return sum(1 for line in block.splitlines() if line.strip().startswith("- "))


def _to_summary(path: Path, content: str) -> dict[str, Any]:
    frontmatter, _body = _extract_frontmatter(content)
    skill_id = path.stem
    hints = _extract_action_hints(content)
    return {
        "skill_id": skill_id,
        "name": frontmatter.get("name") or skill_id,
        "description": frontmatter.get("description") or "",
        "domains": list(frontmatter.get("domains") or []),
        "tasks": list(frontmatter.get("tasks") or []),
        "tags": list(frontmatter.get("tags") or []),
        "version": frontmatter.get("version") if frontmatter.get("version") is not None else 1,
        "action_hint_count": len(hints),
        "repair_log_count": _count_repair_log_entries(content),
        "updated_at": dt.datetime.fromtimestamp(path.stat().st_mtime, tz=dt.timezone.utc).isoformat(),
        "path": str(path),
    }


def _seed_salesnav_skill() -> None:
    _ensure_skills_dir()
    path = _skill_path("linkedin-salesnav-accounts")
    if path.exists():
        return
    seeded = """---
name: LinkedIn Sales Navigator Accounts
description: Reusable browser skill for searching and filtering Sales Navigator account results.
domains:
  - linkedin.com/sales/search/company
  - linkedin.com/sales/search
tasks:
  - salesnav_search_account
  - salesnav_extract_companies
tags:
  - linkedin
  - salesnav
  - account-search
version: 1
---

# LinkedIn Sales Navigator Accounts

## Objective

Navigate account search, apply filters, and extract company rows reliably.

## Action Hints
- search_input | role=input | text=search
- headquarters_location_filter | role=button | text=headquarters location
- headquarters_location_input | role=input | text=add locations
- headquarters_location_input_fallback | role=input | text=location
- industry_filter | role=button | text=industry

## Extraction Hints

- Company links contain `/sales/company/`.
- Skip labels like "View all strategic priorities" and "Save search".

## Repair Log
- Seeded skill created automatically.
"""
    path.write_text(seeded.strip() + "\n", encoding="utf-8")


def ensure_seed_skills() -> None:
    _seed_salesnav_skill()


def list_skills() -> list[dict[str, Any]]:
    _ensure_skills_dir()
    ensure_seed_skills()
    out: list[dict[str, Any]] = []
    for path in sorted(SKILLS_DIR.glob("*.md")):
        try:
            content = path.read_text(encoding="utf-8")
        except Exception:
            continue
        out.append(_to_summary(path, content))
    return out


def get_skill(skill_id: str) -> dict[str, Any] | None:
    path = _skill_path(skill_id)
    if not path.exists():
        return None
    content = path.read_text(encoding="utf-8")
    frontmatter, _ = _extract_frontmatter(content)
    summary = _to_summary(path, content)
    summary["content"] = content
    summary["frontmatter"] = frontmatter
    summary["action_hints"] = _extract_action_hints(content)
    return summary


def upsert_skill(skill_id: str, content: str) -> dict[str, Any]:
    _ensure_skills_dir()
    path = _skill_path(skill_id)
    text = (content or "").strip()
    if not text:
        raise ValueError("content must not be empty")
    if not text.startswith("---"):
        default_frontmatter = {
            "name": skill_id,
            "description": "Website automation skill",
            "domains": [],
            "tasks": [],
            "tags": [],
            "version": 1,
        }
        text = f"{_render_frontmatter(default_frontmatter)}\n\n{text}\n"
    if not text.endswith("\n"):
        text += "\n"
    path.write_text(text, encoding="utf-8")
    return get_skill(skill_id) or {}


def delete_skill(skill_id: str) -> bool:
    path = _skill_path(skill_id)
    if not path.exists():
        return False
    path.unlink()
    return True


def _url_match_score(url: str, domain_patterns: list[str]) -> int:
    if not url:
        return 0
    lower_url = url.lower()
    best = 0
    for pattern in domain_patterns:
        p = str(pattern or "").strip().lower()
        if not p:
            continue
        if lower_url == p:
            best = max(best, 100)
            continue
        if p in lower_url:
            best = max(best, 70)
    return best


def _token_overlap_score(query: str, tokens: list[str]) -> int:
    if not query or not tokens:
        return 0
    q = query.lower()
    score = 0
    for token in tokens:
        t = str(token or "").strip().lower()
        if t and t in q:
            score += 5
    return score


def match_skill(url: str | None, task: str | None = None, query: str | None = None) -> dict[str, Any] | None:
    candidates = list_skills()
    norm_task = (task or "").strip().lower()

    # If a task is provided, strongly prefer (and usually require) a skill that declares it.
    # This prevents "current URL" drift from binding the wrong skill when the agent is on a
    # different page than the desired entry_url.
    if norm_task:
        task_filtered = []
        for skill in candidates:
            tasks = [str(item).strip().lower() for item in (skill.get("tasks") or [])]
            if norm_task in tasks:
                task_filtered.append(skill)
        if task_filtered:
            candidates = task_filtered
    best: dict[str, Any] | None = None
    best_score = -1
    for skill in candidates:
        score = 0
        score += _url_match_score(url or "", skill.get("domains") or [])
        tasks = [str(item).strip().lower() for item in (skill.get("tasks") or [])]
        if norm_task and norm_task in tasks:
            score += 35
        score += _token_overlap_score(query or "", skill.get("tags") or [])
        score += _token_overlap_score(query or "", tasks)
        if score > best_score:
            best_score = score
            best = {**skill, "match_score": score}
    if not best or best_score <= 0:
        return None
    return best


def get_action_hints(skill_id: str, action: str) -> list[dict[str, str]]:
    skill = get_skill(skill_id)
    if not skill:
        return []
    hints = skill.get("action_hints") or []
    normalized = (action or "").strip().lower()
    out = [
        hint
        for hint in hints
        if str(hint.get("action") or "").strip().lower() == normalized
    ]
    return out


def _upsert_action_hint(content: str, action: str, role: str | None, text: str) -> str:
    clean_action = action.strip()
    clean_text = text.strip()
    clean_role = (role or "").strip()
    if not clean_action or not clean_text:
        return content

    new_line = f"- {clean_action} | role={clean_role} | text={clean_text}" if clean_role else f"- {clean_action} | text={clean_text}"
    section = ACTION_HINTS_SECTION_RE.search(content)
    if not section:
        suffix = "\n" if not content.endswith("\n") else ""
        return f"{content}{suffix}\n## Action Hints\n{new_line}\n"

    block = section.group(1)
    lines = block.splitlines()
    replaced = False
    updated_lines: list[str] = []
    for line in lines:
        parsed = _parse_action_hint_line(line)
        if parsed and parsed["action"].strip().lower() == clean_action.lower():
            if not replaced:
                updated_lines.append(new_line)
                replaced = True
            continue
        updated_lines.append(line)
    if not replaced:
        if updated_lines and updated_lines[-1].strip():
            updated_lines.append(new_line)
        else:
            # keep trailing empty lines untouched, append before them
            insert_at = len(updated_lines)
            while insert_at > 0 and not updated_lines[insert_at - 1].strip():
                insert_at -= 1
            updated_lines.insert(insert_at, new_line)

    replacement = "\n".join(updated_lines)
    return content[: section.start(1)] + replacement + content[section.end(1) :]


def append_repair_note(
    skill_id: str,
    issue: str,
    *,
    context: dict[str, Any] | None = None,
    action: str | None = None,
    role: str | None = None,
    text: str | None = None,
) -> dict[str, Any]:
    skill = get_skill(skill_id)
    if not skill:
        raise ValueError(f"skill not found: {skill_id}")
    content = str(skill.get("content") or "")

    if action and text:
        content = _upsert_action_hint(content, action=action, role=role, text=text)

    timestamp = dt.datetime.now(tz=dt.timezone.utc).isoformat()
    context_str = ""
    if context:
        compact_pairs = []
        for key in sorted(context.keys()):
            value = context[key]
            compact_pairs.append(f"{key}={value}")
        if compact_pairs:
            context_str = " | " + ", ".join(compact_pairs)[:400]
    entry = f"- {timestamp} | issue={issue}{context_str}"

    section = REPAIR_LOG_SECTION_RE.search(content)
    if not section:
        suffix = "\n" if not content.endswith("\n") else ""
        content = f"{content}{suffix}\n## Repair Log\n{entry}\n"
    else:
        block = section.group(1)
        replacement = block
        if replacement and not replacement.endswith("\n"):
            replacement += "\n"
        replacement += f"{entry}\n"
        content = content[: section.start(1)] + replacement + content[section.end(1) :]

    upsert_skill(skill_id, content)
    return get_skill(skill_id) or {}
