from __future__ import annotations

import json
import sqlite3
import uuid
from datetime import datetime, timezone
from typing import Any

import database


def _utcnow_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def utcnow_iso() -> str:
    return _utcnow_iso()


def _json_dumps(value: Any) -> str:
    return json.dumps(value, ensure_ascii=True)


def _json_loads(value: str | None, default: Any) -> Any:
    if not value:
        return default
    try:
        return json.loads(value)
    except Exception:
        return default


def ensure_tables(conn: sqlite3.Connection | None = None) -> None:
    db = conn or database.get_connection()
    cursor = db.cursor()
    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS lg_runs (
            id TEXT PRIMARY KEY,
            graph_id TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            created_at TEXT NOT NULL,
            started_at TEXT,
            completed_at TEXT,
            input_json TEXT,
            output_json TEXT,
            error_json TEXT
        )
        """
    )
    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS lg_checkpoints (
            id TEXT PRIMARY KEY,
            run_id TEXT NOT NULL,
            step_name TEXT NOT NULL,
            state_json TEXT NOT NULL,
            created_at TEXT NOT NULL
        )
        """
    )
    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS lg_events (
            id TEXT PRIMARY KEY,
            run_id TEXT NOT NULL,
            event_type TEXT NOT NULL,
            payload_json TEXT NOT NULL,
            created_at TEXT NOT NULL
        )
        """
    )
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_lg_runs_status ON lg_runs(status)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_lg_checkpoints_run ON lg_checkpoints(run_id, created_at)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_lg_events_run ON lg_events(run_id, created_at)")
    db.commit()
    if conn is None:
        db.close()


def init_state_store() -> None:
    ensure_tables()


def create_run(graph_id: str, input_payload: dict[str, Any]) -> str:
    run_id = str(uuid.uuid4())
    db = database.get_connection()
    db.execute(
        """
        INSERT INTO lg_runs (id, graph_id, status, created_at, input_json)
        VALUES (?, ?, 'pending', ?, ?)
        """,
        (run_id, graph_id, _utcnow_iso(), _json_dumps(input_payload)),
    )
    db.commit()
    db.close()
    return run_id


def update_run_status(
    run_id: str,
    status: str,
    *,
    started_at: str | None = None,
    completed_at: str | None = None,
    output: dict[str, Any] | None = None,
    error: dict[str, Any] | None = None,
) -> None:
    db = database.get_connection()
    db.execute(
        """
        UPDATE lg_runs
        SET status = ?,
            started_at = COALESCE(?, started_at),
            completed_at = COALESCE(?, completed_at),
            output_json = COALESCE(?, output_json),
            error_json = COALESCE(?, error_json)
        WHERE id = ?
        """,
        (
            status,
            started_at,
            completed_at,
            _json_dumps(output) if output is not None else None,
            _json_dumps(error) if error is not None else None,
            run_id,
        ),
    )
    db.commit()
    db.close()


def append_event(run_id: str, event_type: str, payload: dict[str, Any]) -> str:
    event_id = str(uuid.uuid4())
    db = database.get_connection()
    db.execute(
        """
        INSERT INTO lg_events (id, run_id, event_type, payload_json, created_at)
        VALUES (?, ?, ?, ?, ?)
        """,
        (event_id, run_id, event_type, _json_dumps(payload), _utcnow_iso()),
    )
    db.commit()
    db.close()
    return event_id


def save_checkpoint(run_id: str, step_name: str, state: dict[str, Any]) -> str:
    checkpoint_id = str(uuid.uuid4())
    db = database.get_connection()
    db.execute(
        """
        INSERT INTO lg_checkpoints (id, run_id, step_name, state_json, created_at)
        VALUES (?, ?, ?, ?, ?)
        """,
        (checkpoint_id, run_id, step_name, _json_dumps(state), _utcnow_iso()),
    )
    db.commit()
    db.close()
    return checkpoint_id


def get_run(run_id: str) -> dict[str, Any] | None:
    db = database.get_connection()
    row = db.execute("SELECT * FROM lg_runs WHERE id = ?", (run_id,)).fetchone()
    db.close()
    if not row:
        return None
    return {
        "id": row["id"],
        "graph_id": row["graph_id"],
        "status": row["status"],
        "created_at": row["created_at"],
        "started_at": row["started_at"],
        "completed_at": row["completed_at"],
        "input": _json_loads(row["input_json"], {}),
        "output": _json_loads(row["output_json"], None),
        "error": _json_loads(row["error_json"], None),
    }


def list_runs(limit: int = 50, status: str | None = None) -> list[dict[str, Any]]:
    db = database.get_connection()
    if status:
        rows = db.execute(
            "SELECT * FROM lg_runs WHERE status = ? ORDER BY created_at DESC LIMIT ?",
            (status, limit),
        ).fetchall()
    else:
        rows = db.execute(
            "SELECT * FROM lg_runs ORDER BY created_at DESC LIMIT ?",
            (limit,),
        ).fetchall()
    db.close()
    out: list[dict[str, Any]] = []
    for row in rows:
        out.append(
            {
                "id": row["id"],
                "graph_id": row["graph_id"],
                "status": row["status"],
                "created_at": row["created_at"],
                "started_at": row["started_at"],
                "completed_at": row["completed_at"],
                "input": _json_loads(row["input_json"], {}),
                "output": _json_loads(row["output_json"], None),
                "error": _json_loads(row["error_json"], None),
            }
        )
    return out


def get_latest_checkpoint(run_id: str) -> dict[str, Any] | None:
    db = database.get_connection()
    row = db.execute(
        "SELECT step_name, state_json FROM lg_checkpoints WHERE run_id = ? ORDER BY created_at DESC LIMIT 1",
        (run_id,),
    ).fetchone()
    db.close()
    if not row:
        return None
    return {"step_name": row["step_name"], "state": _json_loads(row["state_json"], {})}


def list_events(run_id: str, limit: int = 100) -> list[dict[str, Any]]:
    db = database.get_connection()
    rows = db.execute(
        "SELECT * FROM lg_events WHERE run_id = ? ORDER BY created_at DESC LIMIT ?",
        (run_id, limit),
    ).fetchall()
    db.close()
    return [
        {
            "id": row["id"],
            "event_type": row["event_type"],
            "created_at": row["created_at"],
            "payload": _json_loads(row["payload_json"], {}),
        }
        for row in rows
    ]
