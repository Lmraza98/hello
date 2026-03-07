from __future__ import annotations

import csv
import io
import json
from datetime import datetime, timezone
from typing import Any

import config
import database


def _utcnow_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _current_period_ym() -> str:
    return datetime.now(timezone.utc).strftime('%Y-%m')


def ensure_leadforge_tables() -> None:
    with database.get_db() as conn:
        cur = conn.cursor()
        cur.execute(
            '''
            CREATE TABLE IF NOT EXISTS lead_runs (
                id TEXT PRIMARY KEY,
                prompt TEXT NOT NULL,
                criteria_json TEXT,
                user_id TEXT,
                status TEXT NOT NULL DEFAULT 'running',
                started_at TEXT NOT NULL,
                completed_at TEXT,
                error TEXT,
                credits_charged INTEGER NOT NULL DEFAULT 0,
                cost_estimate_usd REAL DEFAULT 0
            )
            '''
        )
        cur.execute(
            '''
            CREATE TABLE IF NOT EXISTS leads (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                run_id TEXT NOT NULL,
                name TEXT,
                company_name TEXT,
                domain TEXT,
                email TEXT,
                phone TEXT,
                title TEXT,
                location TEXT,
                source_type TEXT,
                rating REAL,
                review_count INTEGER,
                score_total REAL,
                score_breakdown_json TEXT,
                dedupe_key TEXT,
                created_at TEXT NOT NULL,
                FOREIGN KEY(run_id) REFERENCES lead_runs(id)
            )
            '''
        )
        cur.execute(
            '''
            CREATE TABLE IF NOT EXISTS lead_evidence (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                lead_id INTEGER NOT NULL,
                kind TEXT,
                url TEXT,
                title TEXT,
                snippet TEXT,
                tool_name TEXT,
                captured_at TEXT NOT NULL,
                confidence REAL,
                FOREIGN KEY(lead_id) REFERENCES leads(id)
            )
            '''
        )
        cur.execute(
            '''
            CREATE TABLE IF NOT EXISTS lead_dedupe_keys (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                lead_id INTEGER NOT NULL,
                normalized_domain TEXT,
                normalized_phone TEXT,
                normalized_email TEXT,
                normalized_company TEXT,
                FOREIGN KEY(lead_id) REFERENCES leads(id)
            )
            '''
        )
        cur.execute(
            '''
            CREATE TABLE IF NOT EXISTS lead_credit_usage (
                user_id TEXT NOT NULL,
                period_ym TEXT NOT NULL,
                leads_used INTEGER NOT NULL DEFAULT 0,
                updated_at TEXT NOT NULL,
                PRIMARY KEY (user_id, period_ym)
            )
            '''
        )
        # Lightweight schema migration for existing DBs.
        cur.execute('PRAGMA table_info(lead_runs)')
        cols = {str(r[1]) for r in cur.fetchall() or []}
        if 'user_id' not in cols:
            cur.execute("ALTER TABLE lead_runs ADD COLUMN user_id TEXT")
        if 'credits_charged' not in cols:
            cur.execute("ALTER TABLE lead_runs ADD COLUMN credits_charged INTEGER NOT NULL DEFAULT 0")

        cur.execute('PRAGMA table_info(leads)')
        lead_cols = {str(r[1]) for r in cur.fetchall() or []}
        if 'rating' not in lead_cols:
            cur.execute("ALTER TABLE leads ADD COLUMN rating REAL")
        if 'review_count' not in lead_cols:
            cur.execute("ALTER TABLE leads ADD COLUMN review_count INTEGER")
        cur.execute('CREATE INDEX IF NOT EXISTS idx_lead_runs_user_started ON lead_runs(user_id, started_at DESC)')
        cur.execute('CREATE INDEX IF NOT EXISTS idx_lead_credit_usage_period ON lead_credit_usage(period_ym, user_id)')
        cur.execute('CREATE INDEX IF NOT EXISTS idx_lead_runs_started ON lead_runs(started_at DESC)')
        cur.execute('CREATE INDEX IF NOT EXISTS idx_leads_run ON leads(run_id, id DESC)')
        cur.execute('CREATE INDEX IF NOT EXISTS idx_lead_evidence_lead ON lead_evidence(lead_id, id DESC)')
        cur.execute('CREATE INDEX IF NOT EXISTS idx_lead_dedupe_lead ON lead_dedupe_keys(lead_id)')


