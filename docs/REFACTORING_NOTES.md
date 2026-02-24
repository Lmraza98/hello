---
summary: "Baseline metrics and prioritized refactor plan for backend/API maintainability."
read_when:
  - You are planning refactors by impact
  - You need API contract quality status and priorities
title: "Refactoring Notes"
---

# Refactoring Notes

## 2026-02-19 - Service Layer Slimming (Safe Pass)

- Fixed stale runtime import in `database.py` from deprecated `services.linkedin.*` to `services.web_automation.linkedin.*`.
- Updated legacy SalesNav scripts to current browser workflow import paths under `services.web_automation.browser.*`.
- Removed dead modules:
  - `services/testing/*`
  - `services/identity/name_normalizer.py`
- Expanded `scripts/check_service_boundaries.py` scan scope beyond `services/` so deprecated `services.*` roots are now flagged in:
  - `api/`
  - `scripts/`
  - `tests/`
  - root backend entrypoints (`database.py`, `main.py`, `app.py`)

## Service Path Migration Note (2026-02-19)

Historical entries below may reference pre-restructure paths. Use this mapping when reading older notes:

- `services/linkedin/*` -> `services/web_automation/linkedin/*`
- `services/google/*` -> `services/web_automation/google/*`
- `services/salesforce/*` -> `services/web_automation/salesforce/*`
- `services/browser_backends/*` -> `services/web_automation/browser/backends/*`
- `services/browser_skills/*` -> `services/web_automation/browser/skills/*`
- `services/browser_workflows/*` -> `services/web_automation/browser/workflows/*`
- `services/browser_workflow.py` -> `services/web_automation/browser/core/workflow.py`
- `services/browser_policy.py` -> `services/web_automation/browser/core/policy.py`
- `services/browser_stealth.py` -> `services/web_automation/browser/core/stealth.py`
- `services/challenge_*` and related challenge modules -> `services/web_automation/browser/challenges/*`
- `services/workflows/*` -> `services/orchestration/workflows/*`
- `services/compound_workflow/*` -> `services/orchestration/compound/*`
- `services/runners/*` -> `services/orchestration/runners/*`
- `services/phone/*` -> `services/enrichment/phone/*`

## 2026-02-19 - Ingestion-Time LLM Name Normalization

- Added `services/identity/name_classifier.py` as the ingestion-time name normalizer/classifier.
- Normalization now happens when contacts are written to `linkedin_contacts` (not at export/use time).
- Extended `linkedin_contacts` schema with preserved raw/structured name fields:
  - `name_raw`, `name_first`, `name_middle`, `name_last`,
  - `name_prefix`, `name_suffix`, `name_confidence`, `name_review_reason`.
- Updated ingestion paths to use normalized storage:
  - `database.save_linkedin_contacts(...)`,
  - `database.add_linkedin_contact(...)` (new),
  - manual contact creation and outreach create-if-missing flows now route through DB ingestion helper.
- Removed runtime name re-normalization from Salesforce upload/export/email-discovery consumers; these now use stored normalized components with lightweight fallback splitting only.

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

## 2026-02-17 - Admin IA cleanup (tests-first, fine-tune advanced)

- Changed primary admin entry to planner tests:
  - sidebar `Admin` nav now targets `/admin/tests`,
  - added `/admin` route redirect to `/admin/tests`.
- Reordered admin top tabs to emphasize day-to-day operations:
  - primary tabs now show `Tests`, `Logs`, `Costs`.
- Kept `Fine-tune` route and functionality intact but demoted it to an advanced tab action:
  - labeled as `Advanced: Fine-tune` in `ui/src/pages/admin/Admin.tsx`.

## 2026-02-17 - Email campaigns list refactor to table model

- Refactored `ui/src/components/email/CampaignsView.tsx` from status-grouped cards to a table-first layout aligned with Companies/Contacts page structure.
- Added shared toolbar behavior for campaigns:
  - global search,
  - filter panel toggle,
  - active filter pills with per-filter clear.
