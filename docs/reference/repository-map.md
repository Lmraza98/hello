---
summary: "Directory-level map of core modules and ownership boundaries."
read_when:
  - You need to know where code should live before implementing
  - You are tracing behavior across API, services, UI, and BI
title: "Repository Map"
---

# Repository Map

## Root Services

- `api/`: FastAPI app and route modules.
- `services/`: domain logic (collection, enrichment, outreach workflows).
- `ui/`: React/Vite frontend.
- `zco-bi/`: standalone BI module (collection, scoring, query server).
- `data/`: SQLite DBs and runtime artifacts.

## API Layer (`api/`)

- `api/main.py`: app boot, middleware, router registration.
- `api/routes/`: route boundaries by domain:
  - companies/contacts/email/pipeline/research/search
  - browser + salesnav browser workflows
  - workflows (outreach, prospecting, vetting)
  - bi/admin/stats

## Service Layer (`services/`)

- `services/workflows/`: backend workflow boundary for multi-step operations (outreach, prospecting, vetting).
- `services/salesnav/`: SalesNav orchestration workflows.
- `services/browser_skills/`: markdown-backed website skill store and repair-log logic.
- `services/linkedin/`: lower-level LinkedIn scraping mechanics.
- `services/email/`: campaign planning, delivery, tracking.
- `services/salesforce/`: Salesforce automation/session handling.
- `services/search/`: retrieval/indexing logic.

## BI Module (`zco-bi/`)

- `zco-bi/src/sqliteCollector.ts`: 24/7 SQLite-backed collector loop.
- `zco-bi/src/sqliteSources.ts`: source adapters and source-run logging.
- `zco-bi/src/query.ts`: BI query endpoints.
- `zco-bi/scripts/worker.ts`: long-running ingestion worker.
- `zco-bi/scripts/status.ts`: BI status summary.

## Frontend (`ui/`)

- `ui/src/api/`: API client layer (index.ts barrel, client.ts shared fetch, types.ts, emailApi.ts provider).
- `ui/src/pages/*`: feature pages, including BI monitor/console surfaces.
- `ui/src/chat/*`: chat engine and tool orchestration.
- `ui/src/services/workflows/*`: frontend workflow steps (UI interaction gates; data ops delegate to backend).

## Documentation (`docs/`)

- `docs/docs.json`: docs navigation + redirects.
- `docs/start/*`: docs entrypoints and hubs.
- `docs/concepts/*`: architecture docs.
- `docs/help/*`: runbooks and maintenance workflow.
- `docs/reference/*`: repository maps and technical references.