def persist_run_summary(
    *,
    run_id: str,
    prompt: str,
    criteria: dict[str, Any],
    status: str,
    user_id: str | None = None,
    error: str | None = None,
    cost_estimate_usd: float = 0.0,
) -> None:
    ensure_leadforge_tables()
    normalized_user_id = (user_id or config.LEADFORGE_DEFAULT_USER_ID).strip() or config.LEADFORGE_DEFAULT_USER_ID
    with database.get_db() as conn:
        cur = conn.cursor()
        cur.execute('SELECT id FROM lead_runs WHERE id = ?', (run_id,))
        existing = cur.fetchone()
        now = _utcnow_iso()
        if existing:
            cur.execute(
                '''
                UPDATE lead_runs
                SET prompt = ?, criteria_json = ?, status = ?, completed_at = CASE WHEN ? IN ('completed','failed','cancelled') THEN ? ELSE completed_at END,
                    user_id = COALESCE(user_id, ?), error = ?, cost_estimate_usd = ?
                WHERE id = ?
                ''',
                (
                    prompt,
                    json.dumps(criteria or {}, ensure_ascii=True),
                    status,
                    status,
                    now,
                    normalized_user_id,
                    error,
                    float(cost_estimate_usd or 0.0),
                    run_id,
                ),
            )
        else:
            cur.execute(
                '''
                INSERT INTO lead_runs (id, prompt, criteria_json, user_id, status, started_at, completed_at, error, credits_charged, cost_estimate_usd)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
                ''',
                (
                    run_id,
                    prompt,
                    json.dumps(criteria or {}, ensure_ascii=True),
                    normalized_user_id,
                    status,
                    now,
                    now if status in {'completed', 'failed', 'cancelled'} else None,
                    error,
                    float(cost_estimate_usd or 0.0),
                ),
            )


def replace_run_leads(run_id: str, leads: list[dict[str, Any]]) -> int:
    ensure_leadforge_tables()
    with database.get_db() as conn:
        cur = conn.cursor()
        cur.execute(
            '''
            DELETE FROM lead_evidence WHERE lead_id IN (SELECT id FROM leads WHERE run_id = ?)
            ''',
            (run_id,),
        )
        cur.execute('DELETE FROM lead_dedupe_keys WHERE lead_id IN (SELECT id FROM leads WHERE run_id = ?)', (run_id,))
        cur.execute('DELETE FROM leads WHERE run_id = ?', (run_id,))

        inserted = 0
        for lead in leads:
            breakdown = lead.get('score_breakdown') or {}
            dedupe_key = str(lead.get('dedupe_key') or '').strip() or None
            cur.execute(
                '''
                INSERT INTO leads (
                    run_id, name, company_name, domain, email, phone, title, location,
                    source_type, rating, review_count, score_total, score_breakdown_json, dedupe_key, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ''',
                (
                    run_id,
                    (lead.get('name') or '').strip() or None,
                    (lead.get('company_name') or '').strip() or None,
                    (lead.get('domain') or '').strip() or None,
                    (lead.get('email') or '').strip() or None,
                    (lead.get('phone') or '').strip() or None,
                    (lead.get('title') or '').strip() or None,
                    (lead.get('location') or '').strip() or None,
                    (lead.get('source_type') or '').strip() or None,
                    float(lead.get('rating')) if lead.get('rating') is not None else None,
                    int(lead.get('review_count')) if lead.get('review_count') is not None else None,
                    float(lead.get('score_total') or 0.0),
                    json.dumps(breakdown, ensure_ascii=True),
                    dedupe_key,
                    _utcnow_iso(),
                ),
            )
            lead_id = int(cur.lastrowid)
            inserted += 1

            normalized_domain = ((lead.get('domain') or '').strip().lower()) or None
            normalized_email = ((lead.get('email') or '').strip().lower()) or None
            normalized_phone = ''.join(ch for ch in str(lead.get('phone') or '') if ch.isdigit()) or None
            normalized_company = ((lead.get('company_name') or '').strip().lower()) or None
            cur.execute(
                '''
                INSERT INTO lead_dedupe_keys (
                    lead_id, normalized_domain, normalized_phone, normalized_email, normalized_company
                ) VALUES (?, ?, ?, ?, ?)
                ''',
                (lead_id, normalized_domain, normalized_phone, normalized_email, normalized_company),
            )

            for ev in lead.get('evidence', []) or []:
                cur.execute(
                    '''
                    INSERT INTO lead_evidence (
                        lead_id, kind, url, title, snippet, tool_name, captured_at, confidence
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    ''',
                    (
                        lead_id,
                        (ev.get('kind') or '').strip() or None,
                        (ev.get('url') or '').strip() or None,
                        (ev.get('title') or '').strip() or None,
                        (ev.get('snippet') or '').strip() or None,
                        (ev.get('tool_name') or '').strip() or None,
                        _utcnow_iso(),
                        float(ev.get('confidence') or 0.0),
                    ),
                )

    return inserted


