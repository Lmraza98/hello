---
summary: "Markdown skill layer for reusable, self-repairing website automation on top of browser_nav."
read_when:
  - You are adding automation for a new website
  - You need to debug selector drift or repeated browser failures
  - You want reusable, shareable website workflows for the assistant
title: "Browser Website Skills"
---

# Browser Website Skills

Browser website skills are markdown files that store durable interaction hints for specific sites and tasks.
They are designed to sit above generic `browser_*` primitives and below task workflows.

## Why This Layer Exists

- Keep browser automation generic (`navigate`, `snapshot`, `find_ref`, `act`).
- Move site/task specifics into editable files instead of hardcoded selectors.
- Allow runtime repair notes when UI drift causes failures.
- Make website automation reusable and shareable.

## Storage Model

- Default directory: `skills/websites/`
- One file per skill: `<skill_id>.md`
- Config override: `BROWSER_SKILLS_DIR`

Implemented in:

- `services/browser_skills/store.py`

## Skill File Format

Use frontmatter + structured sections.

```md
---
name: LinkedIn Sales Navigator Accounts
description: Search and filter account results.
domains:
  - linkedin.com/sales/search/company
tasks:
  - salesnav_search_account
tags:
  - salesnav
  - linkedin
version: 1
---

## Action Hints
- search_input | role=input | text=Search
- headquarters_location_filter | role=button | text=Headquarters location
- headquarters_location_input | role=input | text=Add locations

## Repair Log
- 2026-02-14T00:00:00Z | issue=seeded
```

## Runtime Flow

1. Workflow navigates to page (`browser_navigate`).
2. Workflow matches best skill (`match_skill(url, task, query)`).
3. Workflow resolves refs by iterating through **all** matching `Action Hints` variants for an action (to handle UI drift),
   then falls back to generic text matching.
4. Workflow recipes infer extraction kinds from skill frontmatter (see "Extraction Rules").
5. If key steps fail after exhausting all hint variants, the workflow appends a repair note (including attempted hints).
5. Assistant (or operator) updates the same markdown skill via API/tools.

Current usage:

- `services/browser_workflow.py` (engine)
- `services/browser_workflows/recipes.py` (generic recipes)
- `services/google/workflows.py` (dedicated Google search workflow using browser primitives)
- `api/routes/*` (API boundary; maps requests to generic recipes and returns legacy response shapes where needed)

## Google Skill + Dedicated Workflow

Google now has both:

- a website skill scaffold: `skills/websites/google-com-web-search.md` (`task: google_web_search`)
- a dedicated API/tool workflow: `POST /api/google/search-browser` (`google_search_browser`)

The dedicated workflow waits for AI Overview and returns:

- `ai_overview_present`
- `ai_overview_summary`
- `ai_overview_citations`
- `organic_results` (fallback when AI Overview is absent)

## API Surface

- `GET /api/browser/skills`
- `POST /api/browser/skills/match`
- `GET /api/browser/skills/{skill_id}`
- `PUT /api/browser/skills/{skill_id}`
- `DELETE /api/browser/skills/{skill_id}`
- `POST /api/browser/skills/{skill_id}/repair`

Route file:

- `api/routes/browser_skills.py`

## Assistant Tool Surface

Chat tools expose the same operations:

- `browser_skill_list`
- `browser_skill_match`
- `browser_skill_get`
- `browser_skill_upsert`
- `browser_skill_delete`
- `browser_skill_repair`

These are wired in:

- `ui/src/chat/tools.ts`
- `ui/src/chat/toolExecutor.ts`

## Operational Rules

- Prefer adding a hint over adding custom code for one site.
- Keep hints task-scoped (`search_input`, `result_card_link`, etc.).
- Add repair entries with context (`task`, `url`, `query`) for traceability.
- If a website changes frequently, keep skill files short and focused.

## Limits

- This is still deterministic DOM interaction, not full semantic vision control.
- Hints improve stability but do not eliminate anti-bot/rate-limit constraints.
- Some flows still need task workflow code for sequencing and data extraction.

## Extraction Rules

Extraction is fully skill-driven. Skills can define multiple extraction "kinds" by setting frontmatter keys:

- `extract_<kind>_href_contains`: list of substrings that must appear in the link href
- `extract_<kind>_label_field`: output field name for the label (default `name`)
- `extract_<kind>_url_field`: output field name for the href (default `url`)
- `extract_<kind>_text_regex`: regex to extract values from `snapshot_text` when the desired data is not attached to links
- optional: `extract_<kind>_text_flags`: regex flags as a string (`i` = ignorecase, `m` = multiline, `s` = dotall)
- optional: `extract_<kind>_text_group`: capture group to return (number or group name). Default is group 1 if present, else group 0.
- optional: `extract_<kind>_banned_prefixes`, `extract_<kind>_banned_contains`, `extract_<kind>_banned_exact`,
  `extract_<kind>_strip_suffixes`, `extract_<kind>_min_label_len`

Examples:

- `extract_company_href_contains: ["/sales/company/"]`
- `extract_lead_href_contains: ["/sales/lead/", "/in/"]`
- `extract_views_text_regex: "\b([0-9][0-9,.]+)\s+views\b"`

Notes:

- Skill frontmatter parsing is intentionally simple and does not unescape backslashes. That means your regex should use
  single backslashes (e.g. `\b`, `\s`) rather than double-escaped sequences (e.g. `\\b`, `\\s`).
- Frontmatter is YAML-like but not full YAML: avoid comments (`# ...`) and nested objects.

Workflow recipes (like `search-and-extract`) can omit `extract_type`. The server will auto-select an extraction kind
by scanning the skill's `extract_*_href_contains` and `extract_*_text_regex` keys (preferring `lead`, then `company`, then `person`, else first available).
