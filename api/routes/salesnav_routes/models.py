"""Pydantic models for Sales Navigator route modules."""

from typing import Any, List, Optional

from pydantic import BaseModel, ConfigDict, Field


class SalesNavSearchRequest(BaseModel):
    first_name: str
    last_name: str
    company: Optional[str] = None
    max_results: int = 5


class CompanySearchRequest(BaseModel):
    query: str
    max_companies: int = 50
    save_to_db: bool = True


class CompanyRef(BaseModel):
    name: str
    domain: Optional[str] = None
    linkedin_url: Optional[str] = None


class ScrapeLeadsRequest(BaseModel):
    companies: List[CompanyRef]
    title_filter: Optional[str] = None
    max_per_company: int = 10


class SalesNavProfile(BaseModel):
    name: str
    title: Optional[str] = None
    company: Optional[str] = None
    linkedin_url: Optional[str] = None
    location: Optional[str] = None
    source: Optional[str] = None


class SalesNavPersonSearchResponse(BaseModel):
    success: bool
    searched_query: str
    profiles: list[SalesNavProfile] = Field(default_factory=list)


class SalesNavCompanySearchResponse(BaseModel):
    status: Optional[str] = None
    query: Optional[str] = None
    companies: list[dict[str, Any]] = Field(default_factory=list)
    filters_applied: Optional[dict[str, Any]] = None
    saved_count: Optional[int] = None
    total_found: Optional[int] = None
    message: Optional[str] = None

    model_config = ConfigDict(extra="allow")


class SalesNavLead(BaseModel):
    name: str
    company: Optional[str] = None
    title: Optional[str] = None
    linkedin_url: Optional[str] = None

    model_config = ConfigDict(extra="allow")


class SalesNavScrapeError(BaseModel):
    company: str
    error: str


class SalesNavScrapeLeadsResponse(BaseModel):
    success: bool
    leads: list[SalesNavLead] = Field(default_factory=list)
    saved_count: int
    companies_processed: int
    errors: Optional[list[SalesNavScrapeError]] = None
