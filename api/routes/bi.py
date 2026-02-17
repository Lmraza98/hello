"""BI data-layer monitoring endpoints for SQLite-backed BI layer."""

from __future__ import annotations

import datetime as dt
import json
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

import config
import database as db

BI_PREFIX = "/api/bi"
router = APIRouter(tags=["bi"])
SOURCES_ENV_PATH = config.BASE_DIR / "zco-bi" / "config" / "sources.env"
SOURCE_LOG_PATH = config.BASE_DIR / "zco-bi" / "data" / "source_runs.jsonl"
SOURCE_STATE_PATH = config.BASE_DIR / "zco-bi" / "data" / "source_state.json"

ALLOWED_SOURCE_CONFIG_KEYS = {
    "COLLECTOR_INTERVAL_MINUTES",
    "BI_SOURCE_COMPANY_POOL_LIMIT",
    "SALESNAV_ENABLED",
    "SALESNAV_SAFE_MODE",
    "SALESNAV_MAX_QUERIES_PER_CYCLE",
    "SALESNAV_INTER_QUERY_DELAY_MS",
    "SALESNAV_MIN_INTERVAL_MINUTES",
    "SALESNAV_DAILY_MAX_REQUESTS",
    "SALESNAV_REQUEST_TIMEOUT_MS",
    "SALESNAV_COLLECT_URL",
    "SALESNAV_QUERIES",
    "SALESNAV_MAX_COMPANIES",
    "APPSTORE_ENABLED",
    "APPSTORE_MAX_COMPANIES_PER_CYCLE",
    "APPSTORE_MIN_NAME_OVERLAP_RATIO",
    "PLAYSTORE_ENABLED",
    "PLAYSTORE_MAX_COMPANIES_PER_CYCLE",
    "GOOGLE_NEWS_ENABLED",
    "GOOGLE_NEWS_MAX_COMPANIES_PER_CYCLE",
    "CRUNCHBASE_ENABLED",
    "CRUNCHBASE_MAX_COMPANIES_PER_CYCLE",
    "CRUNCHBASE_ORG_URL_TEMPLATE",
    "WEBSITE_SIGNALS_ENABLED",
    "WEBSITE_SIGNALS_MAX_COMPANIES_PER_CYCLE",
    "JOB_POSTINGS_ENABLED",
    "JOB_POSTINGS_COLLECT_URL",
    "JOB_POSTINGS_MAX_COMPANIES_PER_CYCLE",
    "JOB_POSTINGS_MAX_RESULTS",
    "JOB_POSTINGS_TIMEOUT_MS",
}


class BiSourceConfigUpdateRequest(BaseModel):
    values: dict[str, str]


def _safe_table_exists(cursor, table_name: str) -> bool:
    cursor.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name = ? LIMIT 1",
        (table_name,),
    )
    return cursor.fetchone() is not None


def _parse_ts(value: str | None) -> dt.datetime | None:
    if not value:
        return None
    try:
        parsed = dt.datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            return parsed.replace(tzinfo=dt.timezone.utc)
        return parsed.astimezone(dt.timezone.utc)
    except Exception:
        return None


def _load_source_runs(limit: int | None = None) -> list[dict[str, Any]]:
    if not SOURCE_LOG_PATH.exists():
        return []
    lines = SOURCE_LOG_PATH.read_text(encoding="utf-8", errors="ignore").splitlines()
    if limit is not None and limit > 0:
        lines = lines[-limit:]

    out: list[dict[str, Any]] = []
    for line in lines:
        if not line.strip():
            continue
        try:
            out.append(json.loads(line))
        except Exception:
            out.append({"parse_error": True, "raw": line})
    return out


def _source_status(failed: int, runs: int) -> str:
    if runs == 0:
        return "idle"
    ratio = failed / max(runs, 1)
    if ratio >= 0.5 and runs >= 3:
        return "failed"
    if failed > 0:
        return "degraded"
    return "ok"


def _read_sources_env() -> dict[str, str]:
    if not SOURCES_ENV_PATH.exists():
        return {}
    out: dict[str, str] = {}
    for line in SOURCES_ENV_PATH.read_text(encoding="utf-8", errors="ignore").splitlines():
        raw = line.strip()
        if not raw or raw.startswith("#") or "=" not in raw:
            continue
        key, value = raw.split("=", 1)
        out[key.strip()] = value.strip()
    return out


