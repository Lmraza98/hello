import crypto from 'crypto';
import path from 'path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Pool } from 'pg';
import { normalizeRawEvents } from './normalizer';

type RawEventInput = {
  source: string;
  source_id?: string;
  event_type: string;
  payload: Record<string, unknown>;
};

type IngestionStats = {
  inserted: number;
  skipped: number;
  failed: number;
};

type SourceCollector = (pool: Pool) => Promise<RawEventInput[]>;
const execFileAsync = promisify(execFile);

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((v) => stableStringify(v)).join(',')}]`;
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function hashPayload(payload: Record<string, unknown>): string {
  const digest = crypto.createHash('sha256');
  digest.update(stableStringify(payload));
  return digest.digest('hex');
}

async function startRun(pool: Pool, source: string, sourceConfig: Record<string, unknown>): Promise<number> {
  const { rows } = await pool.query(
    `INSERT INTO ingestion_runs(source, source_config, status)
     VALUES ($1, $2::jsonb, 'running')
     RETURNING id`,
    [source, JSON.stringify(sourceConfig)]
  );
  return rows[0].id as number;
}

async function finishRun(pool: Pool, runId: number, stats: IngestionStats, status: 'completed' | 'failed', errorLog?: string): Promise<void> {
  await pool.query(
    `UPDATE ingestion_runs
     SET status=$2, completed_at=NOW(), rows_ingested=$3, rows_skipped=$4, rows_failed=$5, error_log=$6
     WHERE id=$1`,
    [runId, status, stats.inserted, stats.skipped, stats.failed, errorLog || null]
  );
}

async function insertRawEvents(pool: Pool, runId: number, events: RawEventInput[]): Promise<IngestionStats> {
  const stats: IngestionStats = { inserted: 0, skipped: 0, failed: 0 };
  for (const event of events) {
    try {
      const payloadHash = hashPayload(event.payload);
      const { rows: exists } = await pool.query(
        `SELECT id FROM raw_events WHERE payload_hash = $1 LIMIT 1`,
        [payloadHash]
      );
      if (exists.length > 0) {
        stats.skipped += 1;
        continue;
      }
      await pool.query(
        `INSERT INTO raw_events(run_id, source, source_id, event_type, payload, payload_hash)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
        [runId, event.source, event.source_id || null, event.event_type, JSON.stringify(event.payload), payloadHash]
      );
      stats.inserted += 1;
    } catch {
      stats.failed += 1;
    }
  }
  return stats;
}

