import path from 'path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

type SqliteCycleResult = {
  backend: 'sqlite';
  db_path: string;
  processed: number;
  inserted: number;
  updated: number;
  unchanged: number;
  signals_added: number;
  inserted_examples?: string[];
  updated_examples?: string[];
  duration_ms: number;
};

function resolvePath(raw: string): string {
  return path.isAbsolute(raw) ? raw : path.resolve(process.cwd(), raw);
}

function pyCode(): string {
  return `
import hashlib
import json
import os
import re
import sqlite3
import sys
from urllib.parse import quote_plus
from datetime import datetime, timezone

db_path = sys.argv[1]
source_log_path = sys.argv[2]
conn = sqlite3.connect(db_path)
conn.row_factory = sqlite3.Row
cur = conn.cursor()

cur.executescript("""
CREATE TABLE IF NOT EXISTS bi_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  status TEXT NOT NULL DEFAULT 'running',
  started_at TEXT NOT NULL,
  completed_at TEXT,
  processed INTEGER NOT NULL DEFAULT 0,
  inserted INTEGER NOT NULL DEFAULT 0,
  updated INTEGER NOT NULL DEFAULT 0,
  unchanged INTEGER NOT NULL DEFAULT 0,
  signals_added INTEGER NOT NULL DEFAULT 0,
  failed INTEGER NOT NULL DEFAULT 0,
  error_log TEXT
);

CREATE TABLE IF NOT EXISTS bi_companies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_target_id INTEGER UNIQUE,
  name TEXT NOT NULL,
  domain TEXT,
  vertical TEXT,
  tier TEXT,
  status TEXT,
  notes TEXT,
  prospect_score INTEGER NOT NULL DEFAULT 0,
  icp_fit_score INTEGER NOT NULL DEFAULT 0,
  signal_score INTEGER NOT NULL DEFAULT 0,
  engagement_score INTEGER NOT NULL DEFAULT 0,
  score_updated_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS bi_signals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  unique_key TEXT UNIQUE,
  source TEXT NOT NULL,
  company_name TEXT NOT NULL,
  signal_type TEXT NOT NULL,
  signal_strength TEXT NOT NULL DEFAULT 'medium',
  score_weight INTEGER NOT NULL DEFAULT 10,
  evidence TEXT,
  metadata_json TEXT,
  detected_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_bi_companies_score ON bi_companies(prospect_score DESC);
CREATE INDEX IF NOT EXISTS idx_bi_companies_vertical ON bi_companies(vertical);
CREATE INDEX IF NOT EXISTS idx_bi_companies_tier ON bi_companies(tier);
CREATE INDEX IF NOT EXISTS idx_bi_companies_status ON bi_companies(status);
CREATE INDEX IF NOT EXISTS idx_bi_signals_company ON bi_signals(company_name);
CREATE INDEX IF NOT EXISTS idx_bi_signals_detected ON bi_signals(detected_at DESC);
""")

# lightweight migrations for older tables
cur.execute("PRAGMA table_info(bi_runs)")
run_cols = {r[1] for r in cur.fetchall()}
if "unchanged" not in run_cols:
  cur.execute("ALTER TABLE bi_runs ADD COLUMN unchanged INTEGER NOT NULL DEFAULT 0")
if "signals_added" not in run_cols:
  cur.execute("ALTER TABLE bi_runs ADD COLUMN signals_added INTEGER NOT NULL DEFAULT 0")

cur.execute("""
CREATE VIEW IF NOT EXISTS bi_top_prospects AS
SELECT
  id,
  source_target_id,
  name,
  domain,
  vertical,
  tier,
  status,
  prospect_score,
  icp_fit_score,
  signal_score,
  engagement_score,
  score_updated_at,
  updated_at
FROM bi_companies
ORDER BY prospect_score DESC, updated_at DESC
""")

now = datetime.now(timezone.utc).isoformat()
cur.execute(
  "INSERT INTO bi_runs(status, started_at, processed, inserted, updated, unchanged, signals_added, failed) VALUES('running', ?, 0, 0, 0, 0, 0, 0)",
  (now,)
)
run_id = cur.lastrowid

sweet_spots = {"Healthcare", "Fintech", "Logistics", "Construction", "Retail", "Education", "Insurance"}
tier_points = {"A": 30, "B": 20, "C": 12}
status_points = {
  "new": 8,
  "researching": 10,
  "prospecting": 12,
  "contacted": 6,
  "engaged": 4,
  "opportunity": 2,
}
strength_mult = {"weak": 0.6, "medium": 1.0, "strong": 1.2, "critical": 1.5}

def parse_iso_or_now(value):
  try:
    if not value:
      return datetime.now(timezone.utc)
    txt = str(value).replace("Z", "+00:00")
    dt = datetime.fromisoformat(txt)
    if dt.tzinfo is None:
      return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)
  except Exception:
    return datetime.now(timezone.utc)

def source_link(source, company, message, explicit_link=None):
  src = str(source or "").strip().lower()
  q = str(company or "").strip()
  msg = str(message or "").strip()
  explicit = str(explicit_link or "").strip()
  if not src:
    return None
  if explicit.startswith("http://") or explicit.startswith("https://"):
    return explicit
  # Prefer explicit URL in message text if present.
  m = re.search(r"https?://[^\\s]+", msg)
  if m:
    return m.group(0)
  if src == "google_news":
    return f"https://news.google.com/search?q={quote_plus(q)}" if q else None
  if src == "playstore":
    return f"https://play.google.com/store/search?q={quote_plus(q)}&c=apps" if q else None
  if src == "appstore":
    return f"https://apps.apple.com/us/search?term={quote_plus(q)}" if q else None
  if src == "crunchbase":
    return f"https://www.crunchbase.com/discover/organization.companies?query={quote_plus(q)}" if q else "https://www.crunchbase.com/discover/organization.companies"
  if src == "job_postings":
    return f"https://www.google.com/search?q={quote_plus(q + ' jobs')}" if q else None
  if src == "website":
    m2 = re.search(r"domain=([^\\s]+)", msg.lower())
    if m2:
      domain = m2.group(1).strip().strip("/")
      if domain:
        return f"https://{domain}"
  return None

def derive_signals(source_row):
  source = str(source_row.get("source") or "").strip().lower()
  if source not in {"appstore", "playstore", "google_news", "crunchbase", "website", "job_postings"}:
    return []
  if not bool(source_row.get("ok")):
    return []

  company = str(source_row.get("query") or "").strip()
  if not company:
    return []
  message = str(source_row.get("message") or "").strip()
  evidence_url = source_link(source, company, message, source_row.get("link"))
  detected_at = str(source_row.get("completed_at") or source_row.get("started_at") or datetime.now(timezone.utc).isoformat())

  out = []
  if source == "appstore":
    if int(source_row.get("saved") or 0) > 0:
      out.append({
        "source": source,
        "company_name": company,
        "signal_type": "appstore_match",
        "signal_strength": "weak",
        "score_weight": 4,
        "evidence": message,
        "metadata": {"saved": int(source_row.get("saved") or 0), "evidence_url": evidence_url, "source_query": company},
        "detected_at": detected_at,
      })
      m = re.search(r"rating=([0-9]+(?:\\.[0-9]+)?)", message.lower())
      if m:
        rating = float(m.group(1))
        if rating < 3.5:
          out.append({
            "source": source,
            "company_name": company,
            "signal_type": "bad_app_reviews",
            "signal_strength": "strong" if rating < 2.5 else "medium",
            "score_weight": 20 if rating < 2.5 else 12,
            "evidence": message,
            "metadata": {"rating": rating, "evidence_url": evidence_url, "source_query": company},
            "detected_at": detected_at,
          })
  elif source == "playstore":
    if int(source_row.get("saved") or 0) > 0:
      out.append({
        "source": source,
        "company_name": company,
        "signal_type": "playstore_match",
        "signal_strength": "weak",
        "score_weight": 4,
        "evidence": message,
        "metadata": {"saved": int(source_row.get("saved") or 0), "evidence_url": evidence_url, "source_query": company},
        "detected_at": detected_at,
      })
      m = re.search(r"(?:top_rating|rating)=([0-9]+(?:\\.[0-9]+)?)", message.lower())
      if m:
        rating = float(m.group(1))
        if rating < 3.5:
          out.append({
            "source": source,
            "company_name": company,
            "signal_type": "bad_app_reviews",
            "signal_strength": "strong" if rating < 2.5 else "medium",
            "score_weight": 18 if rating < 2.5 else 10,
            "evidence": message,
            "metadata": {"rating": rating, "evidence_url": evidence_url, "source_query": company},
            "detected_at": detected_at,
          })
  elif source == "google_news":
    title = message.lower()
    signal_type = "news_signal"
    strength = "medium"
    weight = 6
    if any(k in title for k in ["funding", "raised", "series a", "series b", "venture"]):
      signal_type = "funding_round"
      strength = "strong"
      weight = 20
    elif any(k in title for k in ["hiring", "hires", "job", "jobs", "engineer", "developer"]):
      signal_type = "hiring_developers"
      strength = "medium"
      weight = 14
    elif any(k in title for k in ["launch", "launched", "mobile app", "platform", "product"]):
      signal_type = "expansion_signal"
      strength = "medium"
      weight = 12
    out.append({
      "source": source,
      "company_name": company,
      "signal_type": signal_type,
      "signal_strength": strength,
      "score_weight": weight,
      "evidence": message,
      "metadata": {"collected": int(source_row.get("collected") or 0), "evidence_url": evidence_url, "source_query": company},
      "detected_at": detected_at,
    })
  elif source == "crunchbase":
    if int(source_row.get("saved") or 0) > 0:
      msg = message.lower()
      sig_type = "funding_round" if "funding" in msg else "crunchbase_enrichment"
      out.append({
        "source": source,
        "company_name": company,
        "signal_type": sig_type,
        "signal_strength": "strong" if sig_type == "funding_round" else "weak",
        "score_weight": 25 if sig_type == "funding_round" else 6,
        "evidence": message,
        "metadata": {"saved": int(source_row.get("saved") or 0), "evidence_url": evidence_url, "source_query": company},
        "detected_at": detected_at,
      })
  elif source == "website":
    if int(source_row.get("saved") or 0) > 0:
      msg = message.lower()
      if "hiring=yes" in msg:
        out.append({
          "source": source,
          "company_name": company,
          "signal_type": "hiring_developers",
          "signal_strength": "medium",
          "score_weight": 14,
          "evidence": message,
          "metadata": {"saved": int(source_row.get("saved") or 0), "evidence_url": evidence_url, "source_query": company},
          "detected_at": detected_at,
        })
      if "mobile=yes" in msg:
        out.append({
          "source": source,
          "company_name": company,
          "signal_type": "mobile_presence",
          "signal_strength": "weak",
          "score_weight": 4,
          "evidence": message,
          "metadata": {"saved": int(source_row.get("saved") or 0), "evidence_url": evidence_url, "source_query": company},
          "detected_at": detected_at,
        })
  elif source == "job_postings":
    if int(source_row.get("saved") or 0) > 0 or int(source_row.get("collected") or 0) > 0:
      out.append({
        "source": source,
        "company_name": company,
        "signal_type": "hiring_developers",
        "signal_strength": "strong",
        "score_weight": 20,
        "evidence": message,
        "metadata": {
          "saved": int(source_row.get("saved") or 0),
          "collected": int(source_row.get("collected") or 0),
          "evidence_url": evidence_url,
          "source_query": company,
        },
        "detected_at": detected_at,
      })
  return out

def add_signal(signal):
  key_seed = "|".join([
    signal["source"],
    signal["company_name"].lower(),
    signal["signal_type"],
    signal["signal_strength"],
    str(signal["score_weight"]),
    signal["detected_at"],
    signal.get("evidence") or "",
  ])
  unique_key = hashlib.sha1(key_seed.encode("utf-8")).hexdigest()
  cur.execute(
    """INSERT OR IGNORE INTO bi_signals(
         unique_key, source, company_name, signal_type, signal_strength, score_weight,
         evidence, metadata_json, detected_at, created_at
       ) VALUES(?,?,?,?,?,?,?,?,?,?)""",
    (
      unique_key,
      signal["source"],
      signal["company_name"],
      signal["signal_type"],
      signal["signal_strength"],
      int(signal["score_weight"]),
      signal.get("evidence"),
      json.dumps(signal.get("metadata") or {}),
      signal["detected_at"],
      datetime.now(timezone.utc).isoformat(),
    ),
  )
  return cur.rowcount > 0

def score_icp(vertical, tier, status):
  icp = 0
  if vertical in sweet_spots:
    icp += 40
  if tier in tier_points:
    icp += tier_points[tier]
  if status in status_points:
    icp += status_points[status]
  return int(min(icp, 100))

def score_signal(company_name):
  cur.execute(
    """SELECT signal_type, signal_strength, score_weight, detected_at
       FROM bi_signals
       WHERE lower(company_name)=lower(?)
       ORDER BY detected_at DESC
       LIMIT 30""",
    (company_name,),
  )
  rows = cur.fetchall()
  now_dt = datetime.now(timezone.utc)
  total = 0.0
  for r in rows:
    detected = parse_iso_or_now(r["detected_at"])
    age_days = max(0.0, (now_dt - detected).total_seconds() / 86400.0)
    recency = max(0.25, 1.0 - (age_days / 120.0) * 0.75)
    mult = strength_mult.get(str(r["signal_strength"] or "medium"), 1.0)
    total += float(r["score_weight"] or 0) * recency * mult
  return int(min(round(total), 100))

processed = 0
inserted = 0
updated = 0
unchanged = 0
signals_added = 0
inserted_examples = []
updated_examples = []

try:
  if source_log_path and os.path.exists(source_log_path):
    with open(source_log_path, "r", encoding="utf-8", errors="ignore") as f:
      lines = [line.strip() for line in f if line.strip()]
    for line in lines[-2000:]:
      try:
        row = json.loads(line)
      except Exception:
        continue
      for sig in derive_signals(row):
        if add_signal(sig):
          signals_added += 1

  cur.execute(
    "SELECT id, company_name, domain, vertical, tier, status, notes FROM targets WHERE company_name IS NOT NULL AND TRIM(company_name) != ''"
  )
  rows = cur.fetchall()
  for r in rows:
    processed += 1
    name = (r["company_name"] or "").strip()
    if not name:
      continue
    domain = (r["domain"] or None)
    vertical = (r["vertical"] or None)
    tier = (r["tier"] or None)
    status = (r["status"] or "new")
    notes = (r["notes"] or None)

    icp = score_icp(vertical, tier, status)
    signal = score_signal(name)
    engagement = 0
    prospect = int(min(round(icp * 0.65 + signal * 0.35 + engagement * 0.0), 100))

    cur.execute(
      "SELECT id, name, domain, vertical, tier, status, notes, prospect_score, icp_fit_score, signal_score, engagement_score FROM bi_companies WHERE source_target_id = ?",
      (r["id"],),
    )
    existing = cur.fetchone()
    ts = datetime.now(timezone.utc).isoformat()

    if existing:
      same = (
        existing["name"] == name and
        existing["domain"] == domain and
        existing["vertical"] == vertical and
        existing["tier"] == tier and
        existing["status"] == status and
        existing["notes"] == notes and
        int(existing["prospect_score"] or 0) == prospect and
        int(existing["icp_fit_score"] or 0) == icp and
        int(existing["signal_score"] or 0) == signal and
        int(existing["engagement_score"] or 0) == engagement
      )
      if same:
        unchanged += 1
      else:
        cur.execute(
          """UPDATE bi_companies
             SET name=?, domain=?, vertical=?, tier=?, status=?, notes=?,
                 prospect_score=?, icp_fit_score=?, signal_score=?, engagement_score=?,
                 score_updated_at=?, updated_at=?
             WHERE source_target_id=?""",
          (name, domain, vertical, tier, status, notes, prospect, icp, signal, engagement, ts, ts, r["id"]),
        )
        updated += 1
        if len(updated_examples) < 8:
          updated_examples.append(name)
    else:
      cur.execute(
        """INSERT INTO bi_companies(
             source_target_id, name, domain, vertical, tier, status, notes,
             prospect_score, icp_fit_score, signal_score, engagement_score,
             score_updated_at, created_at, updated_at
           ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (r["id"], name, domain, vertical, tier, status, notes, prospect, icp, signal, engagement, ts, ts, ts),
      )
      inserted += 1
      if len(inserted_examples) < 8:
        inserted_examples.append(name)

  cur.execute(
    "UPDATE bi_runs SET status='completed', completed_at=?, processed=?, inserted=?, updated=?, unchanged=?, signals_added=? WHERE id=?",
    (datetime.now(timezone.utc).isoformat(), processed, inserted, updated, unchanged, signals_added, run_id),
  )
  conn.commit()
  print(json.dumps({
    "backend": "sqlite",
    "db_path": db_path,
    "processed": processed,
    "inserted": inserted,
    "updated": updated,
    "unchanged": unchanged,
    "signals_added": signals_added,
    "inserted_examples": inserted_examples,
    "updated_examples": updated_examples,
  }))
except Exception as e:
  cur.execute(
    "UPDATE bi_runs SET status='failed', completed_at=?, processed=?, inserted=?, updated=?, unchanged=?, signals_added=?, failed=1, error_log=? WHERE id=?",
    (datetime.now(timezone.utc).isoformat(), processed, inserted, updated, unchanged, signals_added, str(e), run_id),
  )
  conn.commit()
  raise
finally:
  conn.close()
`.trim();
}

