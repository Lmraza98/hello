---
summary: "Baseline metrics and prioritized refactor plan for backend/API maintainability."
read_when:
  - You are planning refactors by impact
  - You need API contract quality status and priorities
title: "Refactoring Notes"
---

# Refactoring Notes

## Current Baseline (2026-02-10)

This baseline was generated from:
- `export-signatures.ps1`
- `python scripts/export_api_docs.py`
- `app.openapi()` inspection

### Scale
- Source files indexed by signature export: `193`
- FastAPI operations in OpenAPI spec: `92`
- Tagged API operations: `92`
- Untagged operations: `0`

### High-impact backend files (size)
- `services/linkedin/scraper_core.py` (`133.6 KB`)
- `database.py` (`83.2 KB`)
- `services/phone/discoverer.py` (`42 KB`)
- `services/salesforce/bot.py` (`30.4 KB`)
- `services/salesforce/pages.py` (`27.8 KB`)
- `services/email/salesforce_sender.py` (`21.7 KB`)

### High-impact backend files (symbol density)
- `database.py` (`76` signatures)
- `services/linkedin/scraper_core.py` (`36` signatures)
- `services/salesforce/pages.py` (`34` signatures)
- `services/phone/discoverer.py` (`23` signatures)
- `services/email/discovery/pipeline.py` (`21` signatures)

### API route density
- `api/routes/email_routes/engagement.py` (`17` endpoints)
- `api/routes/email_routes/campaign_management.py` (`16` endpoints)
- `api/routes/companies.py` (`13` endpoints)
- `api/routes/email_routes/delivery.py` (`13` endpoints)

### OpenAPI documentation gap
- Most request models are represented in OpenAPI.
- JSON success response schemas are now complete (`90/90` JSON-returning operations have typed schemas).
- Two endpoints intentionally return file payloads (`/api/contacts/export`, `/api/contacts/salesforce-csv/{filename}`).
- Next improvement is tightening permissive DTOs into domain-specific response models.

## Refactor Priorities

### P0: API contract quality for Swagger/admin tooling
- Add `response_model` to all API handlers. (`done` for all JSON-returning endpoints)
- Replace generic `dict`/`list` responses with Pydantic response DTOs by domain.
- Add operation summaries/descriptions where missing.
- Keep frontend catch-all routes excluded from docs if desired (`include_in_schema=False`).

### P1: Split `database.py` by domain
- Create `database/` package with focused modules:
  - `database/core.py` (connection, context manager, migrations bootstrap)
  - `database/targets.py`
  - `database/contacts.py`
  - `database/campaigns.py`
  - `database/sent_emails.py`
  - `database/replies.py`
  - `database/stats.py`
- Keep backward-compatible re-exports from `database.py` during migration.

### P2: Service decomposition
- `services/linkedin/scraper_core.py`
  - Split into `auth/session`, `navigation/search`, `lead-extraction`, `url-extraction`.
  - Keep `SalesNavigatorScraper` as facade.
- `services/phone/discoverer.py`
  - Mirror email discovery pattern:
    - `models.py`, `search.py`, `llm.py`, `pipeline.py`, `export.py`, `db_io.py`.
- `services/salesforce/*`
  - Consolidate shared concerns (auth/session/retry/selectors).
  - Remove duplicated browser/page interaction helpers.

### P3: SQL safety and consistency
- Remove remaining string-interpolated query fragments where values are dynamic.
- Standardize parameterized filtering for dates and IDs.

### P4: Documentation automation
- Keep generated artifacts committed:
  - `docs/api/openapi.json`
  - `docs/api/endpoints.md`
- Add CI check to ensure OpenAPI export still builds.
- Add endpoint contract tests for critical workflows.

## Immediate Artifacts

- Signature export script: `export-signatures.ps1`
  - Updated to exclude `venv` and `.venv`.
- API docs export script: `scripts/export_api_docs.py`
  - Generates:
    - `docs/api/openapi.json`
    - `docs/api/endpoints.md`

## Definition of Done for the API Layer

- Every endpoint has:
  - request model (if body exists),
  - typed response model,
  - summary/description,
  - consistent error envelope.
