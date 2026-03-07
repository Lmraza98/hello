---
summary: "Fast path for recovering architectural context when session memory is limited."
read_when:
  - You are resuming work after context loss
  - You need a minimal set of files to reload system understanding
title: "Context Recovery"
---

# Context Recovery

Use this sequence when you need to rebuild context quickly.

## 1) Load Docs Map

```bash
python scripts/docs_list.py
```

Then read:

- [Docs directory](/start/docs-directory)
- [System architecture](/concepts/architecture)
- [Repository map](/reference/repository-map)

## 2) Refresh API Surface

```bash
python scripts/export_api_docs.py
```

Then check:

- [API endpoint catalog](/api/endpoints)

## 3) Validate Link Integrity

```bash
python scripts/docs_link_audit.py
```

## 4) Read Domain-Specific Pages

- Browser + SalesNav automation:
  - [Browser automation](/concepts/browser-automation)
  - [Sales Navigator automation](/SALESNAV_AUTOMATION)
  - [Launcher frontend architecture](/help/launcher-frontend-architecture)
- Chat + planning:
  - [Chat model routing](/concepts/chat-model-routing)
  - [Tool planner tiering](/concepts/tool-planner-tiering)
- Search + retrieval:
  - [Hybrid search](/hybrid_search)

This gives enough context to continue implementation without re-reading the entire codebase.

## 5) UI Pattern Corpus

For Contacts UI consistency patterns and interaction rules:

- Source files live in `ui/patterns/`