export async function runSqliteCycle(): Promise<SqliteCycleResult> {
  const pythonBin = process.env.PYTHON_BIN || 'python';
  const sqlitePathRaw = process.env.BI_SQLITE_PATH || process.env.OUTREACH_DB_PATH || '../data/outreach.db';
  const sqlitePath = resolvePath(sqlitePathRaw);
  const sourceLogRaw = process.env.BI_SOURCE_LOG_PATH || './data/source_runs.jsonl';
  const sourceLogPath = resolvePath(sourceLogRaw);

  const started = Date.now();
  const { stdout } = await execFileAsync(pythonBin, ['-c', pyCode(), sqlitePath, sourceLogPath], {
    maxBuffer: 15 * 1024 * 1024,
  });
  const parsed = JSON.parse(stdout.trim()) as Omit<SqliteCycleResult, 'duration_ms'>;
  return { ...parsed, duration_ms: Date.now() - started };
}

export function startSqliteLoop(options: { beforeCycle?: () => Promise<void> } = {}): { stop: () => void } {
  const minutes = Number(process.env.COLLECTOR_INTERVAL_MINUTES || '15');
  const intervalMs = Math.max(1, minutes) * 60 * 1000;
  let timer: NodeJS.Timeout | null = null;
  let running = false;
  let stopped = false;

  const tick = async (): Promise<void> => {
    if (running || stopped) return;
    running = true;
    const tickStart = new Date();
    console.log(`[sqlite-bi] cycle start ${tickStart.toISOString()}`);
    try {
      if (options.beforeCycle) await options.beforeCycle();
      const result = await runSqliteCycle();
      const nextRunAt = new Date(Date.now() + intervalMs).toISOString();
      console.log(
        `[sqlite-bi] cycle ok processed=${result.processed} inserted=${result.inserted} updated=${result.updated} unchanged=${result.unchanged} signals_added=${result.signals_added} duration_ms=${result.duration_ms} next=${nextRunAt}`
      );
      if ((result.inserted_examples || []).length > 0) {
        console.log(`[sqlite-bi] inserted_companies: ${(result.inserted_examples || []).join(', ')}`);
      }
      if ((result.updated_examples || []).length > 0) {
        console.log(`[sqlite-bi] updated_companies: ${(result.updated_examples || []).join(', ')}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[sqlite-bi] cycle failed: ${msg}`);
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
