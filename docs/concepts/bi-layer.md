---
summary: "How the BI module ingests sources, normalizes records, and surfaces evidence into outreach.db and UI."
read_when:
  - You are debugging source ingestion runs
  - You need to surface source evidence for a company in the UI
  - You are extending BI coverage to a new source
title: "BI Layer"
---

# BI Layer

The BI module lives in `zco-bi/` and is intentionally decoupled from chat/runtime logic.

## Responsibilities

- Collect source data on a schedule (SalesNav, app stores, news, website, and others).
- Normalize source payloads into canonical company/signal records.
- Persist run telemetry (processed/inserted/updated/failed).
- Link BI records back to outreach companies for operator-facing evidence.

## Persistence Strategy

- Operational source of truth: `data/outreach.db`.
- BI tables and run logs are stored in SQLite so workers can run continuously without Postgres.

## Key Runtime Scripts

- Worker loop: `zco-bi/scripts/worker.ts`
- Status/reporting: `zco-bi/scripts/status.ts`
- Ingestion trigger: `zco-bi/scripts/ingest.ts`

## What the UI Should Show

- Coverage by source per company
- Freshness timestamps
- Signals with source links/evidence URLs
- Run logs and error reasons
- Provenance for each normalized signal

Without source links and provenance, BI summaries are not actionable.
