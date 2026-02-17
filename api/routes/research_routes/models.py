"""Pydantic request models for research routes."""

from typing import Optional

from pydantic import BaseModel, Field


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


class TavilySearchResult(BaseModel):
    title: str
    url: str
    content: str


class TavilySearchResponse(BaseModel):
    provider: str
    query: str
    answer: Optional[str] = None
    results: list[TavilySearchResult] = Field(default_factory=list)
    error: Optional[str] = None


class CompanyResearchResponse(BaseModel):
    company: str
    research: list[TavilySearchResponse] = Field(default_factory=list)


class PersonResearchResponse(BaseModel):
    person: str
    research: list[TavilySearchResponse] = Field(default_factory=list)


class ICPAssessResponse(BaseModel):
    score: int
    reasoning: str
    services_relevance: str
    talking_points: list[str] = Field(default_factory=list)
    error: Optional[str] = None
