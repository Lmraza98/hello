---
summary: "High-level architecture map across API, services, and UI modules."
read_when:
  - You need to understand where to implement a change
  - You are tracing data flow from collection to UI
title: "System Architecture"
---

# System Architecture

This repository is organized as a layered platform:

## API Layer

- `api/main.py` composes FastAPI routers.
- `api/routes/*` exposes HTTP contracts for companies, contacts, email, SalesNav, browser automation, and workflows.

## Service Layer

- `services/*` is the backend domain layer.
- Allowed top-level domains:
  - `services/web_automation/*`: browser automation for LinkedIn, Google, Salesforce, and shared browser runtime.
  - `services/orchestration/*`: multi-step orchestration and runners.
  - `services/email/*`: email generation, preparation, sending, and tracking.
  - `services/documents/*`: document ingestion and retrieval helpers.
  - `services/search/*`: web/embedding search helpers.
  - `services/enrichment/*`: enrichment workflows (for example, phone discovery).
  - `services/identity/*`: identity normalization/classification used during ingestion.
- Deprecated legacy roots (`services.linkedin`, `services.browser_workflow`, `services.browser_workflows`, etc.) are blocked by boundary checks and should not be imported.

## Data Layer

- `database.py` and `data/outreach.db` hold operational outreach data.

## Frontend Layer

- `ui/` is the operator console for companies, contacts, campaigns, and chat tooling.
- Chat tool planning uses a [tiered prompt system](/concepts/tool-planner-tiering) that classifies queries by complexity and scales the LLM prompt + tool set accordingly.

## Docs and Contracts

- `docs/` holds architecture and process documentation.
- `docs/api/openapi.json` and `docs/api/endpoints.md` are generated from FastAPI.

## Flow (Summary)

1. Source collectors gather raw intelligence and outreach leads.
2. Data is normalized and linked to company identity records.
3. Signals and scores are computed.
4. API endpoints expose operational views and workflow controls.
5. UI renders coverage, evidence, and actions for users.