- OpenAPI export is deterministic and committed.
- Admin portal can render endpoint docs from generated OpenAPI without manual curation.

## 2026-02-16 - ChatEngine Phase 2A responseBuilder extraction

- Added ui/src/chat/chatEngine/responseBuilder.ts with dispatch-backed result builder extracted 1:1 from dispatchPlanAndBuildResult behavior.
- Kept ui/src/chat/chatEngine/dispatchResponse.ts as a compatibility layer exporting existing helpers and dispatchPlanAndBuildResult wrapper.
- Migrated Phase 2A call sites only: fastPath default branch and confirmed_read_only_fastlane branch in reactAdapter.
- Added golden tests for confirmation gate, synthesis-skip dedupe path, and override path (meta/phase/post-process).

## 2026-02-16 - ChatEngine Phase 2B/2C builder consolidation

- Added dispatchAndBuildArtifacts to ui/src/chat/chatEngine/responseBuilder.ts and rewired ast_path_email_lookup to use it while preserving follow-up prompt/history/message behavior.
- Added uildExecutedToolBackedResult to 
esponseBuilder.ts and migrated 
eactResultToChatResult in 
eactAdapter.ts to use it.
- Kept confirmation, grounded messaging, session merge, and debug trace semantics intact; all tests passing.
## 2026-02-16 - ChatEngine routing hardening for send-email and confirmations

- Added deterministic email-to-person routing in `ui/src/chat/chatEngine/pipelineSteps.ts` for direct patterns (`send an email to`, `email`, `reach out to`, `send message to`) to run a tool-grounded `hybrid_search` contact lookup path.
- Ensured active-task/skill resume executes before conversational short-circuit, and affirmative confirmations (for assistant confirmation prompts) are no longer swallowed as conversational replies.
- Added execution-time tool argument schema guards in `ui/src/chat/toolExecutor/dispatch.ts` so invalid required args are blocked before API calls.
- Added `pick_contact_for_email:*` handling in `ui/src/chat/chatEngine/actionRouter.ts` so disambiguation actions route back into the planning pipeline.
- Updated email fast-path handling in `ui/src/chat/chatEngine/fastPath.ts` to prompt for more identifying info when no matching contact is found.
- Added regression tests in `ui/src/chat/__tests__/toolExecutorGuards.test.ts` and `ui/tests/chatScenarios.smoke.test.ts`.
## 2026-02-16 - Multi-step planner dependency hardening

- Strengthened step context propagation in `ui/src/chat/chatEngine/stepContext.ts` to include strict dependency guidance and top entity hints from prior-step tool results.
- Updated `ui/src/chat/chatEngine/taskPlanExecutor.ts` to use rolling per-step history during multi-step execution, improving downstream step grounding.
- Added deterministic fallback for deferred email scheduling intents during step execution when no deterministic scheduling tool is available, returning a clear manual-confirmation path.
- Added semantic planner guardrails in `ui/src/chat/models/toolPlanner/normalize.ts`:
  - map `resolve_entity` person-like entity types to supported schema values,
  - rewrite generic role lookups (e.g., "Head of Marketing") into constrained `hybrid_search` calls,
  - enforce contact constraints on generic role lookups and carry forward context entity hints.
- Clarified ReAct failure trace wording in `ui/src/chat/reactLoop.ts` from "step" to "iteration" for accurate debugging.
- Added regression tests in `ui/src/chat/models/__tests__/toolPlannerNormalizeGuards.test.ts` and `ui/tests/stepContext.test.ts`.
## 2026-02-17 - Deterministic prospecting skill + scheduling primitives

- Added new deterministic built-in skill `prospect-companies-and-draft-emails` in `ui/src/assistant-core/skills/handlers/prospectCompaniesAndDraftEmails.ts` and registered it in `ui/src/assistant-core/skills/loader.ts`.
- The skill targets complex outreach requests (company discovery -> head-of-marketing discovery -> campaign creation -> enrollment -> draft prep -> queue approval -> schedule verification) with explicit write confirmations.
- Added new chat tools and executor mappings:
  - `approve_campaign_review_queue`
  - `reschedule_campaign_emails`
