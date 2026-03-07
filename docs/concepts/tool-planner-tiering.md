---
summary: "Tiered prompt and tool preselection system for the chat tool planner, reducing latency from ~12s to ~2-4s for simple queries."
read_when:
  - You are debugging why tool planning is slow or fast for a given query
  - You are changing how tool plans are generated or which tools the planner sees
  - You want to understand the minimal/standard/full prompt tiers
  - You are evaluating FunctionGemma or other lightweight models for planning
title: "Tool Planner Tiering"
---

# Tool Planner Tiering

## Problem

The tool planner in `ui/src/chat/models/toolPlanner.ts` sends a system prompt to a local LLM on every user message. Before tiering, this prompt was 3000+ tokens regardless of query complexity:

- `commonPromptPreamble` (~800 tokens): browser rules, SalesNav URL patterns, navigation loops
- `fullPlannerExtras` (~1200 tokens): domain rules, chaining syntax, canonical examples
- `schemaBlock` (all tools): ~600 tokens for 21+ tool schemas
- `examplesBlock`: ~400 tokens of tool-specific examples
- `filterContextBlock`: ~200 tokens of cached filter values
- `PLANNER_TOOL_USAGE_RULES`: ~300 tokens of usage constraints
- 8 conversation history messages

For a simple query like "find Lucas Raza", 90% of this prompt is irrelevant. The model processes the entire browser automation playbook before outputting a single `hybrid_search` call.

## Solution: Three Tiers

The planner now classifies each user message into a tier and builds a proportionally-sized prompt.

### Tier Classification (`classifyQueryTier`)

| Tier | Triggers | Prompt Size |
|------|----------|-------------|
| `minimal` | Simple lookups ("find Lucas Raza"), short queries (<=4 words) | ~100-200 tokens |
| `standard` | Multi-constraint filters, campaign ops, chained reads â€” anything without browser/URL intent | ~400-600 tokens |
| `full` | Browser automation, SalesNav, URLs, comparative queries ("find companies like X"), `task=` workflows | Original size (~3000+ tokens) |

Classification logic in `classifyQueryTier()`:

- **full**: URL present, `task=` prefix, comparative language, interactive browser words (`click`, `navigate`, `snapshot`, etc.), bare SalesNav mention without clear collection intent
- **standard**: SalesNav/LinkedIn **collection** queries ("find companies on Sales Navigator", "search SalesNav for leads"), moderate multi-constraint queries
- **minimal**: simple lookup verbs + <=8 words + no conjunctions; or <=4 words without mutation intent

### SalesNav: Collection vs. Interactive

SalesNav mentions are split by intent:

| Pattern | Tier | Why |
|---------|------|-----|
| "find construction companies on Sales Navigator" | `standard` | Collection â€” maps to `collect_companies_from_salesnav`, a single API call |
| "search SalesNav for tech companies in Boston" | `standard` | Collection â€” same tool |
| "go to Sales Navigator and click on accounts" | `full` | Interactive browser â€” needs `browser_*` tools and the full prompt |
| "open linkedin.com/sales/search/company" | `full` | URL present â€” interactive browsing |
| "find Lucas Raza on SalesNav" (with "click"/"navigate") | `full` | Interactive browser words detected |

### Quick Mode Interaction

`quick` mode (from `options.quick`) requests speed but does not override intent signals.

- It does **not** change the tier returned by `classifyQueryTier`.
- It reduces conversation history included in the planner prompt:
  - `standard`: 2 turns (instead of 4)
  - `full`: 6 turns (instead of 8)

### Tiered Prompt Content

**Minimal** (for FunctionGemma or fast local models):
```
Output ONLY JSON array: [{"name":"tool_name","args":{...}}]
No prose. No markdown. No explanation.
Preserve exact spelling from user message.
Return minimal plan: 1-2 calls.
Tools:
<schema for 3-8 preselected tools>
```

**Standard** (most queries):
```
You are an agentic tool planner.
<core rules: JSON output, name preservation, minimal plan, merged args>
<2 canonical examples>
Tools:
<schema for preselected tools>
```

