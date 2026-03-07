---
summary: "Directory-level map of core modules and ownership boundaries."
read_when:
  - You need to know where code should live before implementing
  - You are tracing behavior across API, services, and UI
title: "Repository Map"
---

# Repository Map

## Root Services

- `api/`: FastAPI app and route modules.
- `services/`: domain logic (collection, enrichment, outreach workflows).
- `ui/`: React/Next.js frontend.
- `data/`: SQLite DBs and runtime artifacts.

## API Layer (`api/`)

- `api/main.py`: app boot, middleware, router registration.
- `api/routes/`: route boundaries by domain:
  - companies/contacts/email/pipeline/research/search
  - browser + salesnav browser workflows
  - workflows (outreach, prospecting, vetting)
  - admin/stats

## Service Layer (`services/`)

- `services/web_automation/`: browser-driven automation domains.
- `services/web_automation/browser/`: shared browser runtime (backends, workflow engine, challenge handling, skills, workflow recipes).
- `services/web_automation/linkedin/`: LinkedIn and Sales Navigator automation.
- `services/web_automation/google/`: Google-specific automation workflows.
- `services/web_automation/salesforce/`: Salesforce automation/session handling.
- `services/orchestration/`: cross-domain orchestration (outreach/prospecting/vetting, compound workflows, runners).
- `services/email/`: campaign planning, delivery, tracking.
- `services/documents/`: document processing and retrieval flows.
- `services/enrichment/`: enrichment modules (for example phone discovery).
- `services/search/`: retrieval/indexing logic.

## Frontend (`ui/`)

- `ui/src/api/`: API client layer (index.ts barrel, client.ts shared fetch, types.ts, emailApi.ts provider).
- `ui/src/pages/*`: feature pages for operations, outreach, and automation workflows.
- `ui/src/chat/*`: chat engine and tool orchestration.
- `ui/src/services/workflows/*`: frontend workflow steps (UI interaction gates; data ops delegate to backend).

## Launcher Frontend (`launcher_frontend/`)

- `launcher_frontend/src/app/`: modular launcher UI architecture.
  - `hooks/`: orchestration and domain hooks.
  - `views/`: render-focused shell/tests/graph views.
  - `state/`: reducer domains, selectors, and context builders.
  - `utils/`: pure helper logic.
  - `constants/`: layout/runtime constants.
- Detailed module contract: `docs/help/launcher-frontend-architecture.md`.

## Documentation (`docs/`)

- `docs/docs.json`: docs navigation + redirects.
- `docs/start/*`: docs entrypoints and hubs.
- `docs/concepts/*`: architecture docs.
- `docs/help/*`: runbooks and maintenance workflow.
- `docs/reference/*`: repository maps and technical references.
