---
summary: "General browser automation architecture and how the assistant uses LeadPilot-style browser primitives."
read_when:
  - You are changing browser automation behavior
  - You are debugging SalesNav search/extraction issues
title: "Browser Automation"
---

# Browser Automation

The architecture is intentionally split into two layers.

## Layer 1: Generic Browser Primitives

`api/routes/browser_nav.py` exposes generic operations:

- navigate
- snapshot
- find_ref
- act
- wait
- screenshot
- tabs/health

These primitives should stay website-agnostic.

Implementation note: `api/routes/browser_nav.py` is a thin router only. The backend implementations live under:

- `services/web_automation/browser/backends/local_playwright.py`
- `services/web_automation/browser/backends/leadpilot.py`
- `services/web_automation/browser/backends/proxy.py`
- `services/web_automation/browser/backends/factory.py` (selects backend via `BROWSER_GATEWAY_MODE`)

### Browser Backends (`BROWSER_GATEWAY_MODE`)

The same API can be backed by different browser engines:

- `local` (default): in-process Playwright session managed by `services/web_automation/browser/backends/local_playwright.py`.
- `proxy`: forwards requests to a remote gateway that implements the same contract.
- `leadpilot`: uses the LeadPilot browser bridge server (stable role refs + CDP targetIds).
- `camoufox`: Firefox/Camoufox-backed in-process Playwright session via `services/web_automation/browser/backends/camoufox.py`.

In `camoufox` mode:

- The public browser API contract is identical to `local` mode (`tabs/navigate/snapshot/find_ref/act/wait/screenshot`).
- Session persistence behavior remains the same (including LinkedIn storage-state bootstrap from `data/linkedin_auth.json` when present).
- Workflows under `api/routes/browser_workflows.py` and `services/web_automation/browser/workflows/recipes.py` run unchanged.

In `leadpilot` mode:

- `ref`s are stable role refs coming from LeadPilot role snapshots (not DOM indices).
- Tab identity is derived from LeadPilot `targetId`s and mapped into our `tab-<n>` ids (stable mapping across refreshes).
- `act:evaluate` is intentionally disabled (skills should rely on snapshot + action hints, not inline scripts).
- When navigating to LinkedIn/SalesNav, the backend will (best-effort) import cookies from `data/linkedin_auth.json`
  into the LeadPilot-managed context to avoid getting stuck on `/sales/login`.

### Ref Stability: Self-Healing Refs

`browser_snapshot` assigns each interactive element a `ref` that maps to a DOM index in the
`INTERACTIVE_SELECTOR` pool. On dynamic websites, DOM ordering can shift between snapshot and act.

To keep workflows generic and resilient, `POST /api/browser/act` attempts to self-heal stale refs:

- If an action times out on `nth(index)`, it re-resolves the element index using the ref's stored metadata
  (`label`, `role`, `href`) and retries once.

When running with `BROWSER_GATEWAY_MODE=leadpilot`, this index-based healing is not used; LeadPilot
provides stable role refs directly.

Implementation note: both backends also attempt a small, generic recovery when an LLM mistakenly
passes a **label** (for example `"search field"`) instead of a real `ref` (`e204`). In that case,
the backend will try to resolve the label against the most recent snapshot map for that tab.
The local/camoufox backend also includes a DOM selector fallback for search/keyword inputs when
snapshot labels are not stable yet (common on dynamic SalesNav filter UIs).

LeadPilot interaction note:
- In `leadpilot` mode, typing uses Playwright `locator.click()` + `locator.type()` when `slowly=true`. Some sites can intermittently block the click (overlays/occlusion).
  The backend retries with `scrollIntoView` and may fall back to `fill` (no click) on click-timeout errors.

## Layer 2: Site Workflow Composition

The assistant **does not** rely on site-specific workflow helpers for normal browsing. The default is
LeadPilot-style operation: the model reads `browser_snapshot` output and drives the site using refs
(`browser_find_ref` + `browser_act`) in short loops.

