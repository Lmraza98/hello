---
summary: "Runbook for operating the 24/7 BI worker against outreach.db."
read_when:
  - You need to run or debug the BI worker loop
  - BI data is stale or missing in UI
title: "BI Operations Runbook"
---

# BI Operations Runbook

## Start Worker

```bash
cd zco-bi
npm run worker
```

Expected startup signal:

- `collector loop started (sqlite backend)`

## Check BI Health

```bash
cd zco-bi
npm run bi:status
```

Look at:

- `bi_companies_count`
- `updated_last_hour`
- `recent_runs`
- `recent_source_runs`

## Common Debug Flow

1. Confirm SQLite path in output points to `data/outreach.db`.
2. Verify source throttling messages (for SalesNav) are expected.
3. Check `recent_source_runs` for source-specific failures.
4. Open BI API endpoints:
   - `GET /api/bi/status`
   - `GET /api/bi/sources`
   - `GET /api/bi/runs`
   - `GET /api/bi/errors`

## Data Provenance Checks

When company BI evidence looks weak, verify:

- source links are present in BI signals/logs
- latest run included the source
- company had source coverage in that cycle

Without source URLs and evidence, BI output is informational only and should not drive outreach decisions.