- Added campaign filters for:
  - status,
  - template mode (`linked`/`copied`),
  - review queue state (has/no pending review).
- Added sortable table columns with row-level actions preserved (`edit templates`, `upload to Salesforce`, `activate/pause`, `send`, `delete`).
- Kept non-campaign email views unchanged (`Review`, `Scheduled`, `Sent History`).

## UI Planner Refactor Notes (2026-02-16)
- Removed deprecated ui/src/chat/models/toolPlanner/parseNormalize.ts after splitting parse/normalize responsibilities into parse.ts and normalize.ts.
- Restored regex/escape semantics in ui/src/chat/models/toolPlanner/parse.ts and ui/src/chat/models/toolPlanner/normalize.ts so fenced JSON extraction and browser normalization behavior match intended planner behavior.
- Added schema-independent safety guards so get_contact requires a positive integer contact_id in planner normalization and dispatch validation, preventing /contacts/undefined calls even under stale schema/runtime states.
- Added resolve_entity execution fallback in UI tool executor: map person-like entity_types to contact and, when deterministic resolve returns empty, retry through hybrid_search for better name lookup recall.
- Fixed browser workflow skill entry behavior: auto-learned skills now include entry_url/base_url, and search_and_extract now proceeds on current tab when entry_url is missing but current URL matches skill domains (prevents false no_entry_url failures).
- Added deterministic target-market heuristic in SalesNav filter parsing: queries like X for the healthcare industry now force industry to Hospital & Health Care and keep X terms in keywords, preventing over-constraining to generic Technology.
- Hardened SalesNav company-focus extraction to remain deterministic while handling realistic user phrasing: supports quoted/company-named entity extraction and rejects generic criteria-heavy queries (for fallback keyword safety).
- Pruned legacy SalesNav UI-filter click path coverage in favor of URL-first workflow contracts: tests now prioritize URL builder, navigation, and extraction boundary behavior over deprecated suggestion/filter-expander interactions.
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
  - updated API/CLI imports to use `database.py` contact helpers directly,
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

## 2026-02-22 - Launcher Graph Refactor (Maintainability Pass)

- Added shared graph UI type definitions in `launcher_frontend/src/components/graph/graphTypes.ts` to reduce ad-hoc `any` usage across graph components.
- Extracted scope-aware graph selection/filter derivation into `launcher_frontend/src/components/graph/useGraphViewModel.ts`.
  - This centralizes `currentNodeId` resolution and scoped node/edge selection for suite/aggregate/child modes.
- Updated `launcher_frontend/src/components/graph/TestDependencyGraph.tsx` to consume the new hook, removing a large block of inline scope/selection logic.
- Tightened `GraphNode` typing via explicit `GraphNodeProps` in `launcher_frontend/src/components/graph/GraphNode.tsx`.
- Preserved runtime behavior while reducing coupling and making future bug fixes (scope tracking, dynamic right-panel selection, playback selection) easier to isolate.
- Graph stability fixes in `TestDependencyGraph.tsx`:
  - dependency status resolution now uses a unified scoped status map (suite + aggregate children + child DAG IDs) to avoid false blocked/unmet deps in aggregate/child scopes.
  - canvas scroll viewport updates are requestAnimationFrame-coalesced to reduce render thrash.
  - auto-fit now runs once per scope signature (suite/aggregate/child key) instead of snapping on every layout/current-node update.
  - edge style precedence updated so transition/blocked/path states override cycle styling.
- Scoped graph model correctness pass (`TestDependencyGraph.tsx`, `useGraphViewModel.ts`):
  - context trimming and bundling now derive from a base scoped model (`suite|aggregate|child`) instead of always suite nodes.
  - child scope semantic adjacency now uses child DAG edges, fixing upstream/downstream reachability and blocked-dependency logic in child view.
  - search source and status counts now align with rendered scoped graph model.
  - cycle banner wording updated to `Non-DAG edge detected` to match current back-edge detection behavior.
- Type-safety fix in `TestDependencyGraph.tsx` playback stream: normalized timeline/path entries into a shared `PlaybackEntry` shape so mixed `RunEvent | PathStepEvent` access (e.g. `focusNodeId`) is type-safe.