UI note:
- When browser tools succeed, the UI appends a short "Browser session is still open." note (declarative, not a second question).
  Follow-up messages do not need to repeat "browser" or the site name. If a browser session is open and the user says
  `search ...`, `type ...`, `enter ...`, `click ...`, `scroll ...`, `next`, or `back`, the chat engine forces the
  browser tool-grounded path so the assistant doesn't fall back to local retrieval.
- The web app exposes:
  - `/tasks` for active task monitoring (status/progress/errors)
  - `/browser` for live per-tab browser views + workflow-builder annotation/synthesis
  Chat actions can auto-navigate users to `/tasks` when background browser tasks are started.

SalesNav note:
- "SalesNav" / "Sales Navigator" refers to **LinkedIn Sales Navigator** under `https://www.linkedin.com/sales/...` (not `salesnav.com`).

We still have optional composition utilities for background workers / legacy endpoints:

- `services/web_automation/browser/core/workflow.py`: generic engine for skill binding + extraction/filter helpers.
- `services/web_automation/browser/workflows/recipes.py`: reusable workflow recipes (search-and-extract, list-sub-items, etc.).
- `services/web_automation/google/workflows.py`: dedicated Google search workflow (AI Overview first, organic fallback).
- `api/routes/salesnav_routes/*`: legacy SalesNav API wrappers (keep thin).

Google workflow note:
- `google_search_browser` uses human-like typing cadence (jittered pre-type/post-type waits + typed entry) instead of instant field fill to reduce anti-bot detection.
- Optional micro-typo simulation can be enabled for stronger human mimicry (type wrong char, backspace, continue):
  - `GOOGLE_MICRO_TYPO_ENABLED=true|false` (default true)
  - `GOOGLE_MICRO_TYPO_PROBABILITY=0.0..0.5` (default 0.08)
  - `GOOGLE_KEYPRESS_TYPING_ENABLED=true|false` (default true)
- If Google returns an anti-bot interstitial (`/sorry/index`, unusual-traffic page, reCAPTCHA), the endpoint fails with
  `429` + `code=human_verification_required` so callers can pause and request manual verification.
- Planner/runtime guardrail: explicit user intent like `google ...` is normalized to `google_search_browser` (not `hybrid_search`), and tool execution includes a fallback path to `google_search_browser` when `hybrid_search` fails with a network fetch error on explicit Google intent.
- Generic retrieval bootstrap guardrail: explicit browser automation requests (`go to`, `open`, URLs, `LinkedIn`, `Sales Navigator`, etc.) skip the `hybrid_search` bootstrap fallback so planner failures do not silently reroute live-site work into CRM retrieval.

### Generic Workflow Endpoints (Preferred for Structured Tasks)

For common "search and return structured results" tasks, prefer the generic workflow endpoints over long `browser_*` primitive chains:

- `POST /api/browser/workflows/search-and-extract`
- `POST /api/browser/workflows/list-sub-items`
- `POST /api/browser/workflows/observation-pack`
- `POST /api/browser/workflows/validate-candidate`
- `POST /api/browser/workflows/annotate-candidate`
- `POST /api/browser/workflows/synthesize-from-feedback`
- `GET /api/browser/workflows/status/{task_id}` (poll background workflow status)

These are skill-driven (site knowledge lives in `skills/websites/*.md`). The caller supplies `task`, `query`, and optional `filters`, and the workflow engine handles navigation, typing, and extraction.

Observation/validation note:

- `observation-pack` captures deterministic planner inputs (role snapshot, semantic nodes, screenshot optional).
- `validate-candidate` scores extraction candidates deterministically (counts, completeness, URL validity, uniqueness).
- `annotate-candidate` returns candidate overlay artifacts (box ids + labels/hrefs + screenshot when available).
- `synthesize-from-feedback` deterministically maps include/exclude box labels back to a suggested href pattern, then re-validates it.
- synthesis/validation now also uses structural constraints:
  - landmark scope (`must_be_within_roles`, `exclude_within_roles`)
  - ancestor container hints (`container_hint_contains`, `exclude_container_hint_contains`)
