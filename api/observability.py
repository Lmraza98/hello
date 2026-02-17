"""Request correlation context and cost logging helpers."""

from __future__ import annotations

from contextvars import ContextVar
from datetime import datetime, timezone
from typing import Any, Optional

import config
import database as db

_request_id_ctx: ContextVar[Optional[str]] = ContextVar("request_id", default=None)
_correlation_id_ctx: ContextVar[Optional[str]] = ContextVar("correlation_id", default=None)


def set_request_context(request_id: str, correlation_id: str) -> None:
    _request_id_ctx.set(request_id)
    _correlation_id_ctx.set(correlation_id)


def get_request_id() -> Optional[str]:
    return _request_id_ctx.get()


def get_correlation_id() -> Optional[str]:
    return _correlation_id_ctx.get()


def clear_request_context() -> None:
    _request_id_ctx.set(None)
    _correlation_id_ctx.set(None)


def compute_openai_cost_usd(
    model: Optional[str],
    input_tokens: Optional[int],
    output_tokens: Optional[int],
) -> float:
    if not model:
        return 0.0
    pricing = config.OPENAI_PRICING_USD_PER_1M.get(model)
    if not pricing:
        return 0.0
    in_tokens = int(input_tokens or 0)
    out_tokens = int(output_tokens or 0)
    input_cost = (in_tokens / 1_000_000) * float(pricing.get("input_per_1m", 0))
    output_cost = (out_tokens / 1_000_000) * float(pricing.get("output_per_1m", 0))
    return round(input_cost + output_cost, 10)


def record_cost(
    provider: str,
    feature: str,
    endpoint: str,
    usd: float,
    model: Optional[str] = None,
    input_tokens: Optional[int] = None,
    output_tokens: Optional[int] = None,
    correlation_id: Optional[str] = None,
    request_id: Optional[str] = None,
    timestamp: Optional[str] = None,
    meta: Optional[dict[str, Any]] = None,
) -> None:
    db.insert_cost_event(
        {
            "timestamp": timestamp or datetime.now(timezone.utc).isoformat(),
            "provider": provider,
            "model": model,
            "feature": feature,
            "endpoint": endpoint,
            "correlation_id": correlation_id or get_correlation_id(),
            "request_id": request_id or get_request_id(),
            "usd": float(usd),
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
            "meta_json": meta or {},
        }
    )