- Added backend API endpoints to support those tools:
  - `POST /api/emails/review-queue/approve-campaign`
  - `PUT /api/emails/scheduled-emails/reschedule-by-offset`
- Added Pydantic request/response models for the new endpoints in `api/routes/email_routes/models.py`.
- Updated planner tool preselection to treat `schedule`/`reschedule` as mutating intents.
- Added regression tests:
  - `ui/tests/skillProspectingFlow.test.ts`
  - extended `ui/tests/skillSystem.test.ts` for matching and deterministic plan checks.

## UI Planner Refactor Notes (2026-02-16)
- Removed deprecated ui/src/chat/models/toolPlanner/parseNormalize.ts after splitting parse/normalize responsibilities into parse.ts and normalize.ts.
- Restored regex/escape semantics in ui/src/chat/models/toolPlanner/parse.ts and ui/src/chat/models/toolPlanner/normalize.ts so fenced JSON extraction and browser normalization behavior match intended planner behavior.
- Added schema-independent safety guards so get_contact requires a positive integer contact_id in planner normalization and dispatch validation, preventing /contacts/undefined calls even under stale schema/runtime states.
- Added resolve_entity execution fallback in UI tool executor: map person-like entity_types to contact and, when deterministic resolve returns empty, retry through hybrid_search for better name lookup recall.
- Fixed browser workflow skill entry behavior: auto-learned skills now include entry_url/base_url, and search_and_extract now proceeds on current tab when entry_url is missing but current URL matches skill domains (prevents false no_entry_url failures).
- Added deterministic target-market heuristic in SalesNav filter parsing: queries like X for the healthcare industry now force industry to Hospital & Health Care and keep X terms in keywords, preventing over-constraining to generic Technology.
- Expanded SalesNav account filter coverage in browser workflow decomposition/merge to include annual_revenue, fortune, department/spotlight/workflow filters, and added regression tests in `tests/test_salesnav_filters.py` to verify frontmatter wiring plus `apply_filter` execution across all requested filter groups.

## 2026-02-16 - SalesNav scraper reliability + modularization pass

- Added `services/linkedin/salesnav/` support modules to split responsibilities:
  - `session.py`, `selectors.py`, `nav.py`, `waits.py`, `filters.py`, `scrape_people.py`, `scrape_companies.py`, `debug.py`, `operations.py`, `models.py`.
- Converted `services/linkedin/scraper_core.py` into a thin facade (now 72 lines) with split mixins:
  - `services/linkedin/salesnav/session_mixin.py`
  - `services/linkedin/salesnav/navigation_mixin.py`
  - `services/linkedin/salesnav/filter_url_mixin.py`
  - `services/linkedin/salesnav/public_url_mixin.py`
  - `services/linkedin/salesnav/parsing_mixin.py`
- Kept delegated modules for core responsibilities (`filter_applier`, `scrape_people`, `scrape_companies`) and removed the temporary monolith file `services/linkedin/scraper_legacy.py`.
- Completed third-pass decomposition of public URL extraction:
  - `services/linkedin/salesnav/public_url_mixin.py` reduced to thin compatibility wrappers (35 lines),
  - heavy flow moved to `services/linkedin/salesnav/public_url_flow.py`,
  - batch two-pass enrichment moved to `services/linkedin/salesnav/public_url_batch.py`.
- Completed fourth-pass decomposition of navigation responsibilities:
  - `services/linkedin/salesnav/navigation_mixin.py` reduced to thin wrappers (81 lines),
  - company lookup/decision-maker navigation moved to `services/linkedin/salesnav/navigation_company_search.py`,
  - employee fetch flow moved to `services/linkedin/salesnav/navigation_employee_fetch.py`,
  - multi-step workflow orchestration moved to `services/linkedin/salesnav/navigation_workflows.py`.
- Completed fifth-pass decomposition of filter URL responsibilities:
  - `services/linkedin/salesnav/filter_url_mixin.py` reduced to thin wrappers (48 lines),
  - URL construction moved to `services/linkedin/salesnav/filter_url_build_flow.py`,
  - location-ID dropdown extraction moved to `services/linkedin/salesnav/filter_url_location_flow.py`,
  - filter-ID extraction moved to `services/linkedin/salesnav/filter_url_filter_id_flow.py`.