- workflow skill matching now supports deterministic template fingerprints (URL pattern + role/landmark signatures), not URL-only matching.
- runtime drift monitor in `search_and_extract` now emits `STOP_VALIDATION_FAILED`, appends a repair-log entry, and includes a repair payload with an observation fingerprint when deterministic output invariants fail.
- skill-defined regression suites are now supported:
  - Add a `## Tests` section in skill markdown with lines like:
    - `- smoke | task=example_search | query=weather | min_items=1 | max_items=25 | extract_type=item`
  - Run via `POST /api/browser/skills/{skill_id}/regression-run`
  - Runner executes deterministic count-range expectations per case and returns pass/fail summaries.
- promotion gate support:
  - `POST /api/browser/skills/{skill_id}/promote`
  - Runs regression suite first; promotion is allowed only when failures are zero (configurable via request flag).
  - Persists skill QA metadata in frontmatter (`qa_status`, `last_regression_*`, `last_regression_at`).
- Auto-learn in `services/web_automation/browser/workflows/recipes.py` now uses this deterministic layer before persisting skills.
- UI wiring: `/browser` (implemented in `ui/src/pages/BrowserWorkbench.tsx`) includes the “Workflow Builder (Phase 2)” panel for annotate -> include/exclude labeling -> synthesis.
- UI shell wiring: app routes now run in a chat-first shell with two interaction modes:
  - manual sidebar navigation keeps `/browser` as a normal routed page surface,
  - chat-driven steps surface contextual UI components in a top slide-down interaction sheet while chat remains primary.

- `/browser` layout keeps the live browser frame at the top (active tab shown as the largest preview), with workflow-builder controls directly below.
- `/browser` includes a dedicated Tab Manager pane (desktop left split pane, mobile drawer) with search/filter/grouping, pinning, expandable tab details, and bulk cleanup actions for large tab sets.
- `/browser` now uses progressive disclosure by default: a collapsed tab rail (expandable manager panel) plus a bottom workflow drawer that stays collapsed until workflow actions are invoked.
- `/browser` workflow drawer body and builder panel are scrollable when content grows (candidate lists, annotations, synthesis details), including narrow/mobile viewports.
- `/browser` workflow bottom action bars and builder-panel controls/cards switch to stacked mobile layouts on narrow widths to avoid horizontal scrolling.
- `/browser` annotation results (image + box table) use a single primary vertical scroll path on small viewports to avoid nested scroll lock after "Use + Annotate".
- `/browser` annotation table content wraps long labels/urls instead of forcing horizontal overflow, preserving vertical scroll gestures in the open drawer.
- `/browser` workflow builder panel uses natural block flow (no internal flex-height trap), so drawer-body vertical scroll remains functional after observe/annotate.
- `/browser` drawer body now explicitly captures wheel/trackpad deltas and routes them to the drawer scroll container to prevent viewport-layer scroll loss in Chrome.
- `/browser` workflow builder now uses a fixed controls header plus a dedicated `min-h-0 flex-1 overflow-y-auto` content region (TanStack-rendered annotation table) to prevent scroll loss after Observe/Annotate.
- `/browser` workflow setup now defaults to a simplified guided flow for non-technical users:
  - collapsed drawer shows a single `Start Setup` CTA,
  - primary actions are plain-language (`Scan Page`, `Pick Examples`, `Test Results`, `Auto-Fix Rules`),
  - technical selector/filter fields are hidden behind an `Advanced` toggle.
- `/browser` setup now includes a 4-step wizard inside the drawer:
  - Step 1: choose collection goal (`Posts`, `People`, `Products`, `Articles`) with optional topic text,
  - Step 2: scan current page structure,
  - Step 3: pick include/exclude examples from annotated rows,
  - Step 4: test + auto-fix extraction rules and save setup draft.
- Chat-triggered browser workflow actions (`browser.observe`, `browser.annotate`, `browser.validate`, `browser.synthesize`) dispatch UI bridge commands and expose live interaction feedback in the top interaction sheet (scan/annotate/synthesize/validate progress), with explicit affordances to open the full `/browser` routed page when deeper manual control is needed.

