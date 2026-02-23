---
summary: "Entry point for launcher testing docs; links operator usage and developer contract references."
read_when:
  - You need the quickest route to launcher testing docs
  - You are unsure whether you need runtime contract details or day-to-day usage steps
  - You are onboarding to launcher test orchestration
title: "Launcher Test Orchestration"
---

# Launcher Test Orchestration

This topic was split into focused guides to keep maintenance and scanning fast.

## Read This Next

- Operator Guide: `docs/help/launcher-test-operator-guide.md`
  - Running tests, follow/playback behavior, filters, run history, troubleshooting, validation checks.
- Developer Contract: `docs/help/launcher-test-developer-contract.md`
  - Architecture, manifest/protocol contracts, runtime guarantees, API table, and integration invariants.

## Quick Summary

- Launcher orchestration is manifest-driven and dependency-aware.
- Tests and Graph now share global filter context (including aggregate scope).
- Graph follow/playback and artifact replay behavior are isolated and deterministic.
- Graph bottom playback controls are artifact-replay scoped (shown only while replaying a loaded artifact run).
- Loading an artifact run from Run History auto-enables run scoping and resets stale scoped graph overlays before replay.
- Selecting a child test node (including from suite inline aggregate expansion) now drives the right details pane to child/node context instead of staying pinned to aggregate context.
- In suite inline mode, aggregate selection behavior is preserved while child clicks can still switch the details pane to node context.
- Details inspector now distinguishes aggregate-vs-node intent: aggregate summary uses progress/health dashboard emphasis, while node summary prioritizes runtime diagnostic state and dependency blockers.
- Run History now participates in page layout (no overlap over inspector), and can be minimized to a single bottom bar then reopened.
- Graph left rail (pan/search/settings) was removed; graph search now lives in the top context pill alongside aggregate filtering.
- Details pane runtime fields now normalize artifact IDs (scoped child IDs vs raw child IDs), so attempt/duration resolve correctly from replay artifacts.
- Partial artifact replays are child-run scoped: if a loaded run selected only part of an aggregate workflow, graph replay shows that selected child chain instead of all aggregate children.
- Graph layout now supports independent X/Y origin padding; suite scope uses a tighter origin (left/up) so absolute node placement starts closer to the visible canvas origin.
- Details rendering is now explicitly split between aggregate and child/test contexts (`AggregateDetailsPane` and `NodeDetailsPane`) while staying in the same Summary tab.
- Worker/runtime paths are hardened for spawn, output parsing, and long-running stability.
- Run artifacts now include a dependency analysis block (`results.json.dependency_analysis`) that compares planned DAG edges to observed execution ordering from `events.ndjson`, including drift flags (`missing_planned_edges`, `unexpected_observed_edges`, and nodes started before planned deps were ready).
- Details pane Summary now surfaces dependency drift directly for both aggregate and node contexts (counts plus node-level unsatisfied planned deps at start when present).
- SalesNav workflow DAG steps can now be loaded from `config/launcher_workflow_steps.v1.json` and executed via `Run Selected` as dependency-closed step plans.
- Workflow step nodes now emit structured node artifacts (`inputs`, `tool_call`, `tool_response`, `outputs`, `normalized_output_hash`, `artifacts`) that are persisted into run results and shown in node details.
- Wave-1 SalesNav gold flow is represented as workflow child nodes under `Python: salesnav core`; selecting a downstream workflow child and clicking `Run Selected` executes its prerequisites sequentially.

## Full Change History

For detailed historical evolution, use git history:

- `git log -- docs/help/launcher-test-orchestration.md`
- `git log -- docs/help/launcher-test-operator-guide.md`
- `git log -- docs/help/launcher-test-developer-contract.md`