def list_run_leads(run_id: str) -> list[dict[str, Any]]:
    ensure_leadforge_tables()
    with database.get_db() as conn:
        cur = conn.cursor()
        cur.execute(
            '''
            SELECT id, run_id, name, company_name, domain, email, phone, title, location,
                   source_type, rating, review_count, score_total, score_breakdown_json, dedupe_key, created_at
            FROM leads
            WHERE run_id = ?
            ORDER BY score_total DESC, id DESC
            ''',
            (run_id,),
        )
        rows = cur.fetchall() or []

        out: list[dict[str, Any]] = []
        for row in rows:
            out.append(
                {
                    'id': row['id'],
                    'run_id': row['run_id'],
                    'name': row['name'],
                    'company_name': row['company_name'],
                    'domain': row['domain'],
                    'email': row['email'],
                    'phone': row['phone'],
                    'title': row['title'],
                    'location': row['location'],
                    'source_type': row['source_type'],
                    'rating': row['rating'],
                    'review_count': row['review_count'],
                    'score_total': row['score_total'],
                    'score_breakdown': json.loads(row['score_breakdown_json'] or '{}'),
                    'dedupe_key': row['dedupe_key'],
                    'created_at': row['created_at'],
                }
            )
        return out


def list_run_evidence(run_id: str) -> list[dict[str, Any]]:
    ensure_leadforge_tables()
    with database.get_db() as conn:
        cur = conn.cursor()
        cur.execute(
            '''
            SELECT le.id, le.lead_id, le.kind, le.url, le.title, le.snippet, le.tool_name, le.captured_at, le.confidence,
                   l.company_name, l.name
            FROM lead_evidence le
            JOIN leads l ON l.id = le.lead_id
            WHERE l.run_id = ?
            ORDER BY le.id DESC
            ''',
            (run_id,),
        )
        rows = cur.fetchall() or []
        return [dict(r) for r in rows]


def list_leads_by_ids(lead_ids: list[int]) -> list[dict[str, Any]]:
    ensure_leadforge_tables()
    if not lead_ids:
        return []
    normalized = [int(x) for x in lead_ids if isinstance(x, int)]
    if not normalized:
        return []
    placeholders = ','.join('?' for _ in normalized)
    with database.get_db() as conn:
        cur = conn.cursor()
        cur.execute(
            f'''
            SELECT id, run_id, name, company_name, domain, email, phone, title, location,
                   source_type, rating, review_count, score_total, score_breakdown_json, dedupe_key, created_at
            FROM leads
            WHERE id IN ({placeholders})
            ORDER BY score_total DESC, id DESC
            ''',
            tuple(normalized),
        )
        rows = cur.fetchall() or []
    out: list[dict[str, Any]] = []
    for row in rows:
        out.append(
            {
                'id': row['id'],
                'run_id': row['run_id'],
                'name': row['name'],
                'company_name': row['company_name'],
                'domain': row['domain'],
                'email': row['email'],
                'phone': row['phone'],
                'title': row['title'],
                'location': row['location'],
                'source_type': row['source_type'],
                'rating': row['rating'],
                'review_count': row['review_count'],
                'score_total': row['score_total'],
                'score_breakdown': json.loads(row['score_breakdown_json'] or '{}'),
                'dedupe_key': row['dedupe_key'],
                'created_at': row['created_at'],
            }
        )
    return out


def get_credit_summary(user_id: str | None = None, monthly_limit: int | None = None) -> dict[str, Any]:
    ensure_leadforge_tables()
    normalized_user_id = (user_id or config.LEADFORGE_DEFAULT_USER_ID).strip() or config.LEADFORGE_DEFAULT_USER_ID
    limit = int(monthly_limit if monthly_limit is not None else config.LEADFORGE_FREE_LEADS_PER_MONTH)
    period_ym = _current_period_ym()
    with database.get_db() as conn:
        cur = conn.cursor()
        cur.execute(
            '''
            SELECT leads_used
            FROM lead_credit_usage
            WHERE user_id = ? AND period_ym = ?
            ''',
            (normalized_user_id, period_ym),
        )
        row = cur.fetchone()
        used = int(row['leads_used']) if row else 0
    remaining = max(0, limit - used)
    return {
        'user_id': normalized_user_id,
        'period_ym': period_ym,
        'monthly_limit': limit,
        'used': used,
        'remaining': remaining,
    }