- Grouped `services/linkedin/salesnav/` into logical subpackages for maintainability:
  - `core/`, `flows/`, `extractors/`, `mixins/`, `parser/`.
- Tightened auth checks to require `linkedin.com` host and `/sales/` paths while excluding login/checkpoint/authwall states.
- Replaced key `networkidle`/fixed waits in hot paths with explicit SalesNav wait helpers (shell/results container/lead cards/company cards).
- Added operation-level retry wrapper and structured debug artifact capture (`debug/*.html`, `debug/*.png`, `debug/*.json`) on failures.
- Changed always-on debug HTML writes to conditional sampled captures controlled by `DEBUG_SNAPSHOTS` and `DEBUG_SNAPSHOT_RATE`.
- Removed same-page parallel card extraction in company scraping to avoid flaky shared-page race conditions.
- Improved dedupe identity: lead URL/company URL normalization now used as primary keys before text fallbacks.
- Normalized mojibake-affected log output and bullet parsing handling for both proper and mojibake bullet characters.
- Removed legacy contact-storage coupling from `services.linkedin`:
  - deleted `services/linkedin/contacts.py` compatibility shim,
  - updated API/CLI imports to use `services.contacts` directly,
  - removed contact function re-exports from `services/linkedin/__init__.py`.
- Standardized CLI data access on `database.py` for SalesNav scrape/backfill flows:
  - added `database.py` helpers for pending target retrieval with tier filters,
  - added `database.py` helpers for missing-public-URL contacts and generated-email writes,
  - removed inline SQL/cursor usage from `cli/commands/scrape.py` and `cli/commands/backfill.py`.
- Standardized remaining CLI database utility commands on `database.py` helpers:
  - removed direct SQL from `cli/commands/status.py` and `cli/commands/db.py`,
  - added centralized count/reset/delete helper functions in `database.py` for targets, contacts, send queue, campaigns, and sent-email stats.
- Moved company collection/classification modules into LinkedIn namespace:
  - `services/company/collector.py` -> `services/linkedin/salesnav/flows/company_collection.py`
  - `services/company/vertical_classifier.py` -> parser-native helpers in `services/linkedin/salesnav/parser/filter_parser.py`
  - updated API/CLI/tests imports to `services.linkedin.salesnav.flows.company_collection` and parser helper imports from `services.linkedin.salesnav.filter_parser`
- Refactored `services/linkedin/salesnav/flows/company_collection.py` to match SalesNav flow cadence:
  - introduced focused helpers for HQ filter extraction, account-search execution, company normalization, and fallback orchestration,
  - aligned constructor/signature pattern with other flow classes (`__init__(self, scraper: Any = None)`),
  - kept external behavior and return payload shape stable.
- Removed `services/linkedin/company/vertical_classifier.py` and replaced call sites with parser-native inference:
  - added `infer_company_vertical`, `infer_company_vertical_if_missing`, and `backfill_missing_verticals` to `services/linkedin/salesnav/parser/filter_parser.py`,
  - switched vertical inference in `database.add_target`, CSV ingest, and SalesNav company collection flow to those parser helpers.
- Hardened `services/linkedin/scraper_core.py` facade API:
  - removed private `_apply_*` passthrough exposure and replaced with public single-filter methods (`apply_industry`, `apply_location`, `apply_headcount`, `apply_revenue`),
  - updated filter-URL flows to call public filter APIs instead of private internals,
  - added facade precondition guards (`_require_page`, `_require_auth`, `_ensure_on_account_search`) before delegation,
  - added async lifecycle context-manager support (`__aenter__`, `__aexit__`),
  - added typed convenience methods (`scrape_current_results_typed`, `scrape_company_results_typed`) while preserving existing dict-based APIs.
- Simplified scraper architecture to facade + composition:
  - removed mixin inheritance from `SalesNavigatorScraper`,
  - facade now delegates explicitly to composed flows/services (`company_search_flow`, `employee_fetch_flow`, `workflow_flow`, `filter_url_*`, `public_url_flow`, applier/extractors),
  - preserved public method surface so existing API/CLI call sites continue to work.
