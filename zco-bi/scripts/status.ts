import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { getSourceRunLogPath } from '../src/sqliteSources';

dotenv.config({ path: 'config/sources.env' });
dotenv.config();

const execFileAsync = promisify(execFile);

function resolveDbPath(raw: string): string {
  return path.isAbsolute(raw) ? raw : path.resolve(process.cwd(), raw);
}

type SourceLogRow = {
  source?: string;
  started_at?: string;
  ok?: boolean;
  collected?: number;
  saved?: number;
};

function summarizeSourceRuns(rows: SourceLogRow[], hours: number): Array<{
  source: string;
  runs: number;
  ok: number;
  failed: number;
  collected: number;
  saved: number;
}> {
  const cutoff = Date.now() - hours * 60 * 60 * 1000;
  const buckets = new Map<string, { source: string; runs: number; ok: number; failed: number; collected: number; saved: number }>();
  for (const row of rows) {
    const started = row.started_at ? Date.parse(row.started_at) : NaN;
    if (!Number.isFinite(started) || started < cutoff) continue;
    const source = row.source || 'unknown';
    const bucket = buckets.get(source) || { source, runs: 0, ok: 0, failed: 0, collected: 0, saved: 0 };
    bucket.runs += 1;
    if (row.ok) bucket.ok += 1;
    else bucket.failed += 1;
    bucket.collected += Number(row.collected || 0);
    bucket.saved += Number(row.saved || 0);
    buckets.set(source, bucket);
  }
  return Array.from(buckets.values()).sort((a, b) => b.saved - a.saved || b.ok - a.ok || b.runs - a.runs);
}

async function main(): Promise<void> {
  const pythonBin = process.env.PYTHON_BIN || 'python';
  const sqlitePathRaw = process.env.BI_SQLITE_PATH || process.env.OUTREACH_DB_PATH || '../data/outreach.db';
  const sqlitePath = resolveDbPath(sqlitePathRaw);
  const script = `
import json, sqlite3, sys
db_path = sys.argv[1]
conn = sqlite3.connect(db_path)
conn.row_factory = sqlite3.Row
cur = conn.cursor()

out = {"db_path": db_path}

cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='bi_companies'")
has_companies = cur.fetchone() is not None
cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='bi_runs'")
has_runs = cur.fetchone() is not None
out["has_bi_companies"] = has_companies
out["has_bi_runs"] = has_runs

if has_companies:
    cur.execute("SELECT COUNT(*) AS cnt FROM bi_companies")
    out["bi_companies_count"] = cur.fetchone()["cnt"]
    cur.execute("SELECT COUNT(*) AS cnt FROM bi_companies WHERE updated_at >= datetime('now', '-1 hour')")
    out["updated_last_hour"] = cur.fetchone()["cnt"]
    cur.execute("SELECT name, vertical, tier, status, prospect_score, updated_at FROM bi_companies ORDER BY prospect_score DESC, updated_at DESC LIMIT 5")
    out["top5"] = [dict(r) for r in cur.fetchall()]

if has_runs:
    cur.execute("PRAGMA table_info(bi_runs)")
    cols = [r["name"] if isinstance(r, sqlite3.Row) else r[1] for r in cur.fetchall()]
    base = ["id","status","started_at","completed_at","processed","inserted","updated","failed","error_log"]
    if "unchanged" in cols:
      base.insert(7, "unchanged")
    if "signals_added" in cols:
      base.insert(8, "signals_added")
    sql = "SELECT " + ", ".join(base) + " FROM bi_runs ORDER BY id DESC LIMIT 10"
    cur.execute(sql)
    out["recent_runs"] = [dict(r) for r in cur.fetchall()]

conn.close()
print(json.dumps(out, indent=2))
`.trim();

  const { stdout } = await execFileAsync(pythonBin, ['-c', script, sqlitePath], { maxBuffer: 10 * 1024 * 1024 });
  const base = JSON.parse(stdout.trim()) as Record<string, unknown>;

  const sourceLog = getSourceRunLogPath();
  if (fs.existsSync(sourceLog)) {
    const lines = fs.readFileSync(sourceLog, 'utf8').split(/\r?\n/).filter(Boolean);
    const parsed = lines.map((line) => {
      try {
        return JSON.parse(line) as Record<string, unknown>;
      } catch {
        return { parse_error: true, raw: line };
      }
    });
    const tail = parsed.slice(-10);
    base.source_runs_log = sourceLog;
    base.recent_source_runs = tail;
    base.source_summary_24h = summarizeSourceRuns(parsed as SourceLogRow[], 24);
  } else {
    base.source_runs_log = sourceLog;
    base.recent_source_runs = [];
    base.source_summary_24h = [];
  }

  console.log(JSON.stringify(base, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