In the UI chat layer, these are exposed as tools:

- `browser_search_and_extract`
- `browser_list_sub_items`
- `google_search_browser` (dedicated Google fact lookup)

`api/routes/salesnav_routes/browser.py` remains a thin API wrapper around legacy workflow code.

### Workflow Runtime Classification and Async Execution

Workflow endpoints now classify expected runtime before execution:

- Short tasks run synchronously.
- Long tasks can run in the background (when enabled), returning immediately with:
  - `status: "pending"`
  - `task_id`
  - `progress_pct`
  - `stage`

Poll `GET /api/browser/workflows/status/{task_id}` for transitions:

- `pending` -> `running` -> `finished` or `failed`

On timeout/failure, status responses include structured `error` payloads with retry suggestions.

#### Async + timeout env vars

- `BROWSER_WORKFLOW_ASYNC_ENABLED=true`
- `BROWSER_SHORT_TIMEOUT_MS=15000`
- `BROWSER_LONG_TIMEOUT_MS=60000`
- `BROWSER_WORKFLOW_SYNC_TIMEOUT_MS=240000`
- `BROWSER_WORKFLOW_ASYNC_MAX_RUNTIME_MS=600000`
- `BROWSER_LONG_TASK_LIMIT_THRESHOLD=50`
- `BROWSER_LONG_TASK_FILTER_THRESHOLD=4`
- `BROWSER_WORKFLOW_TASK_TTL_SECONDS=3600`
- `BROWSER_WORKFLOW_TASK_MAX_RECORDS=1000`
- `BROWSER_WORKFLOW_MAX_CONCURRENT_TASKS=3`
- `BROWSER_WORKFLOW_MAX_CONCURRENT_PER_WEBSITE=1`
- `BROWSER_WORKFLOW_ASYNC_RETRY_ENABLED=true`
- `BROWSER_WORKFLOW_ASYNC_RETRY_TIMEOUT_MS=30000`
- `BROWSER_WORKFLOW_METRICS_ENABLED=true`
- `BROWSER_WORKFLOW_METRICS_PATH=data/logs/browser_workflow_tasks.jsonl`

`POST /api/browser/navigate` also accepts optional `timeout_ms` so navigation deadlines can be tuned per workflow.

#### Progress and diagnostics

Background task progress is stage-based and updates at key checkpoints (navigate, search complete, per-filter application, extract, optional click-target, finished).  
Status polling surfaces `progress_pct`, `stage`, and `diagnostics`.

#### Capacity and retry

- Background execution is bounded by `BROWSER_WORKFLOW_MAX_CONCURRENT_TASKS` globally and `BROWSER_WORKFLOW_MAX_CONCURRENT_PER_WEBSITE` per website queue key.
- Overflowed workloads are queued (`stage=queued`) instead of being rejected for capacity.
- If a task fails after partial progress (>=50%), the runner can perform one best-effort short retry (`BROWSER_WORKFLOW_ASYNC_RETRY_ENABLED` + `BROWSER_WORKFLOW_ASYNC_RETRY_TIMEOUT_MS`).
- Task run metrics are appended as JSONL rows for simple classification tuning over time.

## Layer 3: Rate Limits and Human Verification (Hybrid Resolver, Research Mode)

Some websites will present rate limits, human verification, or interstitials that block automation.
The system handles this broadly by detecting likely challenge states and returning structured errors
so the operator can intervene or retry later.

### `services/web_automation/browser/core/stealth.py` (Behavior Shaping)

- Human-like interaction timing (typing delay, click jitter, scroll pacing).
- Goal: reduce brittle "instant bot" behavior and improve UI stability.
- This does not guarantee access past human verification challenges.

### Hybrid challenge modules

- `services/web_automation/browser/challenges/detector.py`
  - Detects likely challenge states and classifies into:
    - `interstitial_wait`
    - `visible_image` (image/checkbox style)
    - `behavioral_or_invisible` (Turnstile, reCAPTCHA v3-style)
    - `blocked`
