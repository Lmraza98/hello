"""
Research routes — Tavily web search + LLM-based ICP assessment.
Provides company research, person research, and ICP fit scoring.
"""
import json
import os
from datetime import datetime
from typing import Optional

import httpx
from fastapi import APIRouter
from pydantic import BaseModel

from services.web_search import tavily_search

router = APIRouter(prefix="/api/research", tags=["research"])

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")


# ── Request Models ──

class SearchRequest(BaseModel):
    query: str
    search_depth: str = "basic"
    max_results: int = 5
    include_answer: bool = True


class CompanyResearchRequest(BaseModel):
    company_name: str
    industry: Optional[str] = None
    context: Optional[str] = None


class PersonResearchRequest(BaseModel):
    person_name: str
    company_name: str
    title: Optional[str] = None


class ICPAssessRequest(BaseModel):
    company_name: str
    industry: Optional[str] = None
    headcount: Optional[str] = None
    location: Optional[str] = None
    research_summary: Optional[str] = None


# ── LLM Helper (OpenAI) ──

async def llm_assess(prompt: str, max_tokens: int = 400) -> dict:
    """Use OpenAI to assess ICP fit. Returns parsed JSON or error."""
    if not OPENAI_API_KEY:
        return {"error": "OPENAI_API_KEY not configured"}

    async with httpx.AsyncClient() as client:
        try:
            response = await client.post(
                "https://api.openai.com/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {OPENAI_API_KEY}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": "gpt-4o-mini",
                    "max_tokens": max_tokens,
                    "messages": [{"role": "user", "content": prompt}],
                },
                timeout=20.0,
            )
            data = response.json()
            content = data["choices"][0]["message"]["content"].strip()
            # Strip markdown code fences if present
            content = content.removeprefix("```json").removeprefix("```").removesuffix("```").strip()
            return json.loads(content)
        except json.JSONDecodeError:
            return {"error": "LLM returned non-JSON response", "raw": content[:300]}
        except Exception as e:
            return {"error": str(e)}


# ── Routes ──

@router.post("/search")
async def search(request: SearchRequest):
    """Generic Tavily search."""
    result = await tavily_search(
        query=request.query,
        search_depth=request.search_depth,
        max_results=request.max_results,
        include_answer=request.include_answer,
    )
    return result


@router.post("/company")
async def research_company(request: CompanyResearchRequest):
    """Research a company for ICP fit assessment."""
    queries = [
        f"{request.company_name} company overview what they do",
        f"{request.company_name} recent news {datetime.now().year}",
    ]
    if request.context:
        queries.append(f"{request.company_name} {request.context}")

    results = []
    for query in queries:
        result = await tavily_search(query, max_results=3)
        results.append(result)

    return {"company": request.company_name, "research": results}


@router.post("/person")
async def research_person(request: PersonResearchRequest):
    """Research a person for outreach context."""
    queries = [
        f"{request.person_name} {request.company_name} LinkedIn",
        f"{request.person_name} {request.company_name} recent activity",
    ]

    results = []
    for query in queries:
        result = await tavily_search(query, max_results=3)
        results.append(result)

    return {"person": request.person_name, "research": results}


@router.post("/icp-assess")
async def assess_icp_fit(request: ICPAssessRequest):
    """Use LLM to assess ICP fit given research data."""
    prompt = f"""You are evaluating whether a company is a good sales target for Zco Corporation,
a software development services company that builds custom web apps, mobile apps,
IoT solutions, and enterprise software.

Company: {request.company_name}
Industry: {request.industry or 'Unknown'}
Headcount: {request.headcount or 'Unknown'}
Location: {request.location or 'Unknown'}

Research:
{request.research_summary or 'No research available'}

Evaluate this company as a potential Zco client on a scale of 1-10.

Consider:
- Do they likely need custom software development?
- Are they big enough to afford outsourced dev ($50K+ projects)?
- Are they in a growth phase or modernizing?
- Is their industry one that benefits from custom software?
- Any signals they're looking for tech partners?

Respond with ONLY JSON:
{{
  "score": 7,
  "reasoning": "Brief 1-2 sentence explanation",
  "services_relevance": "What Zco services they might need",
  "talking_points": ["Point 1 for outreach", "Point 2"]
}}"""

    result = await llm_assess(prompt, max_tokens=300)

    if "error" in result:
        return {
            "score": 5,
            "reasoning": "Could not assess — using neutral score.",
            "services_relevance": "",
            "talking_points": [],
            "error": result["error"],
        }

    return result