- Tightened facade surface and helper reuse:
  - removed internal/private wrapper exports from `SalesNavigatorScraper` (`_get_location_id_from_dropdown`, `_get_filter_id_from_url`, `_get_filter_id`, `_abs_salesnav_url`, `_extract_public_url_from_html`, `_copy_public_url_from_lead_page`),
  - updated URL/filter flows to call composed flow objects directly instead of private facade wrappers,
  - introduced shared parsing helpers in `services/linkedin/salesnav/core/parsing.py` and switched consumers to use it (headcount range parsing, employee-count parsing),
  - added consistent readiness gate in facade (`_ensure_ready(require_auth=..., require_account_search=...)`) and applied it across public navigation/filter/public-url/task methods.
- Standardized raw employee URL schema across SalesNav people flows:
  - `services/linkedin/salesnav/extractors/scrape_people.py`, `services/linkedin/salesnav/flows/public_url_batch.py`, and `services/linkedin/salesnav/flows/navigation_employee_fetch.py` now emit explicit `sales_nav_url` and `public_url` fields with `has_public_url`, instead of ambiguous `linkedin_url`,
  - public URL enrichment updates `public_url` only and preserves `sales_nav_url`,
  - typed mapping in `services/linkedin/scraper_core.py` now prefers explicit fields and only uses `linkedin_url` as a backward-compat fallback.
- Added optional auth self-heal path to facade readiness checks:
  - `services/linkedin/scraper_core.py::_ensure_ready(...)` now accepts `interactive_auth` (default `False`),
  - when `require_auth=True` and cached auth state is false, readiness calls `ensure_authenticated(interactive=interactive_auth)` before raising.
- Hardened login-wait success criteria in `services/linkedin/scraper_core.py::wait_for_login(...)`:
  - switched timeout loop timing to `asyncio.get_running_loop().time()` for deterministic monotonic timing,
  - on authenticated URL detection, now requires `wait_for_salesnav_shell(...)` before saving storage state and returning success.
- Simplified typed employee mapping in `services/linkedin/scraper_core.py::scrape_current_results_typed(...)`:
  - now reads only explicit raw fields (`sales_nav_url`, `public_url`),
  - removed legacy `linkedin_url` fallback from typed mapping to keep the schema unambiguous.
- Promoted typed high-level SalesNav facade APIs and added explicit raw variants:
  - added `ContactsResult` model in `services/linkedin/salesnav/core/models.py`,
  - `search_companies_with_filters(...)` now returns `list[CompanyResult]` via `search_companies_with_filters_typed(...)`,
  - `scrape_company_contacts(...)` now returns `ContactsResult` via `scrape_company_contacts_typed(...)`,
  - retained raw dict payload access with `search_companies_with_filters_raw(...)` and `scrape_company_contacts_raw(...)`.
- Facade/API consistency cleanup in `services/linkedin/scraper_core.py`:
  - added shared mapping helpers (`_to_employee_result`, `_to_company_result`) and reused them across typed wrappers to prevent drift,
  - added reusable `self.public_url_batch` initialized in `__init__` (no per-call batch allocation),
  - added `scrape_current_results_raw(...)` alias for raw-people naming consistency,
  - made top-level typed-first public methods explicitly enforce readiness (`scrape_company_contacts`, `search_companies_with_filters`),
  - split auth checks into passive (`_check_auth_passive`, no navigation) and active (`_check_auth_active`, navigates to Sales Home), with `ensure_authenticated(...)` using passive first.
- Tightened raw employee schema contract in SalesNav workflow output:
  - `services/linkedin/salesnav/flows/navigation_workflows.py` now ensures returned employee entries always include `sales_nav_url`, `public_url`, and `has_public_url` keys.
