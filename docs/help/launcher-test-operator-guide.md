---
summary: "Day-to-day guide for running launcher tests, using Graph/Follow, filters, artifacts, and troubleshooting."
read_when:
  - You need to run tests from launcher UI
  - You are debugging follow/playback/filter behavior in Tests/Graph
  - You need the operational checklist before handoff
title: "Launcher Test Operator Guide"
---

# Launcher Test Operator Guide

## Primary Workflow

1. Start launcher:
- `python launcher.py`

2. Pick execution scope:
- `Run` executes current filtered scope.
- `Run Selected` prioritizes graph-selected node, then checked cases, then selected case/test.

3. Monitor execution:
- Use `Tests` tab for suite/case statuses.
- Use `Graph` tab for dependency flow, follow behavior, and playback.

4. Inspect outputs:
- Use bottom `Run History` strip in both Tests and Graph.
- Load previous runs, open artifacts directory, copy JSON/JUnit/log diagnostics.

## Controls Contract (UI)

- `Pause` and `Stop` only appear while a run is actively in-flight.
- `Stop` is a hard cancel: it cancels the active run, recycles worker process state, and refreshes graph/tests context.
- Hard `Stop` also resets live card status state to not-run after cancellation refresh.
- `Pause` is not cancel: it halts after current test and preserves resume intent.
- `Reset State` clears visual runtime state but preserves run artifacts/history.
- `Preview` should never block navigation even on plan errors.

## Graph Follow + Playback

- Follow tracks active execution and auto-pans to active node.
- Manual drag/scroll pauses follow to avoid UI fighting user input.
- Graph viewport supports click-drag panning (canvas drag to move across the DAG).
- Graph zoom supports toolbar controls (`-`, `%`, `+`) and `Ctrl + mouse wheel`.
- In suite scope, clicking an aggregate card animates it upward and keeps its child cluster aligned to the right; `Gate: pytest runtime ready` stays pinned at the top.
- Graph node hover is border-only (subtle slate/blue), with no floating hover/click popup cards.
- Aggregate filters keep suite inline behavior (bubble/remap/guide) and auto-focus a filtered aggregate when needed.
- Follow can be resumed without losing run continuity.
- Artifact replay and live follow are isolated:
  - historical playback will not be hijacked by live state,
  - replay follow tracks playback-active node/scope transitions.
- Bottom graph playback bar is artifact-scoped:
  - visible only when an artifact run is loaded for replay,
  - hidden for live/non-artifact graph state.

## Filters and Selection

Global filter context is shared across Tests and Graph:

- Aggregate filters set in Graph apply in Tests and vice versa.
- Clear paths:
  - per-filter clear (`X`) in Tests filter chips,
  - per-chip `x` removal + `Clear` in Graph aggregate pill,
  - top-bar `Clear Filters (N)` from any tab.
- Aggregate scope supports multi-select:
  - use `Add...` to add multiple aggregate filters,
  - remove any single aggregate chip via `x`,
  - clear all aggregate filters via `Clear`.

## Run History and Artifacts

- Run history appears in both tabs and supports status filtering.
- Loading a run sets graph/tests context to that run's artifact state.
- Historical run loading should be deterministic and replayable.

## Troubleshooting Quick Checks

If behavior looks wrong:

- Confirm run is still active in top controls (Pause/Stop visibility).
- Confirm active filters (`Clear Filters (N)` in top bar).
- Confirm selected run in Run History (historical vs live context).
- For graph issues, toggle Follow off/on and verify scope selection.

If launcher startup fails:

- check startup issue panel for dependency/port errors,
- verify backend/bridge readiness and available ports,
- verify frontend build prerequisites if required build is enabled.

## Verification Checklist

Use for operational sign-off:

1. `python scripts/docs_guard.py`
2. `python scripts/docs_ci.py`
3. `python launcher.py`
4. verify bridge binds and UI renders
5. trigger `Preview` and confirm UI remains usable on failure
6. run at least one test and confirm artifacts/runs render


