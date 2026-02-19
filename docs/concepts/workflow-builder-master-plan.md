---
title: "Workflow Builder Master Plan"
summary: "Canonical end-to-end plan and completion status for the human-in-the-loop browser workflow builder."
read_when:
  - You want the single source of truth for workflow-builder scope
  - You need implementation status (done vs remaining)
  - You are planning next milestones for cross-site reliability
---

# Workflow Builder Master Plan

This is the canonical, cemented plan for the human-in-the-loop workflow builder, including:

- Architecture and product behavior
- Data and validation model
- Security and guardrails
- Implementation status across phases
- Explicit remaining work to reach full end-to-end completion

## Product Objective

Build a reusable, robust workflow-builder where:

1. The system observes pages deterministically.
2. LLMs propose candidates in strict schemas.
3. Deterministic engines validate and score.
4. Users annotate and correct visually.
5. The system repairs and persists versioned skills.
6. Skills auto-reuse on matching page templates and self-repair on drift.

## Core Loop (Target Architecture)

1. Preflight:
- Detect page mode (`list`, `detail`, `search_form`, `login_wall`, `consent`, `blocked`).
- Decide source preference (`network_json > structured_data > dom`).
- Enforce safety defaults (`read_only`, allowlisted domains/actions, budgets).

2. Observation Pack (deterministic):
- Cleaned DOM snapshot
- AX/role-oriented nodes and stable attributes
- Optional bounded network JSON samples
- Screenshot and layout landmarks
- Stabilization metadata (network idle + layout stable)

3. Candidate Proposals (LLM):
- `workflow_candidates[]`
- `extractor_candidates[]`
- `fallback selectors`
- `rationale + confidence`
- Output must pass strict schema.

4. Deterministic Validation:
- Selector matches, uniqueness, required fields, URL validity, type checks
- Pagination novelty, loop detection
- Fit score components (`coverage`, `completeness`, `precision_proxy`, `stability`, `cost`)

5. User Annotation:
- Overlay boxes on screenshot
- Positive and negative labeling at item and field level
- Constraints derived from user feedback

6. Repair and Persist:
- Revise selectors (deterministic first, LLM-assisted ranking)
- Re-validate
- Save versioned skill + repair log + score delta

7. Auto-Learning:
- Match page templates by robust multi-signal fingerprint
- Reuse skills when matched
- Trigger repair on validation/drift failures

## Improved End-to-End Loop (Canonical 0-6)

### 0) Preflight (deterministic)

- Classify page mode: list vs detail vs search form vs login wall vs consent modal.
- Prefer non-DOM sources when available:
  - network JSON endpoints
  - JSON-LD / microdata
  - RSS/sitemap (content-discovery use cases)
- Apply read-only safety policy by default (no destructive side effects).
- Output:
  - `page_mode`
  - `data_source_preference` (`network > structured > dom`)

### 1) Observe (deterministic, reproducible)

Capture one replayable Observation Pack:

- Browser/env: canonical URL, referrer, viewport/device scale, locale/timezone, user agent/platform
- Cookies metadata only (names/domains; never values to planner)
- DOM and semantics:
  - canonicalized cleaned DOM snapshot
  - AX tree roles/names/states with node mapping
  - pruned semantic DOM of interactive/content nodes
- Network:
  - HAR-like request index
  - bounded JSON samples for candidate endpoints
- Visual:
  - stabilized screenshot(s)
  - optional layout map (landmark/result bounding boxes)
- Stabilization criteria:
  - network idle + layout stable over N frames
  - deterministic scroll position and animation suppression

### 2) Hypothesize (LLM-assisted, schema-constrained)

LLM input: sanitized Observation Pack only.

LLM output (schema-validated):

- `workflow_candidates[]`
- `extractor_candidates[]`
- `data_source_plan`
- selector fallback strategies
- brittleness risk notes

Constraints:

- hard bans/penalties on brittle deep selectors unless justified
- confidence required per selector
- rationale is non-executable metadata

### 3) Verify + Score (deterministic, explainable)

- Selector verification:
  - counts, uniqueness, non-empty fields
  - URL normalization/validity
  - field type checks
  - domain/allowlist checks
- Workflow verification:
  - step success/timeouts/retries
  - pagination novelty (new items)
  - loop detection using URL/title/signature similarity
- Mutation test:
  - ignore unstable attrs (random IDs/classes) and re-evaluate robustness
- Fit score components:
  - coverage
  - completeness
  - precision proxy
  - stability
  - cost

### 4) Annotate with Positive/Negative Examples

- User marks positive result items and negative distractors (sidebar/nav/promoted).
- Field-level anchors:
  - include this element
  - exclude elements like this
  - enforce field-within-item constraints

### 5) Deterministic Selector Synthesis (LLM as advisor)

- Inputs: positives, negatives, selector primitives.
- Enumerate and optimize selectors using:
  - role/name (AX)
  - stable attrs
  - structural relations and scope constraints
