from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any


def utc_now_iso() -> str:
    return datetime.now(UTC).isoformat()


@dataclass(slots=True)
class ProtocolMessage:
    type: str
    payload: dict[str, Any]


def parse_message(raw: dict[str, Any]) -> ProtocolMessage:
    if not isinstance(raw, dict):
        raise ValueError("protocol message must be object")
    msg_type = raw.get("type")
    payload = raw.get("payload", {})
    if not isinstance(msg_type, str) or not msg_type:
        raise ValueError("message missing type")
    if not isinstance(payload, dict):
        raise ValueError("message payload must be object")
    return ProtocolMessage(type=msg_type, payload=payload)


def build_message(msg_type: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
    return {"type": msg_type, "payload": payload or {}, "timestamp": utc_now_iso()}
