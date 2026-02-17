---
summary: "High-level architecture map across API, services, UI, and BI modules."
read_when:
  - You need to understand where to implement a change
  - You are tracing data flow from collection to UI
title: "System Architecture"
---

# System Architecture

This repository is organized as a layered platform:

## API Layer

- `api/main.py` composes FastAPI routers.
- `api/routes/*` exposes HTTP contracts for companies, contacts, email, SalesNav, browser automation, and BI.

## Service Layer

- `services/*` contains domain logic:
  - collection/scraping
  - enrichment
  - outreach orchestration
  - signal scoring support

## Data Layer

- `database.py` and `data/outreach.db` hold operational outreach data.
- `zco-bi/` runs BI ingestion/scoring loops and writes normalized intelligence back to SQLite.

## Frontend Layer

- `ui/` is the operator console for companies, contacts, campaigns, chat tooling, and BI evidence.
- Chat tool planning uses a [tiered prompt system](/concepts/tool-planner-tiering) that classifies queries by complexity and scales the LLM prompt + tool set accordingly.

## Docs and Contracts

- `docs/` holds architecture and process documentation.
- `docs/api/openapi.json` and `docs/api/endpoints.md` are generated from FastAPI.

## Flow (Summary)

1. Source collectors gather raw intelligence and outreach leads.
2. Data is normalized and linked to company identity records.
3. Signals and scores are computed.
4. API endpoints expose the joined operational + BI views.
5. UI renders coverage, evidence, and actions for users.
