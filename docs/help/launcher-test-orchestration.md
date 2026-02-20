---
summary: "Production-hardened launcher test orchestration model, manifest contract, and run artifact lifecycle."
read_when:
  - You are adding or editing launcher test cases
  - You need deterministic local debugging and test-run artifacts
  - You are troubleshooting launcher startup or worker execution failures
title: "Launcher Test Orchestration"
---

# Launcher Test Orchestration

The developer launcher (`python launcher.py`) now uses a strict, manifest-driven orchestration runtime for debugging and test execution.

## Architecture

1. `launcher.py`
- starts backend + LeadPilot bridge,
- manages UI and diagnostics,
- coordinates run state and artifacts.

2. Catalog loader (`launcher_runtime/catalog.py`)
- loads `config/launcher_test_catalog.v1.json`,
- validates schema and command safety,
- enforces allowlisted command binaries.

3. Planner (`launcher_runtime/planner.py`)
- resolves selected tests + dependencies,
- computes deterministic execution order,
- detects dependency cycles.

4. Worker process (`scripts/launcher_test_worker.py`)
- executes tests in isolated subprocesses,
- enforces timeout/retry/cancel behavior,
- streams structured run events.

5. Run store (`launcher_runtime/run_store.py`)
- persists metadata/events/stdout/results,
- writes JSON + JUnit outputs,
- prunes old runs (`max 50` and `30 days`).

## Catalog Contract

Path:

- `config/launcher_test_catalog.v1.json`

Top-level fields:

- `catalog_version` (`"1"`)
- `suites[]`

Suite fields:

- `id`, `name`, `description`, `tags[]`, `tests[]`

Test fields:

- `id`, `name`, `kind` (`unit|integration|live|smoke|custom`)
- `command_template[]` (tokenized command, no shell mode)
- `args[]`
- `cwd`
- `env_allowlist[]`
- `timeout_sec`
- `retries`
- `depends_on[]`
- `artifacts` (`logs|junit|json|screenshots`)
- `enabled`
- optional `tags[]`

## Security Model

Execution is strict allowlist only:

- disallowed command binaries are rejected,
- shell metacharacters in command/args are rejected,
- no raw shell execution path exists,
- only env vars in `env_allowlist[]` are passed explicitly from launcher context.

## Worker Protocol

Transport: newline-delimited JSON over stdio.

Requests:

- `discover`
- `run_plan`
- `cancel` (`scope: current|run`)
- `ping`

Events:

- `run_started`
- `test_started`
- `test_output`
- `test_finished`
- `run_finished`
- `worker_error`
- `heartbeat`

## Run Artifacts

Root:

- `data/launcher_runs/`

Per run:

- `run-<timestamp>-<id>/metadata.json`
- `run-<timestamp>-<id>/events.ndjson`
- `run-<timestamp>-<id>/stdout.log`
- `run-<timestamp>-<id>/results.json`
- `run-<timestamp>-<id>/results.junit.xml`

## Startup State Machine

1. preflight checks
2. bridge launch + readiness probe
3. backend launch + readiness probe
4. worker warmup (`ping` / `discover`)
5. UI ready

Classified startup failures:

- `missing_dependency`
- `port_conflict`
- `readiness_timeout`
- `worker_start_failure`

## Diagnostics

Launcher exposes a diagnostics summary including:

- startup phase + issues,
- worker heartbeat/status,
- process supervisor state,
- redacted environment snapshot,
- latest failed run summary.

Use `Copy Diagnostics` from launcher UI when triaging failures.
