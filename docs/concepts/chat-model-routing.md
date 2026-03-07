---
summary: "How chat model routing and fallback work, including OpenAI fallback controls."
read_when:
  - You are debugging why a chat request used a specific model
  - You need to enforce local-only model execution
title: "Chat Model Routing"
---

# Chat Model Routing

## Routing Layers

- `ui/src/chat/router.ts` decides initial route (`qwen3`, `deepseek`, `gemma`, optionally `openai`).
- `ui/src/chat/chatEngine.ts` applies runtime routing overrides (for example Ollama availability checks).
- `ui/src/chat/fallbackPipeline.ts` executes fallback chains.

### Conversational Guardrails

- Conversational requests (for example `hello`) should short-circuit before tool planning.
- This short-circuit now applies even when confirmation mode is enabled for tool plans, so confirmation UX does not hijack pure conversational turns.
- Intent classification includes a deterministic greeting guard to avoid planner fallback on basic openers if classifier model output is noisy.

## OpenAI Controls

OpenAI path is disabled by default.

- `NEXT_PUBLIC_CHAT_ENABLE_OPENAI_ROUTE=false`
  - Prevents normal routing decisions from selecting `openai`.
- `NEXT_PUBLIC_CHAT_ALLOW_OPENAI_FALLBACK=false`
  - Prevents fallback chain from ending in OpenAI when local routes fail.

When both are false, assistant behavior is local-first and local-only.

## Runtime Model Picker (Chat + Planner)

The chat composer now exposes two model selectors near the input:

- `Chat`: overrides the conversational/fallback response model used by local chat generation.
- `Planner`: overrides the tool-planner model route to a local (`ollama`/OpenAI-compatible local) model.

Both selectors default to `Auto`, which keeps existing routing behavior unchanged.

Picker contents include:
- all models reported by the configured local runtime endpoint (`/api/tags` for Ollama or `/v1/models` for OpenAI-compatible local servers),
- configured model ids from env (including `NEXT_PUBLIC_OLLAMA_*_MODEL` entries such as Qwen/Gemma/DeepSeek/tool-brain variants, plus hosted planner/chat ids where applicable).

Provider safety guard: local model overrides are only applied on local routes, and OpenAI overrides are only applied on OpenAI routes. A local model id will not be forwarded to OpenAI fallback calls.

### Local-Only Exhaustion Behavior

When `NEXT_PUBLIC_CHAT_ALLOW_OPENAI_FALLBACK=false` and local routes are unavailable/exhausted, `ui/src/chat/fallbackPipeline.ts` now returns a deterministic offline-safe reply instead of a hard failure string.

### Local Runtime Availability Check

Local runtime readiness now treats the runtime as available when **any** local model is reachable from the configured local endpoint, not only when preferred model names are present. This avoids false `ollama_unavailable_*` routing when using custom model names (including llama.cpp/OpenAI-compatible servers).

- Greeting inputs (for example `hello`) return a normal greeting plus limited-mode notice.
- Capability/help prompts return a limited-mode capability response.
- Other prompts return a clear "limited mode" instruction with recovery steps (`Start Ollama` or enable OpenAI fallback).

## Backend Chat Default Model

`/api/chat/completions` default model is resolved in order:

1. `CHAT_DEFAULT_MODEL`
2. `LLM_MODEL_SMART`
3. `LLM_MODEL`
4. `gpt-4o-mini`

`gpt-4o` is no longer hardcoded as backend default.

`/api/chat/completions` now only sends `tool_choice='auto'` when request `tools` are provided. This keeps plain planner/chat calls (no tool schema) compatible with OpenAI/OpenRouter validation rules.

## Tool Planner Backend Notes (FunctionGemma)

Tool planning is separate from chat routing. When `PLANNER_BACKEND=functiongemma`, the UI uses a lightweight tool-calling model for planning.

### Tiered Prompt System

The planner classifies queries into three tiers (`minimal`, `standard`, `full`) and scales both the system prompt and the visible tool set accordingly. Simple lookups get ~100 tokens of prompt and 3-8 tools; complex browser workflows get the full 3000+ token prompt with all tools.

This is the primary mechanism that makes FunctionGemma viable as a planner backend â€” it can produce correct tool calls for `minimal` tier queries in 1-2 seconds.

See [Tool planner tiering](/concepts/tool-planner-tiering) for the full architecture, including:
- Tier classification rules
- Tool preselection logic
- Tier-gated fallback chains
- Non-blocking filter context prefetch

### Live Browser Rule

If the user explicitly requests live browser work (examples: "on SalesNav", "on Sales Navigator", "on LinkedIn", provides a URL, or asks to navigate/click/type/screenshot), the query is classified as `full` tier and the planner routes to LeadPilot-style browser primitives (`browser_*`). It must not use local database tools like `search_contacts`, `search_companies`, `hybrid_search`, or `resolve_entity` for that request.

Expected plan shape for SalesNav interactive work:
`browser_health` -> `browser_tabs` -> `browser_navigate` -> `browser_snapshot` -> `browser_find_ref` -> `browser_act` -> `browser_wait` -> `browser_snapshot`.

### Compound Workflow Routing

For very complex browser requests (multi-entity + recency verification + batch constraints), planner complexity detection can mark the request as `compound_workflow_required`.

When that happens:

- planner prefers `compound_workflow_run` over shallow single-call plans
- top-level planner output `compound_workflow` is auto-normalized into a `compound_workflow_run` tool call
- backend orchestration runs asynchronously with status polling/checkpoint resume (`/api/compound_workflow/*`)

## Entity Disambiguation

When a conversation has multiple recent entities (company/contact/campaign/email thread), the UI may ask:
"I found multiple entities in this conversation. Which one should I use?"

This prompt is only triggered by **coreference ambiguity** (for example: "email them", "use that campaign", "mark this company vetted") when there is no clear active entity to apply the request to. Planner failures/timeouts do not trigger entity disambiguation; they fall back to retrieval instead.