def _write_sources_env_updates(updates: dict[str, str]) -> int:
    if not SOURCES_ENV_PATH.exists():
        raise HTTPException(status_code=404, detail=f"Config file not found: {SOURCES_ENV_PATH}")

    lines = SOURCES_ENV_PATH.read_text(encoding="utf-8", errors="ignore").splitlines()
    changed = 0
    seen: set[str] = set()

    for idx, line in enumerate(lines):
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in line:
            continue
        key, _ = line.split("=", 1)
        key = key.strip()
        if key in updates:
            new_line = f"{key}={updates[key]}"
            if new_line != line:
                lines[idx] = new_line
                changed += 1
            seen.add(key)

    for key, value in updates.items():
        if key not in seen:
            lines.append(f"{key}={value}")
            changed += 1

    SOURCES_ENV_PATH.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return changed


@router.get(f"{BI_PREFIX}/overview")
def get_bi_overview():
    now = dt.datetime.now(dt.timezone.utc)
    source_runs = [r for r in _load_source_runs() if not r.get("parse_error")]
    runs_24h = [r for r in source_runs if (_parse_ts(r.get("started_at")) or dt.datetime.min.replace(tzinfo=dt.timezone.utc)) >= now - dt.timedelta(hours=24)]
    runs_1h = [r for r in source_runs if (_parse_ts(r.get("started_at")) or dt.datetime.min.replace(tzinfo=dt.timezone.utc)) >= now - dt.timedelta(hours=1)]

    failures_24h = sum(1 for r in runs_24h if not bool(r.get("ok")))
    total_24h = len(runs_24h)
    error_rate_24h = round((failures_24h / total_24h) * 100, 1) if total_24h > 0 else 0.0

    by_source_failures: dict[str, int] = {}
    for r in runs_24h:
        src = str(r.get("source") or "unknown")
        if not bool(r.get("ok")):
            by_source_failures[src] = by_source_failures.get(src, 0) + 1
    top_failing_source = None
    if by_source_failures:
        top_failing_source = sorted(by_source_failures.items(), key=lambda x: x[1], reverse=True)[0][0]

    last_successful_source_run = None
    successful_runs = [r for r in source_runs if bool(r.get("ok"))]
    if successful_runs:
        latest = max(successful_runs, key=lambda x: (_parse_ts(x.get("completed_at")) or dt.datetime.min.replace(tzinfo=dt.timezone.utc)))
        last_successful_source_run = latest.get("completed_at")

    with db.get_db() as conn:
        cursor = conn.cursor()

        freshness: dict[str, Any] = {
            "median_age_minutes": None,
            "p95_age_minutes": None,
            "companies_refreshed_1h": 0,
        }
        if _safe_table_exists(cursor, "bi_companies"):
            cursor.execute("SELECT updated_at FROM bi_companies WHERE updated_at IS NOT NULL")
            ages: list[float] = []
            for row in cursor.fetchall():
                ts = _parse_ts(row["updated_at"])
                if ts is None:
                    continue
                ages.append(max(0.0, (now - ts).total_seconds() / 60.0))
            if ages:
                sorted_ages = sorted(ages)
                median = sorted_ages[len(sorted_ages) // 2]
                p95 = sorted_ages[min(len(sorted_ages) - 1, int(len(sorted_ages) * 0.95))]
                freshness["median_age_minutes"] = round(median, 1)
                freshness["p95_age_minutes"] = round(p95, 1)

            cursor.execute("SELECT COUNT(*) AS cnt FROM bi_companies WHERE updated_at >= datetime('now', '-1 hour')")
            freshness["companies_refreshed_1h"] = int(cursor.fetchone()["cnt"])

        normalized_1h = 0
        ingestion_health = "healthy"
        if _safe_table_exists(cursor, "bi_runs"):
            cursor.execute("PRAGMA table_info(bi_runs)")
            cols = {r["name"] for r in cursor.fetchall()}
            if "signals_added" in cols:
                cursor.execute("SELECT COALESCE(SUM(signals_added),0) AS cnt FROM bi_runs WHERE started_at >= datetime('now', '-1 hour')")
                normalized_1h = int(cursor.fetchone()["cnt"])
            cursor.execute("SELECT MAX(completed_at) AS last_ok FROM bi_runs WHERE status='completed'")
            last_ok = cursor.fetchone()["last_ok"]
            last_ok_ts = _parse_ts(last_ok)
            if last_ok_ts is None or (now - last_ok_ts) > dt.timedelta(hours=2):
                ingestion_health = "down"
            elif error_rate_24h >= 30:
                ingestion_health = "degraded"

    events_1h_collected = sum(int(r.get("collected") or 0) for r in runs_1h)
    events_1h_saved = sum(int(r.get("saved") or 0) for r in runs_1h)
    events_1h_deduped = max(0, events_1h_collected - events_1h_saved)

    return {
        "ingestion_status": ingestion_health,
        "last_successful_source_run": last_successful_source_run,
        "freshness": freshness,
        "events_1h": {
            "collected": events_1h_collected,
            "saved": events_1h_saved,
            "deduped": events_1h_deduped,
            "normalized": normalized_1h,
        },
        "error_rate_24h": error_rate_24h,
        "top_failing_source_24h": top_failing_source,
    }


@router.get(f"{BI_PREFIX}/sources")
def get_bi_sources():
    now = dt.datetime.now(dt.timezone.utc)
    source_runs = [r for r in _load_source_runs() if not r.get("parse_error")]
    runs_24h = [r for r in source_runs if (_parse_ts(r.get("started_at")) or dt.datetime.min.replace(tzinfo=dt.timezone.utc)) >= now - dt.timedelta(hours=24)]
    env = _read_sources_env()

    by_source: dict[str, dict[str, Any]] = {}
    for row in runs_24h:
        source = str(row.get("source") or "unknown")
        bucket = by_source.setdefault(
            source,
            {
                "source": source,
                "runs_24h": 0,
                "ok_24h": 0,
                "failed_24h": 0,
                "collected_24h": 0,
                "saved_24h": 0,
                "last_run_at": None,
                "last_success_at": None,
            },
        )
        bucket["runs_24h"] += 1
        if bool(row.get("ok")):
            bucket["ok_24h"] += 1
            bucket["last_success_at"] = row.get("completed_at") or bucket["last_success_at"]
        else:
            bucket["failed_24h"] += 1
        bucket["collected_24h"] += int(row.get("collected") or 0)
        bucket["saved_24h"] += int(row.get("saved") or 0)
        bucket["last_run_at"] = row.get("started_at") or bucket["last_run_at"]

    source_state = {}
    if SOURCE_STATE_PATH.exists():
        try:
            source_state = json.loads(SOURCE_STATE_PATH.read_text(encoding="utf-8", errors="ignore"))
        except Exception:
            source_state = {}

    out_sources: list[dict[str, Any]] = []
    for source, bucket in sorted(by_source.items(), key=lambda x: x[0]):
        runs = int(bucket["runs_24h"])
        failed = int(bucket["failed_24h"])
        ok = int(bucket["ok_24h"])
        success_rate = round((ok / runs) * 100, 1) if runs > 0 else 0.0
        out_sources.append(
            {
                **bucket,
                "status": _source_status(failed, runs),
                "success_rate_24h": success_rate,
            }
        )

    salesnav_used_today = 0
    today = now.date().isoformat()
    for row in source_runs:
        if str(row.get("source")) == "salesnav" and str(row.get("started_at") or "").startswith(today):
            salesnav_used_today += 1

    return {
        "sources": out_sources,
        "salesnav_daily_requests_used": salesnav_used_today,
        "salesnav_daily_requests_max": int(env.get("SALESNAV_DAILY_MAX_REQUESTS") or 0),
        "collector_interval_minutes": int(env.get("COLLECTOR_INTERVAL_MINUTES") or 15),
        "source_state": source_state,
        "config_path": str(SOURCES_ENV_PATH),
    }


@router.get(f"{BI_PREFIX}/runs")
def get_bi_runs(
    limit: int = Query(default=50, ge=1, le=500),
    status: str | None = None,
):
    with db.get_db() as conn:
        cursor = conn.cursor()
        if not _safe_table_exists(cursor, "bi_runs"):
            return {"results": [], "count": 0}

        cursor.execute("PRAGMA table_info(bi_runs)")
        columns = {row["name"] for row in cursor.fetchall()}
        select_cols = ["id", "status", "started_at", "completed_at", "processed", "inserted", "updated", "failed", "error_log"]
        if "unchanged" in columns:
            select_cols.insert(7, "unchanged")
        if "signals_added" in columns:
            select_cols.insert(8, "signals_added")

        params: list[Any] = []
        where = ""
        if status:
            where = "WHERE status = ?"
            params.append(status)
        params.append(limit)

        cursor.execute(
            f"SELECT {', '.join(select_cols)} FROM bi_runs {where} ORDER BY id DESC LIMIT ?",
            tuple(params),
        )
        rows = [dict(r) for r in cursor.fetchall()]
    return {"results": rows, "count": len(rows)}


@router.get(f"{BI_PREFIX}/run/{{run_id}}")
def get_bi_run_detail(run_id: int):
    with db.get_db() as conn:
        cursor = conn.cursor()
        if not _safe_table_exists(cursor, "bi_runs"):
            raise HTTPException(status_code=404, detail="bi_runs table not found")
        cursor.execute("SELECT * FROM bi_runs WHERE id = ?", (run_id,))
        row = cursor.fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="run not found")
        run = dict(row)

    started = _parse_ts(run.get("started_at"))
    completed = _parse_ts(run.get("completed_at")) or dt.datetime.now(dt.timezone.utc)
    if started is None:
        started = completed - dt.timedelta(minutes=30)

    source_rows = [r for r in _load_source_runs() if not r.get("parse_error")]
    in_window = []
    for r in source_rows:
        ts = _parse_ts(r.get("started_at"))
        if ts and started <= ts <= completed:
            in_window.append(r)

    breakdown: dict[str, dict[str, Any]] = {}
    errors: list[dict[str, Any]] = []
    for r in in_window:
        source = str(r.get("source") or "unknown")
        bucket = breakdown.setdefault(source, {"source": source, "attempted": 0, "ok": 0, "failed": 0, "collected": 0, "saved": 0})
        bucket["attempted"] += 1
        if bool(r.get("ok")):
            bucket["ok"] += 1
        else:
            bucket["failed"] += 1
            errors.append(
                {
                    "source": source,
                    "started_at": r.get("started_at"),
                    "message": r.get("message"),
                    "http_status": r.get("http_status"),
                }
            )
        bucket["collected"] += int(r.get("collected") or 0)
        bucket["saved"] += int(r.get("saved") or 0)

    return {
        "run": run,
        "source_breakdown": sorted(breakdown.values(), key=lambda x: x["source"]),
        "errors": errors[:100],
    }


