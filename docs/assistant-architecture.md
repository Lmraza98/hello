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
  3. RecipeRouter.match(message) ──────────── NEW
     │  ├─ skill matched → execute deterministic plan
     │  │   ├─ extract params (LLM for extraction only)
     │  │   ├─ execute tool calls (with confirmation gates)
     │  │   └─ synthesize response
     │  └─ no match → fall through
  4. Session coreference resolution
  5. Task decomposition (multi-step)
  6. Model fast path (runToolPlan)
  7. Task creation gate (param collection)
  8. ReAct loop / fallback pipeline
  9. Synthesis + grounding
```

## Skill Definition Format

Each skill is a directory under `skills/bdr/` containing:

- `SKILL.md` — YAML frontmatter with metadata + markdown body with the
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

The skill system is feature-flagged via `VITE_ENABLE_SKILL_ROUTER`.  When
enabled, `RecipeRouter.match()` runs before the existing LLM planner.  When
disabled, the existing pipeline is untouched.  This allows incremental rollout:

1. Start with `campaign-create-and-enroll` skill only
2. Add more skills as confidence grows
3. Eventually make skill-first the default
