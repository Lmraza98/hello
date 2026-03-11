---
summary: "Skill-first assistant architecture (deterministic skills first, LLM planner as fallback)."
read_when:
  - You are modifying the assistant-core skill router or its handlers
  - You are debugging why a message was handled by a skill vs the LLM planner
title: "Assistant Architecture"
---

# Assistant Architecture

## Overview

The BDR CRM assistant uses a **skill-first** architecture: common workflows are
handled by deterministic skill routines (recipes) that bypass LLM planning
entirely.  The LLM planner (ReAct) is the fallback for the long tail of
requests that don't match any known skill.

## Service Modules

```
ui/src/assistant-core/
  domain/types.ts        Core domain types (Intent, Skill, Plan, ToolCall, etc.)
  skills/
    types.ts             Skill definition types + SKILL.md frontmatter schema
    loader.ts            Parses SKILL.md files, builds the skill registry
    matcher.ts           Matches user messages to skills via trigger patterns
    registry.ts          In-memory skill registry (singleton)
  router/
    recipeRouter.ts      Deterministic routing for matched skills
  index.ts               Public API re-exports

skills/bdr/              Repo-root skill definitions (SKILL.md + handler.ts)
  campaign-create-and-enroll/
  reply-triage/
  account-research-and-icp/
  salesnav-search-and-collect/
```

## Message Flow

```
processMessage(userMessage)
  1. classifyIntent (conversational | single | multi)
  2. Active task routing (if task in progress)
  3. RecipeRouter.match(message) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ NEW
     â”‚  â”œâ”€ skill matched â†’ execute deterministic plan
     â”‚  â”‚   â”œâ”€ extract params (LLM for extraction only)
     â”‚  â”‚   â”œâ”€ execute tool calls (with confirmation gates)
     â”‚  â”‚   â””â”€ synthesize response
     â”‚  â””â”€ no match â†’ fall through
  4. Session coreference resolution
  5. Task decomposition (multi-step)
  6. Model fast path (runToolPlan)
  7. Task creation gate (param collection)
  8. ReAct loop / fallback pipeline
  9. Synthesis + grounding
```

## UI Guidance Overlay

The assistant can guide users through existing UI without creating new panels or
rearranging layout. Guidance is driven by app actions, not custom floating UI.

- UI elements opt in with `data-assistant-id="<stable-id>"`.
- Assistant responses can emit fenced JSON actions such as
  `assistant_guide` and `assistant_guide_clear`.
- `AssistantGuideProvider` holds active guidance state
  (`activeStep`, `highlightedElementId`, `scrollTargetId`).
- `AssistantHighlightLayer` locates the live DOM node, scrolls it into view if
  needed, dims the rest of the application, and draws the highlight/glow box.
- Guidance actions can request click-style motion to demonstrate a click without
  activating it; real auto-click is reserved for cases where the user explicitly
  wants the assistant to perform the action.
- For walkthrough click steps, the target itself can pulse more aggressively so
  the user’s eye is drawn to the real control without relying on a separate
  cursor animation layer.
- Guidance cadence is staged: the dock expansion settles first, the highlight
  becomes visible, and only then does the stronger click-style pulse begin.
- The dock glass cutout is delayed until after the dock expansion begins so the
  chat does not open with the cutout already present.
- That staging happens when guidance starts, not on every subsequent guided
  target, so the overlay stays visually continuous through a multi-step
  sequence.
- Guidance also carries an explicit pointer mode: `passthrough` for live
  click-through targets under the overlay, and `interactive` for form/panel
  guidance where the chat body must stay scrollable.
- After the user or assistant opens the next UI surface, the highlight layer
  can hand off to the next assistant-registered focused field so guidance stays
  with the live form instead of lingering on the launch button.
- Form containers can register a panel id so focus inside the form promotes the
  highlight to the whole panel instead of a single input.
- The chat dock stays usable and switches into a glass bottom-overlay treatment
  while guidance is active.