@router.get(f"{BI_PREFIX}/companies")
def get_bi_companies(
    q: str | None = None,
    limit: int = Query(default=100, ge=1, le=1000),
):
    source_rows = [r for r in _load_source_runs() if not r.get("parse_error")]
    coverage_by_company: dict[str, set[str]] = {}
    failures_by_company: dict[str, int] = {}
    last_source_at: dict[str, str] = {}

    for r in source_rows:
        name = str(r.get("query") or "").strip().lower()
        if not name:
            continue
        source = str(r.get("source") or "unknown")
        if bool(r.get("ok")) and int(r.get("saved") or 0) > 0:
            coverage_by_company.setdefault(name, set()).add(source)
        if not bool(r.get("ok")):
            failures_by_company[name] = failures_by_company.get(name, 0) + 1
        ts = str(r.get("completed_at") or r.get("started_at") or "")
        if ts:
            last_source_at[name] = ts

    with db.get_db() as conn:
        cursor = conn.cursor()
        if not _safe_table_exists(cursor, "bi_companies"):
            return {"results": [], "count": 0}

        params: list[Any] = []
        where = ""
        if q:
            where = "WHERE LOWER(name) LIKE LOWER(?) OR LOWER(COALESCE(domain,'')) LIKE LOWER(?)"
            like = f"%{q}%"
            params.extend([like, like])
        params.append(limit)
        cursor.execute(
            "SELECT id, name, domain, vertical, tier, status, updated_at, score_updated_at, prospect_score, signal_score "
            f"FROM bi_companies {where} ORDER BY updated_at DESC LIMIT ?",
            tuple(params),
        )
        rows = [dict(r) for r in cursor.fetchall()]

        if _safe_table_exists(cursor, "bi_signals"):
            signal_counts: dict[str, int] = {}
            cursor.execute("SELECT LOWER(company_name) AS company_name, COUNT(*) AS cnt FROM bi_signals GROUP BY LOWER(company_name)")
            for row in cursor.fetchall():
                signal_counts[str(row["company_name"])] = int(row["cnt"])
        else:
            signal_counts = {}

    sources = ["salesnav", "google_news", "appstore", "playstore", "website", "job_postings", "crunchbase"]
    out = []
    for row in rows:
        key = str(row["name"] or "").strip().lower()
        covered = coverage_by_company.get(key, set())
        out.append(
            {
                **row,
                "coverage": {src: src in covered for src in sources},
                "last_collected_at": last_source_at.get(key),
                "last_normalized_at": row.get("score_updated_at"),
                "signal_count": signal_counts.get(key, 0),
                "failing_sources_count": failures_by_company.get(key, 0),
            }
        )

    out.sort(key=lambda x: (x.get("failing_sources_count", 0), x.get("last_collected_at") or ""), reverse=True)
    return {"results": out, "count": len(out)}


