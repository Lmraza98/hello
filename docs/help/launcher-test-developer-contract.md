---
summary: "Developer-facing contract for launcher test orchestration runtime, manifest schema, worker protocol, and API boundaries."
read_when:
  - You are changing launcher runtime behavior or worker protocol
  - You are editing catalog/planner/dependency execution contracts
  - You need exact API and artifact invariants
title: "Launcher Test Developer Contract"
---

# Launcher Test Developer Contract

## Runtime Architecture

1. `launcher.py`
- orchestrates backend/bridge/worker lifecycle,
- coordinates UI state and run updates,
- persists and exposes diagnostics.
- refreshes `config/launcher_case_deps.v1.json` on startup by invoking `scripts/generate_launcher_case_deps.py` (unless `LAUNCHER_SKIP_CASE_DEPS_GEN=1`).
- loads optional workflow DAG steps from `config/launcher_workflow_steps.v1.json` and merges them into runtime step planning (`case_steps`) for dependency-closed `run_steps` execution.

2. `launcher_runtime/catalog.py`
- loads `config/launcher_test_catalog.v1.json`,
- validates schema + command safety constraints.

3. `launcher_runtime/planner.py`
- resolves dependency-closed execution sets,
- topologically orders steps/tests,
- detects cycles.

4. `scripts/launcher_test_worker.py`
- isolated subprocess execution,
- timeout/retry/cancel handling,
- structured event streaming.

5. `launcher_runtime/run_store.py`
- metadata/events/stdout/results persistence,
- JSON + JUnit outputs,
- retention pruning policy.

## Catalog Contract

Path:
- `config/launcher_test_catalog.v1.json`

Required concepts:
- `catalog_version`, `suites[]`, `tests[]`
- test fields: `id`, `name`, `kind`, `command_template[]`, `args[]`, `cwd`, `env_allowlist[]`, `timeout_sec`, `retries`, `depends_on[]`, `artifacts`, `enabled`

Dependency modeling:
- prefer lightweight gate tests for readiness constraints,
- avoid broad suite-to-suite coupling,
- keep aggregate DAG structure explicit and non-overlapping.

Workflow step contract:
- Optional file: `config/launcher_workflow_steps.v1.json`
- Each `steps[]` row supports:
  - `id`, `label`, `parent_test_id`, `kind`, `deps[]`
  - `command_template[]`, `args[]`, `cwd`, `env_allowlist[]`, `timeout_sec`, `retries`
- Runtime token expansion is supported in workflow step command fields:
  - `__RUN_ID__`
  - `__RUN_DIR__`
  - `__STEP_ID_SANITIZED__`

## Security Model

- command execution is allowlist-only,
- shell metacharacters are rejected,
- no raw shell execution path,
- environment propagation is explicit via `env_allowlist[]`.

## Worker Protocol

Transport:
- NDJSON over stdio.

Requests:
- `discover`, `run_plan`, `cancel`, `ping`, `run_steps`.

Events:
- `run_started`, `test_started`, `test_output`, `test_finished`, `run_finished`, `worker_error`, `worker_stderr`, `heartbeat`.

Structured step artifact payload (optional, additive):
- Worker parses `test_output` lines with prefix `[launcher-step-json] ` and merges JSON fields into step result payload.
- Supported keys:
  - `inputs`
  - `tool_call`
  - `tool_response`
  - `outputs`
  - `normalized_output_hash`
  - `artifacts`
  - `error_trace`
- These fields are emitted in `test_finished`, persisted in `results.json.tests[]`, and copied into `run_trace.json` step outputs.

Child event invariants:
- child event IDs are canonicalized,
- parent-child linkage is preserved for aggregate pytest nodes,
- child note output is promoted for timeline/follow consistency.

## Artifacts Contract

Per-run root:
- `data/launcher_runs/run-<timestamp>-<id>/`

Key files:
- `metadata.json`
- `events.ndjson`
- `stdout.log`
- `results.json`
- `results.junit.xml`
- `run_trace.json`