async function collectOutreachDb(_pool: Pool): Promise<RawEventInput[]> {
  const enabled = (process.env.OUTREACH_DB_ENABLED || 'true').toLowerCase() === 'true';
  if (!enabled) return [];

  const dbPathRaw = process.env.OUTREACH_DB_PATH || '../data/outreach.db';
  const dbPath = path.isAbsolute(dbPathRaw) ? dbPathRaw : path.resolve(process.cwd(), dbPathRaw);
  const limit = Number(process.env.OUTREACH_DB_TARGET_LIMIT || '1000');
  const python = process.env.PYTHON_BIN || 'python';

  const script = `
import json, sqlite3, sys
db_path = sys.argv[1]
limit = int(sys.argv[2])
conn = sqlite3.connect(db_path)
conn.row_factory = sqlite3.Row
cur = conn.cursor()
rows = []
try:
    cur.execute(
        "SELECT id, company_name, domain, vertical, tier, target_reason, wedge, source, source_url, notes, status, created_at, updated_at FROM targets ORDER BY updated_at DESC LIMIT ?",
        (limit,)
    )
    rows = [dict(r) for r in cur.fetchall()]
except Exception:
    rows = []
finally:
    conn.close()
print(json.dumps(rows))
`.trim();

  let stdout = '[]';
  try {
    const result = await execFileAsync(python, ['-c', script, dbPath, String(limit)], { maxBuffer: 10 * 1024 * 1024 });
    stdout = result.stdout || '[]';
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[collector][outreach_db] failed to read ${dbPath}: ${msg}`);
    return [];
  }

  let rows: Array<Record<string, unknown>> = [];
  try {
    rows = JSON.parse(stdout) as Array<Record<string, unknown>>;
  } catch {
    console.error('[collector][outreach_db] invalid JSON from sqlite reader');
    return [];
  }

  const events: RawEventInput[] = [];
  for (const row of rows) {
    const companyName = String(row.company_name || '').trim();
    if (!companyName) continue;
    events.push({
      source: 'outreach_db',
      source_id: String(row.id || ''),
      event_type: 'company_discovered',
      payload: {
        company_name: companyName,
        name: companyName,
        domain: row.domain || null,
        vertical: row.vertical || null,
        tier: row.tier || null,
        notes: row.notes || null,
        description: row.target_reason || row.notes || null,
        source: row.source || 'outreach_db',
        source_url: row.source_url || null,
        target_reason: row.target_reason || null,
        wedge: row.wedge || null,
        status: row.status || null,
        created_at: row.created_at || null,
        updated_at: row.updated_at || null,
      },
    });
  }

  return events;
}

async function collectSalesNav(_pool: Pool): Promise<RawEventInput[]> {
  const enabled = (process.env.SALESNAV_ENABLED || 'false').toLowerCase() === 'true';
  if (!enabled) return [];

  const url = process.env.SALESNAV_COLLECT_URL || 'http://localhost:8000/api/companies/collect';
  const maxCompanies = Number(process.env.SALESNAV_MAX_COMPANIES || '50');
  const queries = (process.env.SALESNAV_QUERIES || '')
    .split('|')
    .map((x) => x.trim())
    .filter(Boolean);
  if (queries.length === 0) return [];

  const out: RawEventInput[] = [];
  for (const query of queries) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, max_companies: maxCompanies, save_to_db: false }),
      });
      if (!response.ok) {
        console.error(`[collector][salesnav] ${query} failed with ${response.status}`);
        continue;
      }
      const data = (await response.json()) as { companies?: Array<Record<string, unknown>> };
      const companies = data.companies || [];
      if (companies.length === 0) {
        console.warn(`[collector][salesnav] ${query} returned no companies`);
      }
      for (const company of companies) {
        out.push({
          source: 'salesnav',
          source_id: String(company.linkedin_url || company.domain || company.company_name || company.name || ''),
          event_type: 'company_discovered',
          payload: company,
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[collector][salesnav] ${query} exception: ${msg}`);
    }
  }
  return out;
}

async function collectCrunchbase(_pool: Pool): Promise<RawEventInput[]> {
  const enabled = (process.env.CRUNCHBASE_ENABLED || 'false').toLowerCase() === 'true';
  if (!enabled) return [];
  const apiKey = process.env.CRUNCHBASE_API_KEY || '';
  const orgs = (process.env.CRUNCHBASE_ORGS || '')
    .split('|')
    .map((x) => x.trim())
    .filter(Boolean);
  if (!apiKey || orgs.length === 0) return [];

  const template = process.env.CRUNCHBASE_ORG_URL_TEMPLATE || 'https://api.crunchbase.com/api/v4/entities/organizations/{org}';
  const out: RawEventInput[] = [];

  for (const org of orgs) {
    const url = template.replace('{org}', encodeURIComponent(org));
    const response = await fetch(url, {
      headers: {
        'X-cb-user-key': apiKey,
        Accept: 'application/json',
      },
    });
    if (!response.ok) continue;
    const raw = (await response.json()) as Record<string, unknown>;
    out.push({
      source: 'crunchbase',
      source_id: org,
      event_type: 'company_discovered',
      payload: raw,
    });
    const properties = (raw.properties || {}) as Record<string, unknown>;
    const fundingTotal = properties.total_funding_usd;
    const lastRound = properties.last_funding_type;
    if (fundingTotal || lastRound) {
      out.push({
        source: 'crunchbase',
        source_id: org,
        event_type: 'funding_round',
        payload: {
          company_name: properties.identifier,
          organization_name: properties.identifier,
          amount: fundingTotal,
          funding_type: lastRound,
          announced_on: properties.last_funding_at,
          cb_url: properties.website_url,
        },
      });
    }
  }

  return out;
}

function normalizeTokens(text: string): string[] {
  return text.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
}