@router.get(f"{BI_PREFIX}/companies/{{company_id}}")
def get_bi_company_detail(company_id: int):
    with db.get_db() as conn:
        cursor = conn.cursor()
        if not _safe_table_exists(cursor, "bi_companies"):
            raise HTTPException(status_code=404, detail="bi_companies table not found")
        cursor.execute("SELECT * FROM bi_companies WHERE id = ?", (company_id,))
        row = cursor.fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="company not found")
        company = dict(row)

        signals: list[dict[str, Any]] = []
        if _safe_table_exists(cursor, "bi_signals"):
            cursor.execute(
                "SELECT source, signal_type, signal_strength, score_weight, evidence, detected_at, metadata_json "
                "FROM bi_signals WHERE LOWER(company_name)=LOWER(?) ORDER BY detected_at DESC LIMIT 200",
                (company["name"],),
            )
            for s in cursor.fetchall():
                item = dict(s)
                try:
                    item["metadata"] = json.loads(item.get("metadata_json") or "{}")
                except Exception:
                    item["metadata"] = {}
                signals.append(item)

    source_logs = [r for r in _load_source_runs(limit=5000) if not r.get("parse_error")]
    company_logs = [r for r in source_logs if str(r.get("query") or "").strip().lower() == str(company["name"]).strip().lower()]
    company_logs.sort(key=lambda x: str(x.get("started_at") or ""), reverse=True)

    return {
        "company": company,
        "signals": signals,
        "collection_logs": company_logs[:300],
    }


