# Zco BI Platform (Standalone)

This folder is isolated from the existing chat stack and contains a standalone BI toolkit.

## Structure

- `schema/001_canonical.sql`
- `schema/002_scoring.sql`
- `schema/003_views.sql`
- `src/normalizer.ts`
- `src/query.ts`
- `src/tools.ts`
- `scripts/ingest.ts`
- `scripts/score.ts`
- `query/server.ts`

## Quick start

```bash
cd zco-bi
cp config/sources.example.env config/sources.env
npm install

psql "$DATABASE_URL" -f schema/001_canonical.sql
psql "$DATABASE_URL" -f schema/002_scoring.sql
psql "$DATABASE_URL" -f schema/003_views.sql

npx ts-node scripts/ingest.ts --source=csv --file=./my-prospects.csv
npx ts-node scripts/score.ts
npx ts-node query/server.ts
```

## 24/7 autonomous collection

Enable sources in `config/sources.env` and start either:

```bash
# dedicated worker (recommended)
npx ts-node scripts/worker.ts

# or start collector inside query server
AUTO_COLLECTOR=true npx ts-node query/server.ts
```

What it does every cycle:
- Pulls base companies from your local `outreach.db` (`targets` table)
- Collects from enabled sources (`salesnav`, `appstore`, `playstore`, `job_postings`, `website`, `google_news`, `crunchbase`)
- Writes deduplicated immutable `raw_events`
- Runs normalizer to promote to canonical tables
- Re-scores all companies
- Refreshes BI materialized views

Use `COLLECTOR_INTERVAL_MINUTES` to control cadence.

### SQLite-first mode (recommended for your current stack)

If your live system uses `data/outreach.db`, run BI directly against SQLite:

```bash
BI_BACKEND=sqlite
BI_SQLITE_PATH=../data/outreach.db
COLLECTOR_INTERVAL_MINUTES=15
```

Then:

```bash
npx ts-node scripts/worker.ts
```

This creates and maintains:
- `bi_runs`
- `bi_companies`
- `bi_top_prospects` (view)

inside `outreach.db`, updated every cycle from `targets`.

### SalesNav safety controls (anti-ban defaults)

Use these to keep automation conservative:

```bash
SALESNAV_SAFE_MODE=true
SALESNAV_MIN_INTERVAL_MINUTES=120
SALESNAV_MAX_QUERIES_PER_CYCLE=1
SALESNAV_DAILY_MAX_REQUESTS=12
SALESNAV_INTER_QUERY_DELAY_MS=5000
SALESNAV_REQUEST_TIMEOUT_MS=90000
```

Behavior:
- Runs at most one SalesNav query per BI cycle
- Enforces minimum minutes between SalesNav passes
- Enforces daily max number of SalesNav requests
- Rotates queries across cycles instead of firing all at once

### Multi-source collection (SQLite mode)

SQLite worker can collect from multiple BI sources each cycle:
- `salesnav` (browser automation, throttled)
- `appstore` (iTunes Search API)
- `playstore` (Google Play search crawl)
- `job_postings` (optional local jobs collection endpoint)
- `website` (homepage + careers crawl for hiring/mobile signals)
- `google_news` (Google News RSS)
- `crunchbase` (optional, requires API key)

Recommended caps:

```bash
BI_SOURCE_COMPANY_POOL_LIMIT=200
APPSTORE_ENABLED=true
APPSTORE_MAX_COMPANIES_PER_CYCLE=5
PLAYSTORE_ENABLED=false
PLAYSTORE_MAX_COMPANIES_PER_CYCLE=5
JOB_POSTINGS_ENABLED=false
JOB_POSTINGS_COLLECT_URL=
JOB_POSTINGS_MAX_COMPANIES_PER_CYCLE=5
WEBSITE_SIGNALS_ENABLED=false
WEBSITE_SIGNALS_MAX_COMPANIES_PER_CYCLE=5
GOOGLE_NEWS_ENABLED=true
GOOGLE_NEWS_MAX_COMPANIES_PER_CYCLE=5
CRUNCHBASE_ENABLED=false
CRUNCHBASE_MAX_COMPANIES_PER_CYCLE=5
```

All source runs are logged in `zco-bi/data/source_runs.jsonl` and shown in the BI UI page.

### Using existing leads/outreach DB as company source

Set in `config/sources.env`:

```bash
OUTREACH_DB_ENABLED=true
OUTREACH_DB_PATH=../data/outreach.db
OUTREACH_DB_TARGET_LIMIT=2000
PYTHON_BIN=python
```

This makes BI ingest companies from the existing `targets` table automatically every cycle.

## Notes

- `src/tools.ts` contains the BI tool definitions for an agent layer.
- No files in `ui/src/chat` are modified by this package.