- Objective: minimal selectors covering positives and excluding negatives.
- LLM used only for ranking/backup suggestions when deterministic synthesis needs help.
- Always re-verify deterministically.

### 6) Persist + Regression + Drift Repair

- Persist:
  - versioned skill
  - domain/url rules
  - workflow/extractor/validation
  - template signatures
  - repair log with before/after score delta
- Add regression fixtures:
  - smoke
  - pagination
  - empty-results
- Runtime drift monitor:
  - on validation failure, auto-capture new observation pack and enter repair loop

## Why HTML-only is fragile

Prefer these signals in order:

1. Network JSON
2. JSON-LD / microdata
3. AX role/name selectors
4. Stable attributes (`aria-*`, `name`, `placeholder`, `data-*`, `itemprop`, `href` patterns)
5. Shallow structural selectors
6. Deep CSS/XPath only as penalized fallback

## Skill Data Model (Required)

- `match`: domains + URL patterns
- `policy`: read-only flag, allowed domains, budgets
- `workflow`: typed steps with selector prefer/fallback
- `extraction`: item container + fields + post-processing
- `validation`: invariants and thresholds
- `fingerprints`: template matching keys
- `tests`: smoke + regression fixtures
- `repair_log`: failures, changes, score deltas, timestamps

### Selector Strategy Hierarchy (Required)

1. Network JSON
2. Structured markup (JSON-LD/microdata)
3. AX role-based selectors
4. Stable attributes
5. Text anchors (localization-aware)
6. Shallow CSS
7. Deep CSS / `nth-child` (penalized last resort)

Selectors must be persisted as ordered fallback stacks, not single strings.

## Guardrails (Required)

- Budgets: max pages/clicks/scrolls/time
- Loop/trap detection
- Stop reasons:
  - `STOP_BUDGET_EXCEEDED`
  - `STOP_LOOP_DETECTED`
  - `STOP_NO_NEW_ITEMS`
  - `STOP_BLOCKED`
  - `STOP_VALIDATION_FAILED`
- Duplicate suppression
- Rate limiting/polite concurrency
- Compliance hook for policy decisions
- Never attempt CAPTCHA bypass; treat as `STOP_BLOCKED` with handoff/termination path.

## Security Model (Required)

- Page content is untrusted input
- Prompt-injection containment (data never overrides trusted instructions)
- No secrets/cookie values sent to LLM
- Secrets resolved only in executor via opaque references
- Per-skill domain/action allowlists

## Model Role Split

- Planner model (Qwen-class): propose/rank workflow and extraction candidates
- Deterministic engines: synthesis/validation/scoring/drift/loop controls
- Small model (Gemma-class): summarize extracted content/entity extraction post-capture

## Upgraded Skill Schema (Illustrative)

```yaml
id: example_search_list
version: 1.2.0

match:
  domains: ["example.com"]
  url_patterns:
    - "^https://example\\.com/search(\\?.*)?$"
  locale: "en-US"

policy:
  read_only: true
  allowed_domains: ["example.com"]
  max_pages: 5
  max_clicks: 30
  max_time_ms: 60000

fingerprints:
  - type: landmark_graph
    main_heading_regex: "(?i)search|results"
    roles_present: ["main", "searchbox", "list"]

workflow:
  - action: navigate
    url: "{{start_url}}"
    wait_until: ["network_idle", "layout_stable"]
  - action: maybe_dismiss
    timeout_ms: 2000
  - action: type
    selector:
      prefer:
        - { role: "searchbox", name_regex: "(?i)search" }
      fallback:
        - { css: "input[name='q']" }
    value: "{{query}}"
  - action: press
    keys: ["Enter"]
    wait_until: ["network_idle", "layout_stable"]

extraction:
  source_preference: ["network_json", "structured_data", "dom"]
  item_container:
    selector:
      prefer:
        - { role: "listitem", within_role: "main" }
  fields:
    title:
      selector:
        prefer:
          - { role: "heading", level: [2,3], within: "item_container" }
      post: ["trim"]
    url:
      selector:
        prefer:
          - { role: "link", within: "item_container", attr: "href" }
      post: ["normalize_url"]

validation:
  rules:
    - { rule: "count_between", target: "items", min: 1, max: 50 }
    - { rule: "required_fields", fields: ["title", "url"] }
    - { rule: "unique", field: "url", min_unique_fraction: 0.95 }

tests:
  - name: smoke
    input: { start_url: "https://example.com/search", query: "test" }
    expect: { min_items: 5 }
```

## Implementation Status Matrix

Legend: `DONE`, `IN_PROGRESS`, `NOT_DONE`

### Phase 1: Deterministic Foundation

- Observation Pack endpoint: `DONE`
- Deterministic validate-candidate endpoint + fit score: `DONE`
- Backward-compatible skill behavior: `DONE`

### Phase 2: Annotation and Feedback Repair

- Annotate endpoint with box artifacts: `DONE`
- Synthesize-from-feedback endpoint: `DONE`
- UI annotation loop (annotate -> include/exclude -> synthesize): `DONE`
- Deterministic selector synthesis from positive/negative examples (fully generalized, not href-pattern-centric): `IN_PROGRESS`