**Full** (browser automation, complex workflows):
```
<original commonPromptPreamble>
<fullPlannerExtras with PLANNER_TOOL_USAGE_RULES, examples, filter context>
Tools:
<schema for all relevant tools>
```

## Tool Preselection (`preselectToolNames`)

Before tiering, the planner exposed 21+ tools in every schema block. The model had to read `browser_navigate`, `collect_companies_from_salesnav`, `enroll_contacts_in_campaign`, etc. even for "find Lucas Raza."

Now, for `minimal` and `standard` tiers, `preselectToolNames()` narrows the tool set to ~2-12 candidates using lightweight keyword matching:

Implementation note:
- Tool tiering + preselection are computed from the userâ€™s *intent text* only. Injected context blocks like `[SESSION_ENTITIES]...` and `[BROWSER_SESSION]...` are stripped before running heuristics, but still included in the message sent to the model. This prevents â€œcontext contaminationâ€ (e.g., stale entity names pushing the planner toward campaign/CRM tools when the user asked for SalesNav browsing).

| User says | Tools selected |
|-----------|---------------|
| "find Lucas Raza" | `hybrid_search`, `resolve_entity`, `search_contacts`, `get_contact` |
| "show construction companies" | `hybrid_search`, `resolve_entity`, `search_companies`, `research_company`, `assess_icp_fit`, ... |
| "list campaigns" | `hybrid_search`, `resolve_entity`, `list_campaigns`, `get_campaign`, ... |

The `full` tier bypasses preselection and uses the original broad tool set (still filtered by `shouldAllowBrowserTools`).

Fewer tools = shorter schema block = faster inference = more accurate tool selection.

### ReAct Loop Tool Selection

The ReAct loop (`ui/src/chat/reactLoop.ts`) uses the same tool-selection logic as the planner (`selectToolNamesForMessage`) so it does not start iterations with the full tool catalog (70+ tools). This keeps iteration prompts smaller and avoids planner timeouts caused by oversized schema blocks.

## Tier-Gated Fallback Chain

Before tiering, a failed plan could trigger up to 4 serial LLM calls (60 seconds worst case):

```
runToolPlan (attempt 1, 15s timeout)
  -> strict JSON retry (15s timeout)
    -> repair attempt (15s timeout)
      -> runAuxPlannerFallback (separate model call)
```

Now the fallback depth depends on tier:

| Tier | On failure |
|------|-----------|
| `minimal` | Immediate fail. One shot only. Let ReAct loop or fallback pipeline handle it. |
| `standard` | One aux planner fallback attempt. No serial retry chain. |
| `full` | Original retry -> repair -> aux chain (preserved for complex queries). |

Note: quick mode does **not** change tier selection. A "find companies on Sales Navigator" **collection** query stays `standard` tier (planning via `collect_companies_from_salesnav`). A SalesNav **interactive** query (click/navigate/screenshot, or a URL) stays `full` tier.

## Non-Blocking Filter Context

Previously, `buildFilterContextBlock()` made three API calls (`/api/companies`, `/api/contacts`, `/api/emails/campaigns`) on every plan â€” blocking the planning path even with a 60s cache.

Now:

- `refreshFilterContextCache()` is the async fetch + cache update.
- `getFilterContextBlock()` is a synchronous cache read â€” never blocks.
- `startFilterContextPrefetch()` runs a background timer every 45 seconds to keep the cache warm.
- `prewarmToolPlannerContext()` (called from `ChatProvider` on mount) triggers the first fetch and starts the timer.
- `stopFilterContextPrefetch()` is called on `ChatProvider` unmount for cleanup.

Filter context is only included in `full` tier prompts.

## Coverage Audit Gating

The optional `ENABLE_PLAN_COVERAGE_AUDIT` feature (an extra LLM call to check plan coverage) now only runs for `full` tier queries where the validation is worth the latency.

## Config

