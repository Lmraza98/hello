---
summary: "Roadmap for a human-in-the-loop workflow builder that learns durable browser skills from deterministic evidence."
read_when:
  - You are implementing or extending browser skill auto-learning
  - You need the canonical plan for observation, validation, annotation, and repair
  - You are designing cross-site extraction reliability guardrails
title: "Workflow Builder Plan"
---

# Workflow Builder Plan

This document cements the implementation plan for a human-in-the-loop workflow builder where:

- LLMs propose candidates.
- Deterministic engines validate and score.
- Users annotate/correct.
- The system persists versioned skills with repair history.

## Goals

- Make browser workflow authoring robust across changing websites.
- Minimize brittle CSS/XPath dependence.
- Keep safety boundaries explicit (read-only defaults, action allowlists, no secret leakage).
- Turn every failure into a recoverable repair event.

## Core Architectural Shift

Use this loop:

1. LLM proposes intent-level candidates.
2. User labels ground truth (positive and negative examples).
3. Deterministic selector synthesis produces executable selectors.
4. Deterministic validator enforces invariants and computes fit score.
5. LLM is used for ranking/backups, not sole selector generation.

This replaces a brittle “LLM generates selectors -> run” pattern.

## End-to-End Loop

## 0) Preflight (Deterministic)

- Classify page mode: `list_page`, `detail_page`, `search_form`, `login_wall`, `consent_modal`, `blocked`.
- Prefer data source order:
  1. `network_json`
  2. `structured_markup` (JSON-LD/microdata)
  3. `dom`
- Apply safety policy defaults:
  - `read_only: true`
  - allowlist action types and domains
  - refuse destructive or side-effecting actions unless explicitly enabled

Output:

- `page_mode`
- `data_source_preference`
- `policy_summary`

## 1) Observe (Deterministic, Reproducible)

Capture an Observation Pack with:

- Browser/environment:
  - canonical URL, referrer, viewport, locale/timezone, user-agent platform
- DOM/semantics:
  - cleaned DOM snapshot
  - role/AX-oriented node list
  - interactive/content node inventory with stable attributes (`role`, `name`, `aria-*`, `name`, `placeholder`, `data-*`, `href`)
- Network (optional when available):
  - request index
  - bounded JSON endpoint samples
- Visual:
  - screenshot
  - optional landmark/layout bounding boxes
- Stabilization metadata:
  - criteria used and settle status

## 2) Hypothesize (LLM-Assisted, Schema-Constrained)

LLM input: sanitized Observation Pack only.

LLM output (strict schema):

- `workflow_candidates[]` (navigate/type/click/wait/paginate)
- `extractor_candidates[]` (container + fields + post-processing)
- `data_source_plan`
- `fallbacks` (ordered selector strategies)
- `risks` (explicit brittleness concerns)

Constraints:

- No direct execution from rationale text.
- Penalize deep selectors by default.
- Require confidence per candidate.

## 3) Verify + Score (Deterministic)

For each candidate:

- Selector checks:
  - match counts and uniqueness
  - required field completeness
  - URL validity/domain constraints
  - type checks (number/date/url/string)
- Workflow checks:
  - step success and timeout behavior
  - pagination novelty (new items appear)
  - loop detection via URL/title/signature similarity
- Stability checks:
  - re-run after refresh
  - re-run with slight viewport change
  - mutation test against canonicalized DOM signal

Compute explainable fit score components:

- `coverage`
- `completeness`
- `precision_proxy`
- `stability`
- `cost`

## 4) Annotate + Confirm (User-in-the-Loop)

Overlay labeled boxes on screenshot for matched elements.

User can:

- Mark positive result items
- Mark negative items (sidebar/promoted/noise)
- Anchor field positives/negatives
- Rename fields

Feedback is converted to deterministic constraints.

## 5) Repair + Persist

- Convert constraints into revised selector candidates.
- Re-validate with same deterministic scoring.
- Persist versioned skill + repair log entry:
  - failure reason
  - changes applied
  - before/after scores
  - timestamp

## 6) Auto-Learning via Template Matching

- Build robust fingerprint (not raw DOM hash only):
  - URL pattern shape
  - landmark/role graph summary
  - key endpoint patterns
  - coarse visual layout signature
- Match by similarity; reuse matching skill profile.
- On validation failure, trigger repair workflow and update fingerprint set.

## Skill Schema Upgrades

Current markdown skill format remains supported. Extend with these concepts:

- `match`:
  - `domains`
  - `url_patterns`
  - optional path constraints
- `policy`:
  - `read_only`
  - `allowed_domains`
  - budgets (`max_pages`, `max_clicks`, `max_time_ms`)
- `workflow`:
  - ordered typed steps (`navigate`, `type`, `click`, `wait_for`, `paginate`, `maybe_dismiss`)
- `extraction`:
  - `source_preference`
  - `item_container`
  - field selectors with prefer/fallback strategy
  - post-processing pipeline
- `validation`:
  - count/required-field/uniqueness/null-rate/domain invariants
- `fingerprints`
- `tests` (smoke/regression)
- `repair_log`

## Guardrails and Stop Reasons

Required stop reasons and logs:

- `STOP_BUDGET_EXCEEDED`
- `STOP_LOOP_DETECTED`
- `STOP_NO_NEW_ITEMS`
- `STOP_BLOCKED`
- `STOP_VALIDATION_FAILED`

Also enforce:

- duplicate suppression across pages/scroll
- polite rate limits
- explicit policy hook for compliance decisions

## Security Model

- Treat page text/DOM/network payloads as untrusted input.
- Never let page content alter trusted instructions/policies.
- Never send secrets (cookies/token values/credentials) to planner models.
- Resolve secrets only inside executor via opaque references.
- Keep per-skill action/domain allowlists.

## Model Roles

- Planner model (Qwen-class):
  - candidate workflow/extractor proposals
  - ranking and repair suggestions
- Deterministic engines:
  - selector synthesis from labeled examples
  - validation/scoring/drift detection/loop controls
- Small model (Gemma-class):
  - summarize extracted content
  - lightweight entity extraction post-capture

## Implementation Phases

## Phase 1 (Now)

- Add Observation Pack capture primitive and API.
- Add deterministic candidate validator + fit score API.
- Keep existing markdown skills fully backward-compatible.
- Improve auto-learn to use deterministic validation before save.

## Phase 2

- Add annotation artifacts (field/item bounding boxes).
- Add user feedback contract for positive/negative labels.
- Add deterministic selector synthesis from labels.

Status update:

- Initial backend slice implemented:
  - `POST /api/browser/workflows/annotate-candidate`
  - `POST /api/browser/workflows/synthesize-from-feedback`

## Phase 3

- Add fingerprint matching and multi-pattern skill selection.
- Add drift monitor that auto-triggers repair loop.
- Add regression fixtures per skill.

## Phase 4

- Expand network-first extraction path where available.
- Add richer policy controls and stronger compliance hooks.
- Add quality telemetry dashboards for fit-score trends.

## Success Criteria

- New site skill bootstrap produces valid extraction in one guided loop for common list pages.
- Drift incidents are detected automatically and recover via repair flow.
- Skill quality is measurable via fit score and regression pass rates.
- Browser automation remains bounded, auditable, and safe-by-default.