### Phase 3: Template Reuse and Drift

- Robust multi-signal fingerprint matching for skills: `IN_PROGRESS`
- Runtime drift monitor + auto-triggered repair flow: `IN_PROGRESS`
- Regression fixture execution wired per skill version: `IN_PROGRESS`

### Phase 4: Production Hardening

- Network-first extraction path generalized broadly: `IN_PROGRESS`
- Full policy/compliance hooks across all workflow actions: `IN_PROGRESS`
- Quality telemetry dashboard for fit-score trends and drift rates: `NOT_DONE`

### UX State (Current)

- Dedicated Browser Workbench page with live viewer and tab-management: `DONE`
- Progressive disclosure:
  - Collapsed tab rail + expandable manager
  - Bottom workflow drawer (collapsed by default, auto-open for annotate/validate/synthesize): `DONE`
- One-click pattern suggestion/autoseed (remove need for manual inspect/href guessing): `IN_PROGRESS`

## End-to-End Completion Criteria

This project is fully complete only when all of the following are true:

1. First-time setup on a new list page succeeds without devtools/inspect.
2. Selector synthesis uses positive/negative labeling as primary signal.
3. Saved skill auto-reuses on matching pages.
4. Drift auto-detects and enters repair loop automatically.
5. Regression tests run for each skill version before promotion.
6. Safety/policy constraints are enforced and auditable.
7. Operators can observe score trends and failure classes over time.

## High-Impact Conceptual Shift (Must Preserve)

Old pattern:

- LLM proposes selectors -> deterministic validate -> user fixes -> LLM repairs

Required pattern:

- LLM proposes intent -> user labels truth -> deterministic synthesizer builds selectors -> deterministic validator enforces invariants -> LLM ranks/backups only

## Immediate Next Milestones

1. Expand deterministic selector synthesis from token/role heuristics to richer structural constraints (ancestor/scope exclusions).
2. Finalize robust template fingerprint matching and drift-triggered repair.
3. Add per-skill regression fixture execution in CI/dev workflow.
4. Add operator telemetry for fit-score trends and failure classes.

## Execution Log (Current Pass)

Completed in this pass:

- Added canonical master plan documentation and linked it from docs entry points.
- Implemented progressive-disclosure Browser Workbench UX:
  - collapsed tab rail + expandable tab manager
  - workflow drawer collapsed by default with 25/50/full expansion
  - auto-open to 50% for annotate/validate/synthesize actions
- Fixed workflow action replay bug by nonce-gating action execution.
- Removed manual DevTools dependency for initial href seeding:
  - Observation Pack now drives auto-suggested href pattern chips in the UI
  - one-click pattern selection runs annotate directly
  - default href seed auto-populates from observed page signals when empty
- Upgraded feedback synthesis to return a deterministic structured candidate:
  - href pattern + positive label tokens + negative label tokens + role allowlist
  - synthesis validation now evaluates those constraints, not href-only
- Added observation-driven candidate seeds in UI:
  - ranked candidate cards from Observation Pack
  - one-click `Use + Validate` / `Use + Annotate`
  - manual DevTools inspection no longer required for initial candidate selection
- Added backend regression tests for deterministic synthesis/validation behavior:
  - structured candidate generation from include/exclude feedback
  - validation enforcement for label include/exclude + role allowlist
- Added deterministic structural scope constraints:
  - annotation artifacts now capture nearest landmark role per candidate box
  - synthesis now proposes `must_be_within_roles` and `exclude_within_roles`
  - validation enforces landmark scope constraints when provided
- Added deterministic container-hint constraints (ancestor signature):
  - observation/annotation now capture `container_hint` per candidate element
  - synthesis now proposes `container_hint_contains` and `exclude_container_hint_contains`
  - validation now enforces container include/exclude constraints
  - validate/synthesize endpoints now validate against enriched semantic rows (role refs + semantic nodes), so structural constraints are effective at runtime
- Added template fingerprint reuse + runtime drift monitor scaffolding:
  - skill store now computes/serializes observation fingerprints and uses them during `match_skill`
  - auto-learn now persists fingerprint metadata into skill frontmatter
  - workflow runtime now performs deterministic item-level invariants and emits `STOP_VALIDATION_FAILED` with repair payload + repair-log append
- Added skill-level regression harness (versioned checks):
  - skill markdown supports `## Tests` case definitions
  - new endpoint `POST /api/browser/skills/{skill_id}/regression-run`
  - deterministic pass/fail evaluation on expected item-count ranges per test case
- Added promotion gate policy:
  - new endpoint `POST /api/browser/skills/{skill_id}/promote`
  - promotion requires zero regression failures by default
  - skill metadata now persists QA status and latest regression stats (`qa_status`, `last_regression_*`, `last_regression_at`)

Still in progress:

- Deterministic selector synthesis from positive/negative labels with richer structural constraints.
- Robust fingerprint matching + drift-triggered repair loop.
- Full regression harness execution per skill version.
