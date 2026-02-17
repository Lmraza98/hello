# Chat E2E Scenario Checklist

Purpose: validate retrieval grounding, orchestration correctness, tool determinism, and latency for the chat assistant.

## How To Use

1. Run each scenario in a clean chat session unless noted otherwise.
2. Capture:
   - total wall time to final assistant response
   - first tool selected
   - whether evidence refs were present
   - whether confirmation behavior matched policy
3. Mark pass/fail in the run log at the bottom.

## Global Pass Rules

- No factual claims from retrieval flows without evidence references.
- Read-only intents should not require confirmation.
- Write/destructive intents must require confirmation.
- No duplicate assistant completion messages.
- No repeated "already tried" loops without progress.

## Scenario 1: Grounded Identity + Action Chain

- Prompt: `Send an email to Lucas Raza using Salesforce and include his current company in the draft.`
- Expected first tool: `hybrid_search` (or `resolve_entity`).
- Expected behavior:
  - Contact is resolved locally first.
  - Evidence refs are attached for identity/company claim.
  - Then email/send planning proceeds.
- Latency target: <= 8s first grounded answer.

## Scenario 2: Ambiguous Entity Disambiguation

- Prompt: `Email Lucas at Zco, not the one at Zco Corporation.`
- Expected first tool: `hybrid_search`.
- Expected behavior:
  - Disambiguation is explicit or correctly inferred from evidence.
  - Selected record matches `Zco` only.
  - No cross-record blending.
- Latency target: <= 8s.

## Scenario 3: Multi-turn Recall Compression

- Prompt A: `What did we discuss about Outlook permissions last week?`
- Prompt B: `Now summarize only blockers and owners.`
- Expected first tool: `hybrid_search`.
- Expected behavior:
  - Uses recent relevant evidence from emails/conversations.
  - Follow-up summary is consistent with first retrieval.
  - No prompt bloat style degradation between A and B.
- Latency target: <= 10s per turn.

## Scenario 4: Zero-result Grounding Guard

- Prompt: `Who is Keven Fuertes and where else did he work?`
- Expected first tool: `hybrid_search`.
- Expected behavior:
  - If no local evidence, assistant states it cannot verify.
  - Suggests refinement or next safe tool.
  - No fabricated work history.
- Latency target: <= 6s.

## Scenario 5: Browser Follow-up Continuity

- Prompt A: `Find Zco Corporation on Sales Navigator`
- Prompt B: `Click it and tell me who works there`
- Expected first tool:
  - A: sales navigator/browser collection tool
  - B: browser follow-up toolchain
- Expected behavior:
  - Follow-up uses live browser session state.
  - Deterministic ordering in tool trace.
  - No duplicate completion line.
- Latency target: <= 15s for B (browser-dependent).

## Scenario 6: Concurrent Determinism

- Session 1 prompt: `Find Lucas Raza`
- Session 2 prompt: `Find campaigns with low reply rate`
- Run concurrently.
- Expected behavior:
  - Stable trace ordering per session.
  - No cross-talk or state leakage.
  - Results remain correct in both sessions.
- Latency target: <= 10s each.

## Scenario 7: Large Output Resilience

- Prompt: `Show all conversation threads mentioning OAuth errors from the last 90 days.`
- Expected first tool: `hybrid_search`.
- Expected behavior:
  - Prompt/history compression avoids slowdown.
  - Returned response is summarized but still evidence-backed.
  - No oversized raw dumps in final response.
- Latency target: <= 12s.

## Scenario 8: Confirmation Policy Enforcement

- Read prompt: `Find Lucas Raza`
- Write prompt: `Delete contact 2954`
- Expected behavior:
  - Read prompt executes without confirmation.
  - Delete prompt requires explicit confirmation.
  - Policy is consistent across retries.
- Latency target: <= 6s per request before any confirm.

## Scenario 9: Tool Failure Recovery

- Prompt: `Find mid-sized companies like Zco on SalesNavigator`
- Inject/observe backend failure path.
- Expected behavior:
  - Clear single failure report.
  - No retry storm.
  - Offers next step or safer fallback.
- Latency target: <= 8s.

## Scenario 10: Regression Bundle

- Use a fixed bundle of 20-30 prompts across:
  - contact lookup
  - company lookup
  - campaign reads/writes
  - email draft/send
  - browser navigation
- Expected behavior:
  - No major behavior regressions.
  - Tool selection remains stable for known prompts.
  - Grounding and confirmation rules hold.

## Suggested Metrics To Track

- `first_tool_correct_rate`
- `grounded_answer_rate`
- `confirmation_policy_accuracy`
- `duplicate_response_rate`
- `p95_latency_seconds`
- `tool_failure_recovery_rate`

## Run Log

| Date | Commit | Scenario | Pass/Fail | Latency (s) | Notes |
|------|--------|----------|-----------|-------------|-------|
|      |        | 1        |           |             |       |
|      |        | 2        |           |             |       |
|      |        | 3        |           |             |       |
|      |        | 4        |           |             |       |
|      |        | 5        |           |             |       |
|      |        | 6        |           |             |       |
|      |        | 7        |           |             |       |
|      |        | 8        |           |             |       |
|      |        | 9        |           |             |       |
|      |        | 10       |           |             |       |
