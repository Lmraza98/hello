---
summary: "General browser automation architecture and how the assistant uses OpenClaw-style browser primitives."
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

- `services/browser_backends/local_playwright.py`
- `services/browser_backends/openclaw.py`
- `services/browser_backends/proxy.py`
- `services/browser_backends/factory.py` (selects backend via `BROWSER_GATEWAY_MODE`)

### Browser Backends (`BROWSER_GATEWAY_MODE`)

The same API can be backed by different browser engines:

- `local` (default): in-process Playwright session managed by `services/browser_backends/local_playwright.py`.
- `proxy`: forwards requests to a remote gateway that implements the same contract.
- `openclaw`: uses the OpenClaw browser bridge server (stable role refs + CDP targetIds).
- `camoufox`: Firefox/Camoufox-backed in-process Playwright session via `services/browser_backends/camoufox.py`.

In `camoufox` mode:

- The public browser API contract is identical to `local` mode (`tabs/navigate/snapshot/find_ref/act/wait/screenshot`).
- Session persistence behavior remains the same (including LinkedIn storage-state bootstrap from `data/linkedin_auth.json` when present).
- Workflows under `api/routes/browser_workflows.py` and `services/browser_workflows/recipes.py` run unchanged.

In `openclaw` mode:

- `ref`s are stable role refs coming from OpenClaw role snapshots (not DOM indices).
- Tab identity is derived from OpenClaw `targetId`s and mapped into our `tab-<n>` ids (stable mapping across refreshes).
- `act:evaluate` is intentionally disabled (skills should rely on snapshot + action hints, not inline scripts).
- When navigating to LinkedIn/SalesNav, the backend will (best-effort) import cookies from `data/linkedin_auth.json`
  into the OpenClaw-managed context to avoid getting stuck on `/sales/login`.

### Ref Stability: Self-Healing Refs

`browser_snapshot` assigns each interactive element a `ref` that maps to a DOM index in the
`INTERACTIVE_SELECTOR` pool. On dynamic websites, DOM ordering can shift between snapshot and act.

To keep workflows generic and resilient, `POST /api/browser/act` attempts to self-heal stale refs:

- If an action times out on `nth(index)`, it re-resolves the element index using the ref's stored metadata
  (`label`, `role`, `href`) and retries once.

When running with `BROWSER_GATEWAY_MODE=openclaw`, this index-based healing is not used; OpenClaw
provides stable role refs directly.

Implementation note: both backends also attempt a small, generic recovery when an LLM mistakenly
passes a **label** (for example `"search field"`) instead of a real `ref` (`e204`). In that case,
the backend will try to resolve the label against the most recent snapshot map for that tab.
The local/camoufox backend also includes a DOM selector fallback for search/keyword inputs when
snapshot labels are not stable yet (common on dynamic SalesNav filter UIs).

OpenClaw interaction note:
- In `openclaw` mode, typing uses Playwright `locator.click()` + `locator.type()` when `slowly=true`. Some sites can intermittently block the click (overlays/occlusion).
  The backend retries with `scrollIntoView` and may fall back to `fill` (no click) on click-timeout errors.

## Layer 2: Site Workflow Composition

The assistant **does not** rely on site-specific workflow helpers for normal browsing. The default is
OpenClaw-style operation: the model reads `browser_snapshot` output and drives the site using refs
(`browser_find_ref` + `browser_act`) in short loops.

UI note:
- When browser tools succeed, the UI appends a short "Browser session is still open." note (declarative, not a second question).
  Follow-up messages do not need to repeat "browser" or the site name. If a browser session is open and the user says
  `search ...`, `type ...`, `enter ...`, `click ...`, `scroll ...`, `next`, or `back`, the chat engine forces the
  browser tool-grounded path so the assistant doesn't fall back to local retrieval.
- The web app exposes a dedicated `/tasks` route that shows active tasks and live per-tab browser views.
  Chat actions can auto-navigate users to this page when background browser tasks are started.

SalesNav note:
- "SalesNav" / "Sales Navigator" refers to **LinkedIn Sales Navigator** under `https://www.linkedin.com/sales/...` (not `salesnav.com`).

We still have optional composition utilities for background workers / legacy endpoints:

- `services/browser_workflow.py`: generic engine for skill binding + extraction/filter helpers.
- `services/browser_workflows/recipes.py`: reusable workflow recipes (search-and-extract, list-sub-items, etc.).
- `services/google/workflows.py`: dedicated Google search workflow (AI Overview first, organic fallback).
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

### Generic Workflow Endpoints (Preferred for Structured Tasks)

For common "search and return structured results" tasks, prefer the generic workflow endpoints over long `browser_*` primitive chains:

- `POST /api/browser/workflows/search-and-extract`
- `POST /api/browser/workflows/list-sub-items`
- `GET /api/browser/workflows/status/{task_id}` (poll background workflow status)

These are skill-driven (site knowledge lives in `skills/websites/*.md`). The caller supplies `task`, `query`, and optional `filters`, and the workflow engine handles navigation, typing, and extraction.

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

### `services/browser_stealth.py` (Behavior Shaping)

- Human-like interaction timing (typing delay, click jitter, scroll pacing).
- Goal: reduce brittle "instant bot" behavior and improve UI stability.
- This does not guarantee access past human verification challenges.

### Hybrid challenge modules

- `services/challenge_detector.py`
  - Detects likely challenge states and classifies into:
    - `interstitial_wait`
    - `visible_image` (image/checkbox style)
    - `behavioral_or_invisible` (Turnstile, reCAPTCHA v3-style)
    - `blocked`
- `services/ai_challenge_resolver.py`
  - Research-only vision loop for visible challenges.
  - Uses screenshot + multimodal model to return bounded click plans.
  - Strictly limited to allowlisted hosts with `CHALLENGE_RESEARCH_MODE=true`.
- `services/challenge_handler.py`
  - Orchestrates detection -> AI attempt (visible only) -> human handoff.
  - For behavioral/invisible challenges (or AI failures), writes a handoff ticket + screenshot, waits for operator completion, then resumes when cleared.
  - Logs structured JSONL events for offline analysis.
- `services/browser_challenges.py`
  - Legacy interaction handlers (checkbox/press-and-hold/wait) retained as fallback helpers.

### Wiring

- `BrowserWorkflow.wait_through_interstitials()` probes for known interstitial states.
- `BrowserWorkflow` now routes raw-page challenge handling through `services/challenge_handler.py`.
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

## Local Dev: OpenClaw Bridge

To run the OpenClaw browser bridge locally (on Windows):

- `scripts/start_openclaw_browser_bridge.bat`
- `scripts/stop_openclaw_browser_bridge.bat`

Then set:

- `BROWSER_GATEWAY_MODE=openclaw`
- `OPENCLAW_BROWSER_BASE_URL=http://127.0.0.1:9223`

For Camoufox-backed local browsing, set:

- `BROWSER_GATEWAY_MODE=camoufox`
- `CAMOUFOX_EXECUTABLE_PATH=<path to camoufox/firefox executable>` (optional if Playwright can resolve Firefox)
- `CAMOUFOX_HEADLESS=true|false` (optional; falls back to `BROWSER_GATEWAY_HEADLESS`)

## Constrained Agent Policy (General)

The generic browser workflow now supports a policy layer in `services/browser_policy.py`:

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
  - `/tasks` intentionally hides `browser_screenshot` operations from the task table/cards to avoid noisy 1s live-preview screenshot polling entries.
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
- Compound workflows remain task-backed and visible through status polling.