- `services/web_automation/browser/challenges/ai_resolver.py`
  - Research-only vision loop for visible challenges.
  - Uses screenshot + multimodal model to return bounded click plans.
  - Strictly limited to allowlisted hosts with `CHALLENGE_RESEARCH_MODE=true`.
- `services/web_automation/browser/challenges/handler.py`
  - Orchestrates detection -> AI attempt (visible only) -> human handoff.
  - For behavioral/invisible challenges (or AI failures), writes a handoff ticket + screenshot, waits for operator completion, then resumes when cleared.
  - Logs structured JSONL events for offline analysis.
- `services/web_automation/browser/challenges/classifiers.py`
  - Legacy interaction handlers (checkbox/press-and-hold/wait) retained as fallback helpers.

### Wiring

- `BrowserWorkflow.wait_through_interstitials()` probes for known interstitial states.
- `BrowserWorkflow` now routes raw-page challenge handling through `services/web_automation/browser/challenges/handler.py`.
- `recipes._guard_challenges()` returns structured errors when unresolved (`challenge_unresolved`, `human_handoff_timeout`, `blocked_or_rate_limited`, etc.).

### Challenge resolver env vars

- `CHALLENGE_RESOLVER_ENABLED=true|false` (default true)
- `CHALLENGE_RESEARCH_MODE=true|false` (default false)
- `CHALLENGE_ALLOW_LIVE_HOSTS=true|false` (default false)
- `CHALLENGE_RESEARCH_ALLOWED_HOSTS=localhost,127.0.0.1,...`
- `CHALLENGE_AI_ENABLED=true|false` (default false)
- `CHALLENGE_AI_MODEL=gpt-4o-mini`
- `CHALLENGE_AI_MAX_ROUNDS=2`
- `CHALLENGE_AI_MAX_ACTIONS=5`
- `CHALLENGE_HUMAN_FALLBACK_ENABLED=true|false` (default true)
- `CHALLENGE_HUMAN_WAIT_TIMEOUT_MS=180000`
- `CHALLENGE_HUMAN_POLL_INTERVAL_MS=1500`
- `CHALLENGE_RESOLVER_LOG_PATH=data/logs/challenge_resolver_events.jsonl`
- `CHALLENGE_RESOLVER_HANDOFF_DIR=data/logs/challenge_handoffs`
- `CHALLENGE_HUMAN_NOTIFY_WEBHOOK_URL=<optional>`

### Challenge debugging

- Runtime challenge failures now include resolver metadata in challenge payloads:
  - `resolver_mode`
  - `resolver_reason`
  - `resolver_attempts`
  - `resolver_latency_ms`
- Common reason codes:
  - `feature_disabled_or_non_research_host`
  - `human_fallback_disabled`
  - `human_handoff_timeout`
- Quick inspection command:
  - `python scripts/challenge_debug.py --tail 30`

## Design Rules

- Do not add brittle, site-specific DOM logic to generic browser endpoints.
- Prefer snapshot/find_ref/act composition over ad-hoc inline script sprawl.
- Keep site-specific knowledge in skills (when used), not in Python/TS control flow.
- Treat workflow recipes as optional helpers for background collectors, not the primary browsing path.

## Related Endpoints

- `POST /api/browser/navigate`
- `POST /api/browser/snapshot`
- `POST /api/browser/find_ref`
- `POST /api/browser/act`
- `POST /api/browser/workflows/search-and-extract`
- `POST /api/browser/workflows/list-sub-items`
- `POST /api/google/search-browser`
- `POST /api/salesnav/browser/search-account`
- `POST /api/salesnav/browser/extract-companies`

## Local Dev: LeadPilot Bridge

To run the LeadPilot browser bridge locally (on Windows):

- `scripts/start_leadpilot_browser_bridge.bat`
- `scripts/stop_leadpilot_browser_bridge.bat`

Then set:

- `BROWSER_GATEWAY_MODE=leadpilot`
- `OPENCLAW_BROWSER_BASE_URL=http://127.0.0.1:9223`

For Camoufox-backed local browsing, set:

- `BROWSER_GATEWAY_MODE=camoufox`
- `CAMOUFOX_EXECUTABLE_PATH=<path to camoufox/firefox executable>` (optional if Playwright can resolve Firefox)
- `CAMOUFOX_HEADLESS=true|false` (optional; falls back to `BROWSER_GATEWAY_HEADLESS`)

## Constrained Agent Policy (General)

The generic browser workflow now supports a policy layer in `services/web_automation/browser/core/policy.py`:

- Explicit workflow state tracking (`AUTH_CHECK`, `HOME_READY`, `SEARCH`, `RESULTS_READY`, `RECOVERY`, etc.).
- Token-bucket rate limits per action class (`navigate`, `click`, `type`, `tab`).
- Session-level action budget (`max_actions_per_hour`) and cooldown after friction/challenge events.

This is designed to reduce brittle ad-hoc sleeps and enforce bounded, verifiable behavior across all websites.
Fingerprint spoofing is not required for this policy layer.

For Sales Navigator account workflows, keyword entry is skipped only when the query is empty or the current `/sales/search/company` URL already contains the same keywords. Having filters alone no longer suppresses keyword typing.
All browser automation endpoints are now task-backed:
- Workflow routes (`/api/browser/workflows/*`) create tracked task rows for both sync and async runs.
- Primitive browser routes (`/api/browser/navigate`, `/api/browser/snapshot`, `/api/browser/find_ref`, `/api/browser/act`, `/api/browser/wait`, `/api/browser/screenshot`) also create task rows.
- Successful primitive/sync workflow responses include `task_id` and `task_status` for correlation.
- UI behavior:
  - `/tasks` intentionally hides `browser_screenshot` operations from the task table to avoid noisy live-preview screenshot polling entries.
  - Task rows should represent user goals (for example query/original workflow objective), not only low-level operation names.
  - Compound workflow tasks are included in `/tasks` with phase progress and goal/title fields.

### Task heartbeat/stall detection

Long-running browser tasks publish periodic heartbeats and expose heartbeat metadata in task status:

- `heartbeat_at`
- `heartbeat_seq`
- `heartbeat_age_ms`

If a running task heartbeat becomes stale, it is marked failed with `workflow_stalled` to prevent silent hangs.

Env vars:

- `BROWSER_TASK_HEARTBEAT_INTERVAL_MS=5000`
- `BROWSER_TASK_HEARTBEAT_STALE_MS=30000`
- `COMPOUND_WORKFLOW_HEARTBEAT_INTERVAL_MS=5000`
- `COMPOUND_WORKFLOW_HEARTBEAT_STALE_MS=60000`

## Compound Workflow Orchestrator

For high-complexity chained browser requests, the planner can now produce a compound workflow spec and run it as one background task:

- `POST /api/compound_workflow/run`
- `GET /api/compound_workflow/{workflow_id}/status`
- `POST /api/compound_workflow/{workflow_id}/continue`
- `POST /api/compound_workflow/{workflow_id}/cancel`
- `GET /api/compound_workflow`

This layer runs multi-phase workflows (search -> enrich -> verify -> aggregate) with:

- persisted workflow + phase + item records in SQLite
- checkpoint pause/resume for expensive phases
- per-phase iteration concurrency controls
- event history for progress diagnostics
- resumability after interruptions

Planner integration details:

- Complex Sales Navigator/LinkedIn recency queries can emit `compound_workflow_run`.
- Planner output may include top-level `compound_workflow`; parser auto-converts it to `compound_workflow_run`.
- Deterministic compound spec injection now normalizes long natural-language requests into short Sales Navigator keyword queries plus explicit `filters` (for example `industry` and `headquarters_location`) to avoid dumping the full prompt text into the keyword input.
- Compound lead phases (`phase_2_find_vp_ops`, `phase_3_verify_recent_ai_signal`) now default people-search query to empty (filter-first). If a keyworded people search in this mode returns zero results, the workflow retries once with the same filters and no keyword.
- Compound workflows remain task-backed and visible through status polling.
- Chat now polls launched compound workflows and auto-posts terminal status updates with result summaries; `/tasks` remains the full-detail view.