`results.json` runtime analysis fields:
- `dependency_analysis.version`: analysis schema version.
- `dependency_analysis.planned_edges[]`: normalized planned DAG edges (`from` -> `to`) for nodes in the run scope.
- `dependency_analysis.observed_edges[]`: observed stream-predecessor edges inferred from runtime event order.
- `dependency_analysis.drift.missing_planned_edges[]`: planned edges not seen in observed runtime ordering for started nodes.
- `dependency_analysis.drift.unexpected_observed_edges[]`: observed ordering edges not declared in planned DAG.
- `dependency_analysis.drift.nodes_started_before_planned_ready[]`: nodes that emitted `test_started` before one or more planned deps emitted `test_finished`.
- `dependency_analysis.nodes[]`: per-node planned deps, start-time satisfaction snapshot, attempts, and first/last observed runtime timestamps.

## Frontend/Runtime Integration Invariants

- Tests and Graph share global filter state for aggregate scope.
- Follow/playback behavior must not let live state hijack artifact replay.
- Graph bottom playback controls are artifact-replay only; they must be hidden for live/non-artifact graph context.
- `Run` uses filtered scope; `Run Selected` uses explicit priority selection.
- Pause/Stop controls are tied to true in-flight run state.
- Suite inline aggregate expansion computes aggregate/child bounds in graph layout coordinates only (never screen/pan/zoom space), and guide anchors are derived from node rects.
- Selected inline child cluster is vertically normalized to the selected aggregate start-child center to prevent off-lane drift after bubble reorder.
- Playback cursor selection normalizes child focus to aggregate roots in suite scope so inline expansion/guide behavior matches manual selection.
- Dev-only graph bounds instrumentation can be enabled with `window.__DEV_GRAPH_BOUNDS__ = true` or `localStorage.setItem("DEV_GRAPH_BOUNDS","1")`.

## Bridge API Contract Table

| Method | Input | Output | Failure Behavior |
|---|---|---|---|
| `get_logs` | none | `string` | empty string on no logs |
| `get_startup_state` | none | `object` | startup issue data included |
| `get_tests` | none | `array` | empty list if unavailable |
| `get_test_status` | none | `object` | empty map if unavailable |
| `preview_plan` | `test_ids[]`, `tags[]` | `array` of `{order,id,name}` | UI must catch errors |
| `run_plan` | `test_ids[]`, `tags[]` | `{ok, run_id?, error?}` | `{ok:false,error}` on rejection |
| `cancel_current_test` | none | none | best-effort cancel |
| `cancel_run` | none | none | best-effort cancel |
| `stop` | `mode` | `{ok, mode, error?}` | `after_current` = pause semantics; `terminate_workers` = hard-cancel + worker recycle + runtime status reset to `not_run`; `{ok:false,error}` on failure |
| `get_runs` | none | `array` | empty list on no history |
| `get_child_events` | `run_id`, `child_id`, `attempt_id?` | `array` | empty list when unavailable |
| `get_child_progress` | `run_id`, `parent_id`, `attempt_id?` | `array` | empty list when unavailable |
| `get_run_trace` | `run_id?` | `object|null` | `null` if missing |
| `trace_set_plan` | payload + `run_id?` | `{ok, run_id?, error?}` | `{ok:false,error}` on failure |
| `trace_record_diff` | payload + `run_id?` | `{ok, run_id?, error?}` | `{ok:false,error}` on failure |
| `trace_add_verification` | payload + `run_id?` | `{ok, run_id?, error?}` | `{ok:false,error}` on failure |
| `open_run_dir` | `run_id` | none | no-op/log if missing |
| `get_diagnostics_summary` | none | `string` | redacted summary |
| `open_app` | none | none | opens app URL |
| `shutdown` | none | none | terminates launcher process |

## Documentation Contract

When behavior changes in launcher runtime/UI contracts:

- update relevant launcher docs in same task,
- run:
  - `python scripts/docs_guard.py`
  - `python scripts/docs_ci.py`
- regenerate API docs when API contracts changed:
  - `python scripts/export_api_docs.py`
