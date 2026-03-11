---
summary: "Multi-step orchestration in the chat engine without adding latency to single-step traffic."
read_when:
  - You are changing how the chat engine handles multi-step requests
  - You are debugging why a request was split into steps (or not split)
title: "Task Decomposition"
---

## Goal

Support multi-step user requests ("do X, then Y, then Z") by decomposing into steps and executing them in order, while keeping the common case (single-step) on the existing fast path with no extra planner call.

## Where It Lives

- Decomposition seam: `ui/src/chat/chatEngine.ts`
  - After coreference normalization (`resolveSessionCoreference`)
  - Before the browser follow-up override logic
- Decomposer backend: `ui/src/chat/models/toolPlanner.ts`
  - `runTaskDecomposition(...)`
- UI confirmation/resume: `ui/src/hooks/useChat.ts`
  - Stores `pendingTaskPlan` and passes it back on confirm

## Triggering

Decomposition is gated by a three-way intent classifier (`classifyIntent`):

1. **Regex fast path (zero cost)**: explicit markers (`then`, `and then`, `based on`, `next`, semicolons, numbered lists) immediately classify as `multi`.
2. **LLM classifier (~200-800ms)**: for everything else, a cheap model call (`DECOMPOSE_CLASSIFIER_MODEL`, defaults to functiongemma) classifies the query as `conversational`, `single`, or `multi` with `temperature: 0`.
   - If the classifier returns invalid output (for example JSON tool calls), the system retries with the conversation model to avoid misrouting.
   - Queries asking for a *current* value (views count, weather, prices, "what's on the page right now") should classify as `single` so the system can browse / use tools instead of answering from memory.

This catches implicit multi-step queries the regex misses (e.g., "find Lucas Raza and enroll him in campaign 5") while adding negligible latency for simple queries.

On any classifier error, the system falls through to `single` (never blocks).

## Decomposition Output

The decomposer returns a JSON array of:

```json
[
  {"id":"s1","intent":"Search Zco Corporation on Sales Navigator","dependsOn":[]},
  {"id":"s2","intent":"List employees for Zco Corporation on Sales Navigator","dependsOn":["s1"]}
]
```

If the decomposer fails or returns empty, we fall back to a cheap heuristic split.

## Execution

`executeTaskPlan(...)` loops steps and executes each one by calling `handleToolRoute(...)` (the existing tool/agent path).

- Step context is injected as a small \"previous steps\" block (grounding only).
- Browser follow-up logic is applied per-step when there is an open browser session.
- If a step needs confirmation, execution pauses and returns:
  - `confirmation.pendingTaskPlan` (steps + cursor + context snippets)

## Resume After Confirmation

When the user confirms, the UI calls `processMessage(..., phase='executing')` with:

- `confirmedToolCalls`
- `pendingTaskPlan`

`processMessage(...)` executes the confirmed tool calls, advances the task cursor, and continues remaining steps without polluting chat history with internal step messages.

## Relationship to Tool Planner Tiering

Task decomposition runs before tool planning. The decomposer itself is unaffected by query tiers - it always uses a lightweight system prompt. However, when decomposed steps are executed individually, each step goes through `runToolPlan()` where the [tiered prompt system](/concepts/tool-planner-tiering) applies. Simple steps get `minimal` tier prompts; browser steps get `full` tier prompts.

## Compound Workflows vs Decomposition

A separate orchestration path now exists for high-complexity browser requests:

- Planner can emit `compound_workflow_run` (or top-level `compound_workflow`, which is normalized into `compound_workflow_run`).
- These execute in backend background workers (`services/orchestration/compound/orchestrator.py`) with checkpoint/resume and status polling.

Use decomposition for conversational multi-step actions in chat. Use compound workflows when the task itself is a long, phased browser workflow with iteration and verification across many entities.

## Config

- `NEXT_PUBLIC_TASK_DECOMPOSITION_TIMEOUT_MS` (default `4500`)
  - Hard timeout for the decomposer planner call.
- `NEXT_PUBLIC_DECOMPOSE_CLASSIFIER_MODEL`
  - Model used for the cheap intent classifier. Defaults to `NEXT_PUBLIC_OLLAMA_FUNCTIONGEMMA_MODEL`, then `TOOL_BRAIN_MODEL`.