async function collectAppStore(pool: Pool): Promise<RawEventInput[]> {
  const enabled = (process.env.APPSTORE_ENABLED || 'false').toLowerCase() === 'true';
  if (!enabled) return [];
  const limit = Number(process.env.APPSTORE_SCAN_LIMIT || '100');
  const { rows } = await pool.query(
    `SELECT id, name, domain
     FROM companies
     WHERE status != 'disqualified'
     ORDER BY updated_at ASC
     LIMIT $1`,
    [limit]
  );

  const out: RawEventInput[] = [];
  const minOverlapRatio = Number(process.env.APPSTORE_MIN_NAME_OVERLAP_RATIO || '0.5');
  for (const row of rows as Array<{ id: number; name: string; domain: string | null }>) {
    const term = encodeURIComponent(row.name);
    const response = await fetch(`https://itunes.apple.com/search?term=${term}&entity=software&limit=5`);
    if (!response.ok) continue;
    const data = (await response.json()) as { results?: Array<Record<string, unknown>> };
    const results = data.results || [];
    if (results.length === 0) continue;

    const nameTokens = normalizeTokens(row.name);
    const best = results
      .map((app) => {
        const seller = String(app.sellerName || '');
        const sellerTokens = new Set(normalizeTokens(seller));
        const overlap = nameTokens.filter((t) => sellerTokens.has(t)).length;
        const ratio = nameTokens.length > 0 ? overlap / nameTokens.length : 0;
        return { app, score: overlap, ratio };
      })
      .sort((a, b) => b.ratio - a.ratio || b.score - a.score)[0];
    if (!best) continue;
    if (best.score < 1 || best.ratio < minOverlapRatio) {
      continue;
    }

    out.push({
      source: 'appstore',
      source_id: String(best.app.trackId || row.id),
      event_type: 'app_review_data',
      payload: {
        company_name: row.name,
        company_domain: row.domain,
        sellerName: best.app.sellerName,
        trackViewUrl: best.app.trackViewUrl,
        averageUserRating: best.app.averageUserRating,
        userRatingCount: best.app.userRatingCount,
      },
    });
  }
  return out;
}

const SOURCES: Array<{ name: string; collect: SourceCollector }> = [
  { name: 'outreach_db', collect: collectOutreachDb },
  { name: 'salesnav', collect: collectSalesNav },
  { name: 'crunchbase', collect: collectCrunchbase },
  { name: 'appstore', collect: collectAppStore },
];

export async function runCollectorCycle(pool: Pool): Promise<void> {
  for (const source of SOURCES) {
    const runId = await startRun(pool, source.name, { mode: 'auto' });
    try {
      console.log(`[collector] ${source.name}: collecting...`);
      const events = await source.collect(pool);
      console.log(`[collector] ${source.name}: collected ${events.length} raw events`);
      const stats = await insertRawEvents(pool, runId, events);
      console.log(`[collector] ${source.name}: inserted=${stats.inserted} skipped=${stats.skipped} failed=${stats.failed}`);
      await finishRun(pool, runId, stats, 'completed');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[collector] ${source.name} failed: ${msg}`);
      await finishRun(
        pool,
        runId,
        { inserted: 0, skipped: 0, failed: 1 },
        'failed',
        msg
      );
    }
  }

  const normalized = await normalizeRawEvents({ pool });
  if (normalized.processed > 0) {
    await pool.query(`SELECT * FROM score_all_companies()`);
    await pool.query(`SELECT refresh_bi_views()`);
  }
}

export function startCollectorLoop(pool: Pool): { stop: () => void } {
  const minutes = Number(process.env.COLLECTOR_INTERVAL_MINUTES || '15');
  const intervalMs = Math.max(1, minutes) * 60 * 1000;
  let timer: NodeJS.Timeout | null = null;
  let running = false;
  let stopped = false;

  const tick = async (): Promise<void> => {
    if (running || stopped) return;
    running = true;
    try {
      await runCollectorCycle(pool);
    } catch (err) {
      console.error('collector cycle failed:', err);
    } finally {
      running = false;
    }
  };

  void tick();
  timer = setInterval(() => {
    void tick();
  }, intervalMs);

  return {
    stop: () => {
      stopped = true;
      if (timer) clearInterval(timer);
    },
  };
}