- When a highlighted target overlaps the dock footprint, the glass layer cuts a
  local clear window around that target so the underlying control remains sharp.
- That clear window is also treated as a live no-content zone inside the dock so
  chat bubbles avoid rendering behind the transparent area, typically by
  introducing a local right-side exclusion zone so the scrollable message flow
  can use full width above the target and wrap left only where the panel
  overlaps.
- The glass layer sits beneath chat content inside the dock, so bubbles and
  input controls remain crisp while the surrounding dock surface keeps the glass
  treatment.
- The global page dimmer excludes the assistant dock footprint, so guidance
  darkens the workspace without muting the chat content itself.
- Dock height measurement is diffed and callback-stabilized so guidance-mode
  resizing does not self-trigger render loops through parent layout state.
- Dock guidance geometry resets are also idempotent, so inactive/no-target
  overlay states do not keep writing the same null geometry back into React
  state on every render.
- Chat session tabs restore transcript history per session, but in-progress
  assistant typing/streaming UI does not auto-resume on tab return.
- Assistant UI targeting is session-native runtime state: the active chat tab
  selects which target/highlight state is rendered, rather than restoring
  overlays by replaying prior assistant messages.
- The chat runtime also keeps durable per-session orchestration state in memory
  while the app is open, so returning to a session restores its active
  workflow/task context and current UI flow step without remounting the whole
  chat engine.
- Multi-step UI orchestration now has a durable flow contract:
  `assistant_ui_start_flow`. The first built-in flow is `create_contact`,
  which advances from `new-contact-button` to `contact-create-panel` based on
  live user interaction instead of replaying old chat history.
- Hydrated bot history is not re-run through the assistant action parser on
  session return, preventing old guide steps from replaying when a tab is
  reopened.
- The preferred action contract for single-target UI orchestration is
  `assistant_ui_set_target` / `assistant_ui_clear`. For durable multi-step UI
  flows, prefer `assistant_ui_start_flow`. Legacy `assistant_guide` /
  `assistant_guide_clear` actions are still accepted as aliases while callers
  migrate.

Example assistant payload:

```json
{
  "actions": [
    {
      "type": "assistant_ui_start_flow",
      "flowId": "create_contact"
    }
  ]
}
```

## Skill Definition Format

Each skill is a directory under `skills/bdr/` containing:

- `SKILL.md` â€” YAML frontmatter with metadata + markdown body with the
  deterministic procedure
- Referenced by the skill loader at startup; the loader reads the frontmatter
  and registers the skill with its handler function.

Frontmatter fields:

```yaml
name: campaign-create-and-enroll
description: Create an email campaign and enroll contacts by industry filter
version: 1
tags: [campaign, enrollment, bulk]
trigger_patterns:
  - "create campaign"
  - "new campaign"
  - "and add contacts"
  - "and enroll"
  - "targeting {industry}"
allowed_tools:
  - create_campaign
  - enroll_contacts_by_filter
  - list_campaigns
  - get_campaign
  - list_filter_values
extract_fields:
  - name: industry
    description: Industry/vertical keyword for contact filter
    required: true
  - name: campaign_name
    description: Campaign name (defaults to "<Industry> Outreach")
    required: false
confirmation_policy: ask_writes
```

## Confirmation Policy

- `ask_writes`: Require confirmation for write operations (create, enroll,
  send, delete).  Read operations execute immediately.
- `ask_every`: Require confirmation for every tool call.
- `auto`: No confirmation required.

## Migration Strategy

The skill system is feature-flagged via `NEXT_PUBLIC_ENABLE_SKILL_ROUTER`.  When
enabled, `RecipeRouter.match()` runs before the existing LLM planner.  When
disabled, the existing pipeline is untouched.  This allows incremental rollout:

1. Start with `campaign-create-and-enroll` skill only
2. Add more skills as confidence grows
3. Eventually make skill-first the default

