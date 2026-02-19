"""
Vetting workflow service — batch company lookup, research, and vet decisions.

Combines DB lookup, web research (Tavily), and ICP assessment (LLM) into
two atomic operations: lookup-and-research and vet-batch.
"""

from datetime import datetime
from typing import Any, Dict, List, Optional

import database as db


# ---------------------------------------------------------------------------
# lookup_and_research: batch lookup + research for a list of companies
# ---------------------------------------------------------------------------

async def lookup_and_research(
    company_names: List[str],
    icp_context: Optional[Dict[str, str]] = None,
) -> Dict[str, Any]:
    """
    For each company, look up existing DB records and run web research + ICP
    assessment.  Returns all results in a single response so the frontend
    can present the vetting UI without further API calls.

    Returns:
        {
          "companies": [
            {
              "name": "Acme Corp",
              "existing": { "id": 5, ... } | None,
              "research": { "website_summary": ..., "icp_fit_score": ..., ... }
            },
            ...
          ]
        }
    """
    icp_context = icp_context or {}

    # --- Batch DB lookup ---
    existing_map: Dict[str, Dict[str, Any]] = {}
    if company_names:
        try:
            with db.get_db() as conn:
                cursor = conn.cursor()
                for name in company_names:
                    cursor.execute(
                        """
                        SELECT
                            t.id, t.company_name, t.status, t.vetted_at, t.icp_fit_score,
                            (SELECT COUNT(*) FROM linkedin_contacts lc
                             WHERE LOWER(lc.company_name) = LOWER(t.company_name)) AS contact_count
                        FROM targets t
                        WHERE LOWER(t.company_name) = LOWER(?)
                        LIMIT 1
                        """,
                        (name,),
                    )
                    row = cursor.fetchone()
                    if row:
                        existing_map[name.lower()] = {
                            "id": row[0],
                            "company_name": row[1],
                            "status": row[2],
                            "vetted_at": row[3],
                            "icp_fit_score": row[4],
                            "contact_count": row[5],
                        }
        except Exception:
            pass

    # --- Research each company ---
    from services.search.web_search import tavily_search

    companies_out: List[Dict[str, Any]] = []

    for name in company_names:
        existing = existing_map.get(name.lower())
        research: Dict[str, Any] = {}

        try:
            # Web research: overview + recent news
            overview_result = await tavily_search(
                query=f"{name} company overview what they do",
                max_results=3,
            )
            news_result = await tavily_search(
                query=f"{name} recent news {datetime.now().year}",
                max_results=3,
            )

            website_summary = overview_result.get("answer") if isinstance(overview_result, dict) else None
            recent_news = []
            if isinstance(news_result, dict):
                for r in (news_result.get("results") or []):
                    if isinstance(r, dict) and r.get("title"):
                        recent_news.append(r["title"])

            # Sources
            sources: List[Dict[str, str]] = []
            seen_urls: set = set()
            for res in [overview_result, news_result]:
                if not isinstance(res, dict):
                    continue
                for r in (res.get("results") or []):
                    if isinstance(r, dict) and r.get("url") and r["url"] not in seen_urls:
                        seen_urls.add(r["url"])
                        sources.append({
                            "title": r.get("title", ""),
                            "url": r["url"],
                            "snippet": (r.get("content") or "")[:150],
                        })

            # ICP assessment via LLM
            research_summary = website_summary or ""
            icp_result = await _assess_icp(
                name,
                industry=icp_context.get("industry"),
                location=icp_context.get("location"),
                research_summary=research_summary,
            )

            research = {
                "website_summary": website_summary,
                "recent_news": recent_news[:5],
                "services_relevance": icp_result.get("services_relevance", ""),
                "icp_fit_score": icp_result.get("score", 5),
                "icp_fit_reasoning": icp_result.get("reasoning", ""),
                "talking_points": icp_result.get("talking_points", []),
                "sources": sources[:10],
            }
        except Exception as exc:
            research = {"error": str(exc)}

        companies_out.append({
            "name": name,
            "existing": existing,
            "research": research,
        })

    return {"companies": companies_out}


# ---------------------------------------------------------------------------
# vet_batch: record vetting decisions for multiple companies
# ---------------------------------------------------------------------------

def vet_batch(
    decisions: List[Dict[str, Any]],
) -> Dict[str, Any]:
    """
    Apply vetting decisions (approve / skip) for a batch of companies.

    Each decision:
        { "company_name": str, "company_id": int | None, "approved": bool, "icp_score": int | None }

    Returns:
        { "vetted": int, "skipped": int }
    """
    vetted = 0
    skipped = 0

    with db.get_db() as conn:
        cursor = conn.cursor()
        for decision in decisions:
            if not decision.get("approved"):
                skipped += 1
                continue

            company_id = decision.get("company_id")
            icp_score = decision.get("icp_score")

            if company_id:
                if icp_score is not None:
                    cursor.execute(
                        "UPDATE targets SET vetted_at = ?, icp_fit_score = ?, status = 'vetted' WHERE id = ?",
                        (datetime.utcnow().isoformat(), icp_score, company_id),
                    )
                else:
                    cursor.execute(
                        "UPDATE targets SET vetted_at = ?, status = 'vetted' WHERE id = ?",
                        (datetime.utcnow().isoformat(), company_id),
                    )
                vetted += 1
            else:
                skipped += 1

    # Sync semantic index for all vetted companies
    for decision in decisions:
        if decision.get("approved") and decision.get("company_id"):
            try:
                db.sync_entity_semantic_index("company", decision["company_id"])
            except Exception:
                pass

    return {"vetted": vetted, "skipped": skipped}


# ---------------------------------------------------------------------------
# Internal helper: ICP assessment via LLM
# ---------------------------------------------------------------------------

async def _assess_icp(
    company_name: str,
    industry: Optional[str] = None,
    location: Optional[str] = None,
    research_summary: str = "",
) -> Dict[str, Any]:
    """Run ICP fit assessment via the research assessment endpoint."""
    try:
        from api.routes.research_routes.assessment import assess_icp_fit
        from api.routes.research_routes.models import ICPAssessRequest

        request = ICPAssessRequest(
            company_name=company_name,
            industry=industry or "",
            headcount="",
            location=location or "",
            research_summary=research_summary,
        )
        result = await assess_icp_fit(request)

        if hasattr(result, "model_dump"):
            return result.model_dump()
        if isinstance(result, dict):
            return result
        return {"score": 5, "reasoning": "Assessment unavailable"}
    except Exception:
        return {"score": 5, "reasoning": "Assessment failed"}
