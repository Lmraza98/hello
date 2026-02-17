"""Search endpoints for research routes."""

from datetime import datetime

from fastapi import APIRouter

from api.routes._helpers import COMMON_ERROR_RESPONSES
from api.routes.research_routes.models import (
    CompanyResearchResponse,
    CompanyResearchRequest,
    PersonResearchResponse,
    PersonResearchRequest,
    SearchRequest,
    TavilySearchResponse,
)
from services.search.web_search import tavily_search

router = APIRouter()


@router.post("/search", response_model=TavilySearchResponse, responses=COMMON_ERROR_RESPONSES)
async def search(request: SearchRequest):
    """Generic Tavily search."""
    return await tavily_search(
        query=request.query,
        search_depth=request.search_depth,
        max_results=request.max_results,
        include_answer=request.include_answer,
    )


@router.post("/company", response_model=CompanyResearchResponse, responses=COMMON_ERROR_RESPONSES)
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


@router.post("/person", response_model=PersonResearchResponse, responses=COMMON_ERROR_RESPONSES)
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