@router.get(f"{BI_PREFIX}/events")
def get_bi_events(
    source: str | None = None,
    ok: bool | None = None,
    limit: int = Query(default=200, ge=1, le=5000),
):
    rows = _load_source_runs(limit=5000)
    out: list[dict[str, Any]] = []
    for row in reversed(rows):
        if row.get("parse_error"):
            continue
        if source and str(row.get("source") or "") != source:
            continue
        if ok is not None and bool(row.get("ok")) != ok:
            continue
        out.append(row)
        if len(out) >= limit:
            break
    return {"results": out, "count": len(out)}


def _classify_error(message: str | None, http_status: int | None) -> str:
    msg = (message or "").lower()
    if http_status == 429 or "429" in msg or "rate limit" in msg:
        return "rate_limited"
    if "auth" in msg or "unauthorized" in msg or "forbidden" in msg:
        return "auth_failed"
    if "parse" in msg or "json" in msg:
        return "parse_failed"
    if "abort" in msg or "timed out" in msg or "fetch" in msg or "http " in msg:
        return "fetch_failed"
    return "unknown_error"


@router.get(f"{BI_PREFIX}/errors")
def get_bi_errors(
    hours: int = Query(default=24, ge=1, le=168),
):
    now = dt.datetime.now(dt.timezone.utc)
    rows = [r for r in _load_source_runs() if not r.get("parse_error")]
    rows = [
        r
        for r in rows
        if (_parse_ts(r.get("started_at")) or dt.datetime.min.replace(tzinfo=dt.timezone.utc)) >= now - dt.timedelta(hours=hours)
        and not bool(r.get("ok"))
    ]

    grouped: dict[tuple[str, str, str], dict[str, Any]] = {}
    for r in rows:
        source = str(r.get("source") or "unknown")
        message = str(r.get("message") or "")
        err_type = _classify_error(message, r.get("http_status"))
        key = (source, err_type, message[:200])
        bucket = grouped.setdefault(
            key,
            {
                "source": source,
                "error_type": err_type,
                "count": 0,
                "last_occurrence": None,
                "example_message": message,
                "http_status": r.get("http_status"),
            },
        )
        bucket["count"] += 1
        bucket["last_occurrence"] = r.get("started_at") or bucket["last_occurrence"]

    out = sorted(grouped.values(), key=lambda x: (x["count"], x["last_occurrence"] or ""), reverse=True)
    return {"results": out, "count": len(out)}


