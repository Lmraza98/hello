---
summary: "Top-level map for architecture, BI ingestion, and API documentation."
read_when:
  - You need a fast starting point for repo documentation
  - You are onboarding to the data layer, API layer, or UI architecture
title: "Documentation Home"
---

# Documentation Home

This docs tree follows an OpenClaw-style structure:

- `docs/docs.json` defines docs navigation and redirects.
- Every markdown page has frontmatter with:
  - `summary`: one-line purpose
  - `read_when`: when to consult the page
- Scripts keep docs operational and searchable:
  - `python scripts/docs_list.py`
  - `python scripts/docs_link_audit.py`
  - `python scripts/export_api_docs.py`

## Quick Links

- [Docs directory](/start/docs-directory)
- [Docs hubs](/start/hubs)
- [System architecture](/concepts/architecture)
- [BI layer architecture](/concepts/bi-layer)
- [Browser automation architecture](/concepts/browser-automation)
- [Browser website skills](/concepts/browser-website-skills)
- [Chat model routing](/concepts/chat-model-routing)
- [Tool planner tiering](/concepts/tool-planner-tiering)
- [Documentation workflow](/help/documentation-workflow)
- [BI operations runbook](/help/bi-operations)
- [Context recovery](/help/context-recovery)
- [API endpoint catalog](/api/endpoints)