## 2026-02-23 - Launcher Frontend Graph Behavior Contract Updates

- Updated graph docs/contracts for current frontend behavior:
  - aggregate filters are global across Tests/Graph and act as visibility/scope filters without changing live replay ownership semantics,
  - suite inline aggregate expansion remains the canonical graph interaction path for filtered aggregate selection,
  - graph bottom playback controls are artifact-replay scoped (shown only while an artifact run is loaded, hidden otherwise).
- `launcher_frontend/src/components/graph/GraphCanvas.tsx` was restructured into internal layers (`EdgesLayer`, `NodesLayer`, `OverlaysLayer`) with pure style/state helpers while preserving existing event and rendering semantics.

## 2026-02-23 - UI Build Fix (TypeScript)

- Fixed a strict TypeScript build failure in `ui/src/chat/models/toolPlanner/complexityClassifier.ts` by removing an unused local variable (`lower`) so `tsc -b` passes during `scripts/start_backend.bat`.

## 2026-02-23 - Chat Quick Search Confirmation + Lead-First Lookup

- Updated `ui/src/chat/chatEngine/responseBuilder.ts` confirmation gating so read-only tool plans (for example `search_contacts`, `search_companies`, `hybrid_search`) no longer prompt confirmation just because `requireToolConfirmation` is enabled.
- Added deterministic quick-lookup routing in `ui/src/chat/chatEngine/pipelineSteps.ts`:
  - reverted: quick-lookup regex routing for `find/search/who is` was removed to keep these intents on the standard planner flow.
- Added lead-first fallback behavior in `ui/src/chat/toolExecutor/executeTool.ts` for `search_contacts(name=...)`:
  - if local contacts return no close name match, automatically fallback to `hybrid_search` for contact recall,
  - if a close match exists in contacts/leads, no hybrid fallback is triggered.
- Reduced noisy chat-driven workspace preview churn for exact lookups in `ui/src/hooks/useChat.ts`:
  - exact `search_contacts(name=...)` and exact `search_companies(company_name=...)` results no longer auto-emit `navigate + set_filter` app actions,
  - avoids showing an empty/in-progress "Applying filters" Live UI Preview card for simple person/company find queries.
- Applied table-density UI compaction for CRM list pages and shared controls:
  - `ui/src/pages/Contacts.tsx`: reduced header/padding footprint, tighter table header/body spacing, lower virtual row height, smaller action buttons, lighter chip density, narrower table minimum width.
  - `ui/src/components/contacts/tableColumns.tsx`: compact checkbox/chevron gutter, reduced typography scale, tighter line-height, single-line truncation for title/company, narrower status/actions columns, lighter sort affordances.
  - `ui/src/components/contacts/SalesforceStatusBadge.tsx`: smaller pill chip treatment (`text-[10px]`, tight padding).
  - `ui/src/components/shared/SearchToolbar.tsx`: reduced search/input/button heights and icon/label spacing for denser list-page toolbars.
  - `ui/src/components/shared/PageHeader.tsx`: compressed title/subtitle/action spacing; subtitle now aligns inline with title on desktop for reduced vertical header weight.
  - `ui/src/pages/Companies.tsx` + `ui/src/components/companies/tableColumns.tsx`: mirrored compact density adjustments so list pages remain visually consistent with Contacts.

## 2026-02-23 - Assistant Panel System (Phase Progress)

- Continued implementation of `docs/concepts/assistant-panel-system-proposal.md`:
  - Phase 1 card unification: `ui/src/components/chat/EventRow.tsx` and `ui/src/components/chat/WorkflowEventCard.tsx` now render through `ui/src/components/chat/UnifiedCard.tsx`.
  - Phase 2 shell integration foundation:
    - added `ui/src/components/assistant/GlobalAssistantPanel.tsx`,
    - added `ui/src/components/assistant/ContextPreviewDrawer.tsx`,
    - updated `ui/src/components/shell/ChatFirstShell.tsx` to route assistant and preview surfaces via these new abstractions,
    - updated `ui/src/components/shell/LegacySplitShell.tsx` to route assistant surface via `GlobalAssistantPanel`.
