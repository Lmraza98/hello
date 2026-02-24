---
summary: "Module map and ownership guide for the refactored launcher_frontend app architecture."
read_when:
  - You need to modify launcher UI behavior without reintroducing monolithic App logic
  - You are tracing graph/tests/run interactions across hooks
  - You are onboarding to launcher frontend maintenance
title: "Launcher Frontend Architecture"
---

# Launcher Frontend Architecture

This guide documents the post-refactor launcher frontend structure under `launcher_frontend/src/app`.

## Purpose

- Keep `App` and `AppOrchestrationRoot` thin.
- Separate domain state/control from rendering.
- Keep graph/runtime behavior deterministic while reducing prop/setter sprawl.

## Top-Level Flow

1. `src/App.jsx` mounts `src/app/App.jsx`.
2. `src/app/App.jsx` wraps with `AppFatalBoundary` and renders `AppOrchestrationRoot`.
3. `src/app/AppOrchestrationRoot.jsx` renders `AppShellView` from `useAppOrchestrationRoot()`.
4. `src/app/hooks/useAppOrchestrationRoot.js` composes domain hooks and builds 4 view models:
   - `chrome`
   - `topBar`
   - `testsView`
   - `graphView`

## Directory Ownership

- `src/app/hooks/`
  - Domain orchestration hooks (`useRunOperations`, `useGraphRuntime`, `useBridgePolling`, etc.).
- `src/app/hooks/graph/`
  - Graph-model specific derivation (`useGraphModel`).
- `src/app/views/`
  - Render-only view components (`AppShellView`, `TestsView`, `GraphView`, `RunHistorySection`).
- `src/app/state/`
  - Reducers and root dispatch adapters.
- `src/app/state/selectors/`
  - Pure selector/packaging helpers for shell inputs.
- `src/app/state/selectors/ctx/`
  - Pure context builders used by root composition.
- `src/app/utils/`
  - Pure utility logic used across hooks.
- `src/app/constants/`
  - Shared layout constants.

## Root State Domains

`useAppOrchestrationRoot` owns reducer-backed domains:

- `dataState`: logs/startup/tests/status/runs snapshots.
- `selectionState`: suite/test/case/filter selection state.
- `runState`: run lifecycle state (selected/active run, live mode, pause/resume flags, preview state).
- `uiState`: tab and shell UI state (drawers, utility menus, run history panel state).

Dispatch adapters are created by `useRootDispatchers` and passed to domain hooks.

## Core Hook Contracts

- `useBridgePolling`
  - Poll cadence invariant:
    - `700ms` when `liveMode || anyRunActive`
    - `1200ms` otherwise.
  - Uses `useInterval` + `useLatestRef` to avoid interval churn.
- `useFiltersAndSelection`
  - Owns suite/test/case validity guards and run-scoped filtering.
- `useGraphController`
  - Owns graph UI/domain mutable state containers.
- `useGraphRuntime`
  - Combines runtime model derivations and runtime effects.
- `useRunOperations`
  - Owns run/pause/stop/refresh/clear/cache/copy action handlers.
- `useRunHotkeys`
  - Keyboard shortcut bindings only.
- `useAppShellViewModel`
  - Maps grouped domain inputs into view-facing models.

## Selector and Context Packaging

Pure helpers under `src/app/state/selectors` and `src/app/state/selectors/ctx` are used to keep root wiring short and explicit:

- `selectChromeInput`, `selectRunOpsInput`, `selectTestsInput`, `selectGraphInput`
- `buildGraphRuntimeCtx`, `buildRunOpsCtx`, `buildRunHotkeysCtx`
- `buildShellLayoutInput`, `buildShellUiInput`, `buildSelectorState`

State and actions are intentionally passed separately to avoid coupling action functions into state objects.

## Graph-Specific Notes

- `useGraphModel` owns `buildGraphModel(...)` memoization and debug-signature logging.
- Scoped graph overlay validation is centralized in `utils/resolveScopedGraph.js`.
- Aggregate/child selection normalization helpers remain in `utils/ids.js`.

## Extension Rules

When adding new launcher behavior:

1. Prefer adding logic to a focused domain hook, not root.
2. Keep pure calculations in `utils/` or `state/selectors/`.
3. Keep view components render-focused; pass intent handlers from view models.
4. Preserve existing runtime invariants:
   - bridge API contract
   - polling cadence
   - graph follow/scope semantics
   - localStorage key `launcher.graph.rightWidth`
   - hotkey semantics.

## Quick Navigation

- Root composition: `launcher_frontend/src/app/hooks/useAppOrchestrationRoot.js`
- Shell VM mapping: `launcher_frontend/src/app/hooks/useAppShellViewModel.js`
- Graph runtime: `launcher_frontend/src/app/hooks/useGraphRuntime.js`
- Run orchestration: `launcher_frontend/src/app/hooks/useRunOperations.js`
- Polling: `launcher_frontend/src/app/hooks/useBridgePolling.js`

