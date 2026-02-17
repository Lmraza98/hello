"""Admin diagnostics routes (logs + costs)."""

from typing import Literal, Optional

from fastapi import APIRouter, Query

import database as db

router = APIRouter(prefix="/api/admin", tags=["admin"])


@router.get("/logs")
async def get_admin_logs(
    q: Optional[str] = None,
    level: Optional[Literal["debug", "info", "warn", "error"]] = None,
    feature: Optional[str] = None,
    source: Optional[str] = None,
    time_range: Literal["15m", "1h", "24h", "7d"] = "1h",
    correlation_id: Optional[str] = None,
    limit: int = Query(default=200, ge=1, le=1000),
):
    return db.query_logs(
        {
            "q": q,
            "level": level,
            "feature": feature,
            "source": source,
            "time_range": time_range,
            "correlation_id": correlation_id,
            "limit": limit,
        }
    )


@router.get("/costs")
async def get_admin_costs(range: Literal["today", "7d", "30d"] = "today"):
    return db.aggregate_costs(range)