def charge_run_credits(run_id: str, monthly_limit: int | None = None) -> dict[str, Any]:
    ensure_leadforge_tables()
    limit = int(monthly_limit if monthly_limit is not None else config.LEADFORGE_FREE_LEADS_PER_MONTH)
    period_ym = _current_period_ym()
    now = _utcnow_iso()
    with database.get_db() as conn:
        cur = conn.cursor()
        cur.execute(
            '''
            SELECT user_id, credits_charged
            FROM lead_runs
            WHERE id = ?
            ''',
            (run_id,),
        )
        run = cur.fetchone()
        if not run:
            raise ValueError('run_not_found')
        user_id = (run['user_id'] or config.LEADFORGE_DEFAULT_USER_ID).strip() or config.LEADFORGE_DEFAULT_USER_ID
        already_charged = int(run['credits_charged'] or 0)
        if already_charged > 0:
            summary = get_credit_summary(user_id=user_id, monthly_limit=limit)
            return {'charged': already_charged, 'run_id': run_id, **summary}

        cur.execute('SELECT COUNT(*) AS total FROM leads WHERE run_id = ?', (run_id,))
        total_row = cur.fetchone()
        total = int((total_row['total'] if total_row else 0) or 0)

        cur.execute(
            '''
            SELECT leads_used
            FROM lead_credit_usage
            WHERE user_id = ? AND period_ym = ?
            ''',
            (user_id, period_ym),
        )
        usage = cur.fetchone()
        used = int(usage['leads_used']) if usage else 0
        remaining = max(0, limit - used)
        charged = min(total, remaining)

        if usage:
            cur.execute(
                '''
                UPDATE lead_credit_usage
                SET leads_used = ?, updated_at = ?
                WHERE user_id = ? AND period_ym = ?
                ''',
                (used + charged, now, user_id, period_ym),
            )
        else:
            cur.execute(
                '''
                INSERT INTO lead_credit_usage (user_id, period_ym, leads_used, updated_at)
                VALUES (?, ?, ?, ?)
                ''',
                (user_id, period_ym, charged, now),
            )

        cur.execute(
            '''
            UPDATE lead_runs
            SET credits_charged = ?
            WHERE id = ?
            ''',
            (charged, run_id),
        )

    summary = get_credit_summary(user_id=user_id, monthly_limit=limit)
    return {'charged': charged, 'run_id': run_id, **summary}


def export_leads_csv(*, run_id: str | None = None, lead_ids: list[int] | None = None) -> tuple[str, str]:
    ensure_leadforge_tables()
    with database.get_db() as conn:
        cur = conn.cursor()
        if lead_ids:
            placeholders = ','.join('?' for _ in lead_ids)
            cur.execute(
                f'''
                SELECT id, run_id, name, company_name, domain, email, phone, title, location, source_type, rating, review_count, score_total, created_at
                FROM leads
                WHERE id IN ({placeholders})
                ORDER BY score_total DESC, id DESC
                ''',
                tuple(lead_ids),
            )
        else:
            cur.execute(
                '''
                SELECT id, run_id, name, company_name, domain, email, phone, title, location, source_type, rating, review_count, score_total, created_at
                FROM leads
                WHERE run_id = ?
                ORDER BY score_total DESC, id DESC
                ''',
                (run_id or '',),
            )
        rows = cur.fetchall() or []

    output = io.StringIO()
    writer = csv.DictWriter(
        output,
        fieldnames=[
            'lead_id',
            'run_id',
            'name',
            'company_name',
            'domain',
            'email',
            'phone',
            'title',
            'location',
            'source_type',
            'rating',
            'review_count',
            'score_total',
            'created_at',
        ],
    )
    writer.writeheader()
    for r in rows:
        row = dict(r)
        row['lead_id'] = row.pop('id', None)
        writer.writerow(row)

    filename = f'leadforge_export_{datetime.now().strftime("%Y%m%d_%H%M%S")}.csv'
    return filename, output.getvalue()


def save_leads_to_contacts(lead_ids: list[int]) -> dict[str, int]:
    ensure_leadforge_tables()
    if not lead_ids:
        return {'saved': 0, 'skipped': 0, 'duplicates': 0}

    saved = 0
    skipped = 0
    duplicates = 0

    with database.get_db() as conn:
        cur = conn.cursor()
        placeholders = ','.join('?' for _ in lead_ids)
        cur.execute(
            f'''
            SELECT id, run_id, name, company_name, domain, email, phone, title
            FROM leads
            WHERE id IN ({placeholders})
            ''',
            tuple(lead_ids),
        )
        rows = cur.fetchall() or []

    for row in rows:
        lead_name = (row['name'] or '').strip() or 'Unknown Lead'
        lead_company = (row['company_name'] or '').strip() or 'LeadForge'
        lead_email = (row['email'] or '').strip() or None
        lead_phone = (row['phone'] or '').strip() or None
        lead_title = (row['title'] or '').strip() or None
        run_id = str(row['run_id'] or '').strip() or None

        try:
            _, created = database.upsert_inbound_lead_contact(
                lead_name=lead_name,
                lead_company=lead_company,
                lead_email=lead_email,
                lead_phone=lead_phone,
                lead_title=lead_title,
                lead_source='leadforge',
                ingest_batch_id=run_id,
            )
            if created:
                saved += 1
            else:
                duplicates += 1
        except Exception:
            skipped += 1

    return {'saved': saved, 'skipped': skipped, 'duplicates': duplicates}