- This keeps existing behavior stable while reducing shell-level coupling to legacy chat surface components, enabling Phase 3 deprecation work.

## 2026-02-23 - Assistant Panel System (Phase 4 Trigger Rules)

- Tightened context-preview trigger behavior in `ui/src/chat/actionExecutor.ts`:
  - removed chat-driven workspace interaction previews for navigation/filter/selection actions,
  - preserved route updates and chat context while clearing interaction state to prevent unwanted preview takeovers.
- Context preview now remains primarily tied to complex browser workflow actions (`browser.observe`, `browser.annotate`, `browser.synthesize`, `browser.validate`).
- Updated shell labeling in `ui/src/components/shell/ChatFirstShell.tsx` from `Live UI Preview` to `Context Preview` to align with the new surface naming.

## 2026-02-23 - Assistant Panel System (Phase 3 Route Migration Complete)

- Unified assistant surface routing to `ui/src/components/assistant/GlobalAssistantPanel.tsx` across shell paths.
- Removed legacy split-shell implementation:
  - deleted `ui/src/components/shell/LegacySplitShell.tsx`.
- Removed deprecated assistant pane implementation:
  - deleted `ui/src/components/chat/ChatPane.tsx`.
- Removed legacy shell toggles and query-param fallback:
  - simplified `ui/src/components/shell/AppShell.tsx` to always render `ChatFirstShell`,
  - removed interface shell-toggle controls/state from `ui/src/components/settings/SettingsModal.tsx`.

## 2026-02-23 - Assistant Panel System (Phase 4 Strict Preview Allowlist)

- Added centralized preview gating helper:
  - `ui/src/components/assistant/contextPreviewRules.ts`
- Enforced allowlist in shell rendering:
  - `ui/src/components/shell/ChatFirstShell.tsx` now shows `ContextPreviewDrawer` only when `isContextPreviewAllowed(...)` is true.
- Enforced allowlist in interaction signaling:
  - `ui/src/chat/actionExecutor.ts` now sets `openWorkspace` from `isContextPreviewAllowed(...)` for routed interaction payloads.
- Current allowlist behavior:
  - preview is only eligible for `workflow` interactions on `/browser*` routes.

## 2026-02-23 - Chat Confirmation Regression Guard (Read-only Plans)

- Hardened read-only plan confirmation behavior so lookup plans do not block on confirmation:
  - added `areAllPlannedCallsReadOnly(...)` in `ui/src/chat/chatEnginePolicy.ts`.
  - updated `ui/src/chat/chatEngine/responseBuilder.ts` to force `shouldConfirm=false` when all planned calls are read-only.
- Added a defensive UI-layer fallback in `ui/src/hooks/useChat.ts`:
  - if a confirmation payload is marked required but contains only read-only calls, it auto-executes immediately instead of rendering confirm/deny controls.

## 2026-02-23 - LLM-first Intent Routing (No Deterministic Regex Fast Path)

- Updated `ui/src/chat/chatEngine/intentClassifier.ts` to remove deterministic regex/keyword intent guards and use LLM classification as the primary route decision path.
- Removed deterministic regex contact-target fast routine from `ui/src/chat/chatEngine/pipelineSteps.ts` (`extractActionTarget` + `stepDeterministicRoutines`).
- Added a guard in `stepGenericRetrievalBootstrap` so conversational intents do not fall into automatic `hybrid_search` bootstrap when fast-path planning fails.

## 2026-02-23 - Complex BDR Workflow Routing/Planning Fix

- Re-enabled skill-first routing in planning mode even when `requireToolConfirmation` is true:
  - `ui/src/chat/chatEngine/pipelineSteps.ts` (`stepTrySkillFirst`).
  - This prevents complex BDR requests from skipping deterministic skill plans and degrading into shallow generic tool plans.