| Variable | Default | Purpose |
|----------|---------|---------|
| `NEXT_PUBLIC_TOOL_PLANNER_TIMEOUT_MS` | `15000` | Per-attempt timeout for planner LLM calls |
| `NEXT_PUBLIC_PLAN_COVERAGE_AUDIT` | `false` | Enable coverage audit (full tier only) |
| `NEXT_PUBLIC_ENABLE_AUX_PLANNER_FALLBACK` | `true` | Enable aux planner fallback (standard/full tiers) |

## Complexity-Based Model Routing

Planner model routing now runs in addition to prompt tiering:

- Simple queries stay on local Gemma (`ollama`) for speed.
- Complex queries (browser orchestration, compound constraints, batch intents, long multi-step text) route to stronger hosted models.
- Parse failure on Gemma triggers model upgrade retry (to complex model) before normal fallback chain.
- Task decomposition always uses the decomposition model route.
- Fast-path quick mode is disabled for complex requests (`quick=false`) so the planner can return richer multi-call plans.
- Generic retrieval bootstrap (`hybrid_search`) is skipped for complex requests to avoid collapsing nuanced constraints into a single shallow read call.
- If hosted planner calls fail (`openai` / `openrouter`), planner now retries once on local Ollama before using auxiliary fallback.
- Planner error events include backend detail strings from `/api/chat/completions` for easier root-cause debugging.
- When local retry succeeds, that recovered plan is kept (aux fallback is skipped).
- LinkedIn requests with recency/behavior constraints (for example "posted in last 6 months", "publicly expressed interest") are promoted to `full` tier and repaired if they lack browser-based verification calls.
- If repair still fails to add browser verification for LinkedIn recency constraints, planner injects a deterministic Sales Navigator browser fallback (`browser_search_and_extract`) instead of executing `hybrid_search` alone.

Routing is controlled by `ui/src/config/plannerConfig.ts`:

- `DEFAULT_MODEL_CONFIG` uses `gemma` for simple and `gpt-4o-mini` for complex/decomposition.
- `PREMIUM_MODEL_CONFIG` uses `gpt-4o` for complex/decomposition.
- `NEXT_PUBLIC_PLANNER_MODEL_PROFILE=default|premium` selects the profile.
- Optional overrides:
  - `NEXT_PUBLIC_PLANNER_SIMPLE_MODEL_PROFILE`
  - `NEXT_PUBLIC_PLANNER_COMPLEX_MODEL_PROFILE`
  - `NEXT_PUBLIC_PLANNER_DECOMPOSITION_MODEL_PROFILE`

## Where It Lives

- Tier classifier: `classifyQueryTier()` in `ui/src/chat/models/toolPlanner.ts`
- Tool preselection: `preselectToolNames()` in `ui/src/chat/models/toolPlanner.ts`
- Prompt builder: `buildTieredSystemPrompt()` in `ui/src/chat/models/toolPlanner.ts`
- Background prefetch: `startFilterContextPrefetch()` / `stopFilterContextPrefetch()` in `ui/src/chat/models/toolPlanner.ts`
- Prefetch lifecycle: `ui/src/contexts/ChatProvider.tsx`

## Impact on FunctionGemma

The `minimal` tier is specifically designed to make FunctionGemma viable as a planner backend. With 3-8 tools and ~100 tokens of system prompt, FunctionGemma can produce correct tool calls in 1-2 seconds instead of timing out on the full 3000+ token prompt.

Tool preselection is intended to stay broad enough to include common write intents (for example campaign creation/enrollment and note creation). This prevents short follow-ups like "yes, write to a note" from accidentally hiding the required write tool from the planner.

See [FunctionGemma fine-tune workflow](/FUNCTIONGEMMA_FINETUNE) for the training pipeline.

## Confirmation Policy (Destructive Only)

Planner confirmation is now gated by destructive intent, not by plan existence:

- Non-destructive `ui_actions` (for example `contacts.navigate`, `email.campaigns.navigate`) execute without confirmation.
- Non-destructive read/search tool calls execute without confirmation.
- Confirmation is required only when the planned set includes at least one destructive operation:
  - capability action marked `destructive: true`
  - tool call in the destructive tool allowlist (for example delete/send/reset operations)

This applies to both fast-path planning and ReAct pending-confirmation flows.

