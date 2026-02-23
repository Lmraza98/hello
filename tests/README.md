# Test Layout

This test tree is organized by **layer first**, then domain.
Use this file as the canonical placement guide for future changes.

## Directory Contract

- `tests/api_routes/`
  - Route/API contract tests only.
  - Focus: request/response shape, status codes, route-level error handling, task lifecycle endpoints.
  - Pattern: direct imports from `api.routes.*` are expected here.
  - Domain subfolders are encouraged (for example `tests/api_routes/browser/`).

- `tests/browser/`
  - Browser domain logic tests, not API transport contract.
  - Focus: policies, skills, internal workflow logic, challenge handling, extraction behavior.
  - If a test mainly validates route handlers, move it to `tests/api_routes/`.

- `tests/workflow_core/`
  - Core workflow/business logic without route contract assertions.
  - Example: compound workflows, deterministic workflow helpers.

- `tests/salesnav/`
  - Sales Navigator domain behavior (query builder, filters, collection flow, schema compatibility).

- `tests/launcher/`
  - Launcher runtime/protocol/planner/integration/UI-contract tests.

- `tests/platform/`
  - Cross-cutting platform/system behaviors.

## Placement Rules

- Place by **primary assertion target**:
  - If asserting API route contract, use `tests/api_routes/...`.
  - If asserting internal logic, use domain folder (`browser`, `workflow_core`, etc.).
- Avoid mixing transport and business logic assertions in the same file.
- Keep one primary layer per test file.

## Naming Rules

- All files must remain pytest-discoverable: `test_*.py`.
- Prefer explicit suffixes when helpful:
  - `*_api_routes.py` for route-contract tests.
  - `*_workflow.py` for core workflow logic tests.
- Keep names stable and descriptive; avoid generic names like `test_misc.py`.

## Refactor Checklist (for humans and agents)

1. Move files to the correct layer/domain directory.
2. Fix any path-relative imports (`Path(__file__).resolve().parents[...]`) after move.
3. Keep route tests under `tests/api_routes/` when they import `api.routes.*`.
4. Run:
   - `python -m pytest --collect-only -q tests`
5. If behavior/testing contract changed, update this file in the same change set.

## Current Browser Split (Intentional)

- `tests/api_routes/browser/`:
  - API contract tests for browser endpoints.
  - Example files:
    - `test_browser_nav_api_routes.py`
    - `test_browser_workflow_async_api_routes.py`
    - `../test_browser_workflow_builder_api_routes.py`

- `tests/browser/`:
  - Browser internals and domain logic tests.
  - Example files:
    - `test_browser_policy.py`
    - `test_browser_workflow_builder.py`
    - `test_challenge_resolver.py`