@router.get(f"{BI_PREFIX}/status")
def get_bi_status(
    top_limit: int = Query(default=5, ge=1, le=50),
    run_limit: int = Query(default=10, ge=1, le=100),
    source_limit: int = Query(default=10, ge=1, le=100),
):
    # Backward-compatible status payload for existing consumers.
    with db.get_db() as conn:
        cursor = conn.cursor()
        has_bi_companies = _safe_table_exists(cursor, "bi_companies")
        has_bi_runs = _safe_table_exists(cursor, "bi_runs")

        out: dict[str, Any] = {
            "db_path": str(config.DB_PATH),
            "has_bi_companies": has_bi_companies,
            "has_bi_runs": has_bi_runs,
            "bi_companies_count": 0,
            "updated_last_hour": 0,
            "top5": [],
            "recent_runs": [],
            "recent_source_runs": _load_source_runs(limit=source_limit),
            "source_summary_24h": get_bi_sources().get("sources", []),
        }

        if has_bi_companies:
            cursor.execute("SELECT COUNT(*) AS cnt FROM bi_companies")
            out["bi_companies_count"] = int(cursor.fetchone()["cnt"])
            cursor.execute("SELECT COUNT(*) AS cnt FROM bi_companies WHERE updated_at >= datetime('now', '-1 hour')")
            out["updated_last_hour"] = int(cursor.fetchone()["cnt"])
            cursor.execute(
                "SELECT name, vertical, tier, status, prospect_score, updated_at FROM bi_companies "
                "ORDER BY prospect_score DESC, updated_at DESC LIMIT ?",
                (top_limit,),
            )
            out["top5"] = [dict(r) for r in cursor.fetchall()]

        if has_bi_runs:
            cursor.execute("PRAGMA table_info(bi_runs)")
            columns = {row["name"] for row in cursor.fetchall()}
            select_cols = ["id", "status", "started_at", "completed_at", "processed", "inserted", "updated", "failed", "error_log"]
            if "unchanged" in columns:
                select_cols.insert(7, "unchanged")
            if "signals_added" in columns:
                select_cols.insert(8, "signals_added")
            cursor.execute(
                f"SELECT {', '.join(select_cols)} FROM bi_runs ORDER BY id DESC LIMIT ?",
                (run_limit,),
            )
            out["recent_runs"] = [dict(r) for r in cursor.fetchall()]

    return out


@router.get(f"{BI_PREFIX}/source-config")
def get_bi_source_config():
    env = _read_sources_env()
    return {
        "path": str(SOURCES_ENV_PATH),
        "values": {k: env.get(k, "") for k in sorted(ALLOWED_SOURCE_CONFIG_KEYS)},
        "allowed_keys": sorted(ALLOWED_SOURCE_CONFIG_KEYS),
    }


@router.put(f"{BI_PREFIX}/source-config")
def update_bi_source_config(req: BiSourceConfigUpdateRequest):
    invalid = [k for k in req.values.keys() if k not in ALLOWED_SOURCE_CONFIG_KEYS]
    if invalid:
        raise HTTPException(status_code=400, detail=f"Unsupported keys: {', '.join(sorted(invalid))}")
    changed = _write_sources_env_updates(req.values)
    env = _read_sources_env()
    return {
        "ok": True,
        "changed": changed,
        "path": str(SOURCES_ENV_PATH),
        "values": {k: env.get(k, "") for k in sorted(ALLOWED_SOURCE_CONFIG_KEYS)},
    }


@router.get(f"{BI_PREFIX}/top-prospects")
def get_bi_top_prospects(
    limit: int = Query(default=25, ge=1, le=200),
    vertical: str | None = None,
    min_score: int = Query(default=0, ge=0, le=100),
):
    # Backward-compatible endpoint; can be removed after UI migration.
    with db.get_db() as conn:
        cursor = conn.cursor()
        if not _safe_table_exists(cursor, "bi_companies"):
            return {"results": [], "count": 0}

        conditions = ["prospect_score >= ?"]
        params: list[Any] = [min_score]
        if vertical:
            conditions.append("vertical = ?")
            params.append(vertical)
        params.append(limit)
        cursor.execute(
            "SELECT id, source_target_id, name, domain, vertical, tier, status, "
            "prospect_score, icp_fit_score, signal_score, engagement_score, score_updated_at, updated_at "
            f"FROM bi_companies WHERE {' AND '.join(conditions)} "
            "ORDER BY prospect_score DESC, updated_at DESC LIMIT ?",
            tuple(params),
        )
        rows = [dict(r) for r in cursor.fetchall()]
    return {"results": rows, "count": len(rows)}
