---
summary: "Release-gate and live validation workflow for Browser Workflow Builder end-to-end testing."
read_when:
  - You need to validate Observe -> Annotate -> Synthesize end-to-end behavior
  - You are triaging workflow-builder regressions in API/UI integration
title: "Workflow Builder E2E Testing"
---

# Workflow Builder E2E Testing

This guide defines the test layers for Browser Workflow Builder (`/browser`) and how to run them before sign-off.

## Coverage Layers

1. Route integration tests (deterministic, CI-friendly)
2. Live end-to-end API run (real backend + real browser tab state)
3. UI/manual checks for scroll and interaction behavior in constrained viewports

## 1) Route Integration Suite

Runs deterministic endpoint-level coverage for:

- `POST /api/browser/workflows/observation-pack`
- `POST /api/browser/workflows/validate-candidate`
- `POST /api/browser/workflows/annotate-candidate`
- `POST /api/browser/workflows/synthesize-from-feedback`

Command:

```bash
pytest -q tests/api_routes/test_browser_workflow_builder_api_routes.py
```

What it validates:

- successful payload shape + scoring behavior
- synthesized selector output + candidate validation
- internal error handling path (HTTP 500 detail propagation)

## 2) Live End-to-End API Flow

Use the live pytest suite when a backend is running and at least one browser tab exists.

Command:

```bash
WORKFLOW_BUILDER_LIVE_BASE_URL=http://127.0.0.1:8000 pytest -q tests/api_routes/browser/test_workflow_builder_live_e2e.py
```

Optional explicit tab:

```bash
WORKFLOW_BUILDER_LIVE_BASE_URL=http://127.0.0.1:8000 WORKFLOW_BUILDER_LIVE_TAB_ID=tab-1 pytest -q tests/api_routes/browser/test_workflow_builder_live_e2e.py
```

Optional deterministic seed page for self-setup:

```bash
WORKFLOW_BUILDER_LIVE_BASE_URL=http://127.0.0.1:8000 WORKFLOW_BUILDER_LIVE_SEED_URL=https://news.ycombinator.com/ pytest -q tests/api_routes/browser/test_workflow_builder_live_e2e.py
```

Optional teardown control:

```bash
WORKFLOW_BUILDER_LIVE_AUTO_CLEANUP=0 pytest -q tests/api_routes/browser/test_workflow_builder_live_e2e.py
```

The suite provides phase-level tests that can be run independently while replaying prerequisites:

1. `/api/browser/tabs`
2. `/api/browser/workflows/observation-pack`
3. `/api/browser/workflows/validate-candidate`
4. `/api/browser/workflows/annotate-candidate`
5. `/api/browser/workflows/synthesize-from-feedback`
6. `/api/browser/workflows/tasks`

Each test fails fast with route-specific assertion details.

Live precondition behavior:

- if no open tab has usable `role_refs`, the suite auto-navigates a tab to `WORKFLOW_BUILDER_LIVE_SEED_URL` and retries observation.
- if role refs are still unavailable after auto-navigation, observation-dependent phases are skipped with an actionable message.
- if annotate returns zero boxes for the current page state, downstream annotate/synthesize/tasks live phases are skipped.
- this avoids false negatives when the browser is open on a non-candidate page while preserving true route failures.
- after each live test, teardown runs by default:
  - `POST /api/browser/shutdown` (best-effort browser session close)
  - `POST /api/admin/launcher/stop` with `mode=terminate_workers` (best-effort worker stop/restart cycle)
- set `WORKFLOW_BUILDER_LIVE_AUTO_CLEANUP=0` to disable automatic teardown during manual debugging.

## 3) UI Regression Checks (Manual)

After the live flow passes, verify in `/browser`:

1. `Observe` populates suggested candidates
2. `Use + Annotate` renders overlay boxes and table rows
3. vertical scroll works after annotate on:
   - full width
   - half-width viewport
4. no horizontal scrollbar appears in workflow controls on narrow widths
5. include/exclude/clear actions remain responsive

## Recommended Release Gate

Run in this order:

1. `pytest -q tests/api_routes/test_browser_workflow_builder_api_routes.py`
2. `WORKFLOW_BUILDER_LIVE_BASE_URL=http://127.0.0.1:8000 pytest -q tests/api_routes/browser/test_workflow_builder_live_e2e.py`
3. manual UI regression checks in `/browser`

## Launcher-Orchestrated Runs

The LeadPilot launcher now supports manifest-driven, isolated test orchestration with run history and exported artifacts.

1. Start `python launcher.py`.
2. Open the `Tests` tab.
3. Use filters (`suite/kind/tag/outcome`) and `Preview Run Plan`.
4. Run selected tests or run by tag filter.
5. Open artifacts from run history (`JSON/JUnit` exported by default).

Catalog source of truth:

- `config/launcher_test_catalog.v1.json`

Operational details:

- `docs/help/launcher-test-orchestration.md`

## Troubleshooting

- `FAIL: no tabs available`: create/navigate a browser tab via `/browser` first.
- `annotate-candidate returned zero boxes`: switch to a list-heavy page or adjust selector pattern.
- synthesize failures: verify selected include box ids actually exist in returned `annotation.boxes`.