- Applied safe pacing/reliability hardening for SalesNav automation (non-evasive):
  - added configurable pacing settings in `config.py` (`SALESNAV_SLOW_MO_MS`, `SALESNAV_PACING_*`),
  - added `services/linkedin/salesnav/core/pacing.py` with bounded jitter/backoff delay helpers for load smoothing,
  - replaced fixed sleeps in key extractors/flows (`scrape_people`, `scrape_companies`, `navigation_employee_fetch`) with pacing helpers,
  - removed invalid `navigator.plugins` overrides from SalesNav browser init scripts (facade + session mixin),
  - updated URL wait loop timing in `services/linkedin/salesnav/core/waits.py` to use `asyncio.get_running_loop().time()`.
- Added orchestration-level cadence controls in `services/linkedin/salesnav/flows/company_collection.py`:
  - introduced a process-local search gate (`_search_gate_lock` + `_min_search_interval_seconds`) to throttle back-to-back account-search recipe calls,
  - added bounded pause before fallback retry attempts in `_collect_with_fallback(...)` to avoid immediate retry bursts.
- Reduced fixed-interval cadence in browser workflow recipes/core:
  - `services/browser_workflow.py` now exposes `wait_jitter(...)` and uses jittered per-page settle waits in `paginate_and_extract(...)`,
  - `services/browser_workflows/recipes.py` replaced hardcoded `wf.wait(...)` constants with bounded jittered wait helpers for UI-settle and results-settle phases.
  - added explicit inter-phase cooldown in `services/browser_workflows/recipes.py` (`_wait_phase_cooldown`, bounded to 2-4s) at major `search_and_extract` boundaries.
- Hardened LinkedIn facade/workflow reliability surfaces:
  - `services/linkedin/scraper_core.py` now routes key interaction-heavy public methods through a single `_run_operation(...)` wrapper backed by `run_operation_with_retries(...)` with timing logs and debug context,
  - `services/linkedin/workflows.py` now uses `ensure_authenticated(...)` and returns structured `auth_required` / `error` payloads on failure paths.
- Added safe LinkedIn interaction utility module:
  - `services/linkedin/salesnav/core/interaction.py` with deterministic pointer/scroll helpers (`move_to_element`, `click_locator`, `wheel_scroll`, `scroll_into_view`) and bounded jitter pacing helper (`wait_with_jitter`),
  - includes `idle_drift` as a timing-only idle helper for load smoothing without synthetic cursor-drift behavior.
- Interaction helper reliability tweak:
  - `click_locator` now targets a random inner-area point (15%-85% bounds) to reduce fragile center-pixel interception issues,
  - `idle_drift` now uses bounded jittered wait chunks via `wait_with_jitter` for smoother long idle periods.
- Added safe operation-level CDP keepalive in `services/linkedin/scraper_core.py`:
  - `_run_operation(...)` now starts a lightweight heartbeat task during wrapped operations,
  - heartbeat sends periodic `page.evaluate("() => 1")` pings to prevent fully idle CDP stretches without synthesizing input events.
- Wired SalesNav interaction reliability helpers into primary automation paths:
  - `services/browser_workflows/recipes.py::_wait_phase_cooldown(...)` now adds guarded `idle_drift(...)` after jitter waits,
  - `services/linkedin/scraper_core.py::reset_search_state(...)` now performs guarded `idle_drift(...)` before home navigation,
  - `services/linkedin/salesnav/extractors/scrape_people.py` now scrolls each card into view before extraction and adds brief guarded `idle_drift(...)` every 5 extracted people,
  - `services/linkedin/salesnav/flows/filter_applier.py` now uses `click_locator(...)` at main filter open/select click points and adds guarded per-filter `idle_drift(...)`,
  - `services/browser_workflow.py::paginate_and_extract(...)` now uses bounded jitter wait (`min_ms=500`, `max_ms=3000`) plus guarded `idle_drift(...)` after pagination clicks.
- Added post-selection filter-panel collapse safeguards for SalesNav filter application:
  - `services/browser_workflow.py::apply_filter(...)` now executes a fallback collapse chain after selection/confirm and before verify (toggle expand button, then `Escape`, then click-away evaluate) with settle waits,
  - `services/linkedin/salesnav/flows/filter_applier.py` now presses `Escape` after successful industry/location/headcount/revenue selections to ensure panels are closed before the next filter step.