- Expanded `prospect-companies-and-draft-emails` skill matching + extraction coverage for realistic enterprise constraints:
  - `ui/src/assistant-core/skills/loader.ts`
  - added trigger phrases for decision-maker identification, personalized outreach, revenue/location/years constraints.
  - added extract fields: `decision_maker_title`, `min_revenue_millions`, `min_years_in_business`.
- Improved skill handler parsing and query construction for those constraints:
  - `ui/src/assistant-core/skills/handlers/prospectCompaniesAndDraftEmails.ts`
  - parses phrases like "based in California", "revenue over $500 million", and "at least 10 years in business",
  - carries those constraints into company/contact discovery query strings and campaign enrollment query.

## 2026-02-23 - BDR Local-First Execution + Frontend Rebuild Reliability

- Updated `prospect-companies-and-draft-emails` execution plan to run local CRM discovery first:
  - `ui/src/assistant-core/skills/handlers/prospectCompaniesAndDraftEmails.ts`
  - now starts with `search_companies` and `search_contacts` for constrained BDR prompts.
  - SalesNav collection (`collect_companies_from_salesnav`) is now only inserted when the user explicitly references Sales Navigator/LinkedIn in the request.
- Expanded skill allowlist to support local-first steps:
  - `ui/src/assistant-core/skills/loader.ts`
  - added `search_companies`, `search_contacts`, and `collect_companies_from_salesnav`.
- Fixed startup behavior that served stale frontend bundles:
  - `scripts/start_backend.bat` now rebuilds `ui` on every backend start by default (set `SKIP_UI_BUILD=1` to bypass).

## 2026-02-23 - BDR Discovery-Only Requests No Longer Auto-Create Campaigns

- Refined `prospect-companies-and-draft-emails` flow assembly in:
  - `ui/src/assistant-core/skills/handlers/prospectCompaniesAndDraftEmails.ts`
- Behavior change:
  - discovery steps (`search_companies`, optional SalesNav expansion, `search_contacts`) always run for matched prospecting requests.
  - campaign/email mutation steps are now appended only when the user explicitly asks for campaign/outreach/email/sequence/draft/send/schedule/enroll actions.
- This prevents prompts like "Identify key decision-makers..." from opening write confirmations before discovery is completed.

## 2026-02-23 - Conditional SalesNav Escalation for Complex BDR Workflows

- Refined complex prospecting orchestration to match expected behavior for prompts that combine strict filters + outreach intent.
- `ui/src/assistant-core/skills/handlers/prospectCompaniesAndDraftEmails.ts`:
  - local-first discovery remains first (`search_companies`, `search_contacts`),
  - added explicit `escalate_salesnav_background` step using `compound_workflow_run` with Sales Navigator phases,
  - escalation is confirmation-gated and designed for async background execution.
- `ui/src/assistant-core/router/recipeRouter.ts`:
  - added conditional step routing for `prospect-companies-and-draft-emails`:
    - if local leads exist, skip SalesNav escalation and proceed to campaign steps,
    - if local leads do not exist, skip campaign steps and pause on a custom escalation confirmation prompt.
  - improved `$prev.*` argument resolution to support nested/fallback campaign id extraction (`id`, `campaign_id`, nested payloads).
  - resume path now stores resolved args for follow-on confirmation steps to avoid unresolved template args after confirm.
- `ui/src/chat/chatEngine/skillAdapter.ts`:
  - confirmation payload now includes only the next pending step call (not all remaining steps), preventing accidental execution with unresolved downstream args.

## 2026-02-23 - SalesNav Escalation Now Builds Structured URL Filters

- Improved background SalesNav escalation spec generation in:
  - `ui/src/assistant-core/skills/handlers/prospectCompaniesAndDraftEmails.ts`
- Changes:
  - escalation account-search phase now passes explicit `filter_values` (industry when derivable, headquarters location, annual revenue lower bound),
  - escalation people-search phase now runs as an iteration over discovered companies and passes structured people filters (`seniority_level`, inferred function, annual revenue, location scope) with company identity templates,
  - this reduces reliance on raw keyword-only search input and pushes constraints into URL/query builder filter handling.

