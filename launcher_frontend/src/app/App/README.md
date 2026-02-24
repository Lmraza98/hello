# App Architecture

`App.jsx` is a thin orchestration entrypoint that mounts `AppOrchestrationRoot.jsx`.
`AppOrchestrationRoot.jsx` is intentionally minimal: it resolves bridge readiness and renders `AppShellView`.
`hooks/useAppOrchestrationRootView.jsx` exports `useAppOrchestrationRoot()`, a real hook that returns grouped view models (`chrome`, `topBar`, `testsView`, `graphView`).
`hooks/useAppShellViewModel.js` consumes grouped domain inputs (`chrome`, `runOps`, `tests`, `testsActions`, `graph`, `layout`, `ui`) and publishes view-facing models, including `graphView.actions` intent handlers.

Flow:
- `useBridgePolling` refreshes bridge snapshots (`logs/startup/tests/status/runs`) and controls polling cadence.
- `useFiltersAndSelection` derives test list/filter/selection state and guards stale selections.
- `useSplitPaneLayout` owns tests/graph split-pane sizing, drag handling, and graph right-pane persistence.
- `useGraphController` owns graph-domain state containers (scope, follow, playback state, scoped model, child polling buckets).
- `useRunController` handles run actions (`run/preview/pause/clear/cache/copy`) against the bridge.
- `TestsView` and `GraphView` render presentational layouts.

# Debugging Map

- Runtime debug toggle: `window.__LP_DEBUG__ = true` or `localStorage.setItem("LP_DEBUG", "1")`.
- Follow/autotrack internals: `runAutoTrackRef`.
- Scoped graph model signature drift: `graphModelSigRef`.
- Missing run reconciliation guard: `missingSelectedRunRef`.

# Utility Modules

- `utils/ids.js`: canonical id normalization and run-id selection builder.
- `utils/runPickers.js`: aggregate/child pickers for graph-follow.
- `utils/comparisons.js`: progress row equality checks to avoid noisy state churn.