## 2026-02-23 - Shifted SalesNav Filter Derivation to Backend Canonical Parser/Builder

- Updated `ui/src/assistant-core/skills/handlers/prospectCompaniesAndDraftEmails.ts` to remove UI-side deterministic people-filter inference.
- Escalation phases now pass full natural-language query and rely on backend SalesNav workflow decomposition + URL query builder for canonical filter mapping.
- Canonical mapping sources used by backend:
  - `data/linkedin/salesnav-filters.json`
  - `data/linkedin/salesnav-filters-ids.json`
- This reduces drift between assistant skill prompts and live SalesNav filter-ID coverage.

## 2026-02-23 - Region Filter Fallback for SalesNav URL Builder

- Updated `services/web_automation/linkedin/salesnav/query_builder.py`:
  - `_build_region_clause` now gracefully degrades state-level values like `"California, United States"` to `"United States"` when a state REGION id is not mapped.
  - This prevents hard failures (`salesnav_filter_unmapped` / `unmapped_region_id`) and allows SalesNav URL navigation to proceed with country-level filtering.

## 2026-02-23 - Industry Canonicalization Fallback for Noisy NL Outputs

- Updated `services/web_automation/linkedin/salesnav/query_builder.py`:
  - `_build_industry_clause` now canonicalizes noisy industry strings produced by NL decomposition (for example `"companies in the tech"`) before ID lookup.
  - Added synonym/token fallback mapping to known canonical industries (for example tech/software -> `Technology, Information and Internet`).
  - Unmapped error payloads now preserve the original raw input value while using normalized values for successful query construction.

## 2026-02-23 - SalesNav LLM-Driven Keywords + Deterministic Filter-ID Mapping

- Updated `services/web_automation/browser/workflows/recipes.py`:
  - removed deterministic keyword shaping (`query.split()[0]`, stopword token filtering, and single-token reducers) from SalesNav account/people URL flow.
  - SalesNav keyword text now comes from parser output only (LLM-driven) for both account and people tasks.
  - removed deterministic people-filter derivation from raw query text in this path.
  - removed local regex fallback decomposition when parser fails; failures now fall back to existing query/filter payloads without regex/pattern rewriting.
  - added decomposition-availability guard: if parser output is unavailable, the workflow never uses raw NL prompt as keyword; it runs filter-only when structured filters exist, otherwise returns `salesnav_decomposition_unavailable`.
- Updated `services/web_automation/linkedin/salesnav/parser/filter_parser.py` prompt rules:
  - added explicit guidance to avoid instruction/meta words in `keywords`.
  - added guidance to emit `keywords: []` when strong structured constraints already capture intent.
- Deterministic behavior remains in canonical SalesNav filter mapping only, sourced from:
  - `data/linkedin/salesnav-filters.json`
  - `data/linkedin/salesnav-filters-ids.json`

## 2026-02-23 - Prospect Handler Now Passes Raw Industry to Backend SalesNav Mapper

- Updated `ui/src/assistant-core/skills/handlers/prospectCompaniesAndDraftEmails.ts`:
  - removed narrow UI-side industry allowlist that only forwarded a few verticals.
  - SalesNav escalation now forwards the parsed `industry` text directly in `filter_values.industry` so backend canonical mapping can resolve values like `tech`.
  - people-phase SalesNav filter payload now carries location when available (`headquarters_location`) in addition to revenue/industry.

## 2026-02-23 - Backend Industry Fallback When Decomposition Is Unavailable

- Updated `services/web_automation/browser/workflows/recipes.py`:
  - when SalesNav decomposition is unavailable, account-search fallback now attempts deterministic industry inference from the original query before URL build.
- Added `infer_industry_from_query_text` in `services/web_automation/linkedin/salesnav/query_builder.py`:
  - infers canonical industry values using catalog/ID-grounded mappings (including `tech` -> `Technology, Information and Internet`),
  - keeps deterministic filter matching tied to `data/linkedin/salesnav-filters.json` and `data/linkedin/salesnav-filters-ids.json`.
