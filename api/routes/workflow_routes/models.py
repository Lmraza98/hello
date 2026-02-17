"""Pydantic models for workflow route modules."""

from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


# ── Outreach ─────────────────────────────────────────────────

class ResolveContactRequest(BaseModel):
    name: str
    company: Optional[str] = None


class ContactMatch(BaseModel):
    id: Optional[int] = None
    name: str
    title: Optional[str] = None
    company_name: Optional[str] = None
    company: Optional[str] = None
    domain: Optional[str] = None
    email: Optional[str] = None
    linkedin_url: Optional[str] = None
    phone: Optional[str] = None
    location: Optional[str] = None
    source: Optional[str] = None


class ResolveContactResponse(BaseModel):
    found_in_db: List[ContactMatch] = Field(default_factory=list)
    found_in_salesnav: List[ContactMatch] = Field(default_factory=list)
    best_match: Optional[ContactMatch] = None


class EnrollAndDraftRequest(BaseModel):
    campaign_id: int
    contact_id: Optional[int] = None
    create_if_missing: Optional[Dict[str, Any]] = None


class EmailDraft(BaseModel):
    subject: Optional[str] = None
    body: Optional[str] = None
    contact_name: Optional[str] = None
    company_name: Optional[str] = None
    error: Optional[str] = None


class EnrollAndDraftResponse(BaseModel):
    contact_id: Optional[int] = None
    enrolled: bool = False
    already_enrolled: bool = False
    email_draft: Optional[EmailDraft] = None
    error: Optional[str] = None


# ── Prospecting ──────────────────────────────────────────────

class ProspectRequest(BaseModel):
    query: str
    industry: Optional[str] = None
    location: Optional[str] = None
    max_companies: int = 10
    save_to_db: bool = True


class ProspectResponse(BaseModel):
    companies: List[Dict[str, Any]] = Field(default_factory=list)
    saved_count: int = 0
    existing_count: int = 0
    existing_companies: Dict[str, Any] = Field(default_factory=dict)
    query: str = ""
    error: Optional[str] = None


class ScrapeLeadsBatchRequest(BaseModel):
    company_names: List[str]
    title_filter: Optional[str] = None
    max_per_company: int = 5


class ScrapeLeadsBatchResponse(BaseModel):
    leads: List[Dict[str, Any]] = Field(default_factory=list)
    saved_count: int = 0
    companies_processed: int = 0
    errors: Optional[List[Dict[str, Any]]] = None


# ── Vetting ──────────────────────────────────────────────────

class LookupAndResearchRequest(BaseModel):
    company_names: List[str]
    icp_context: Optional[Dict[str, str]] = None


class CompanyResearchResult(BaseModel):
    website_summary: Optional[str] = None
    recent_news: List[str] = Field(default_factory=list)
    services_relevance: Optional[str] = None
    icp_fit_score: Optional[int] = None
    icp_fit_reasoning: Optional[str] = None
    talking_points: List[str] = Field(default_factory=list)
    sources: List[Dict[str, str]] = Field(default_factory=list)
    error: Optional[str] = None


class CompanyVetEntry(BaseModel):
    name: str
    existing: Optional[Dict[str, Any]] = None
    research: CompanyResearchResult = Field(default_factory=CompanyResearchResult)


class LookupAndResearchResponse(BaseModel):
    companies: List[CompanyVetEntry] = Field(default_factory=list)


class VetDecision(BaseModel):
    company_name: str
    company_id: Optional[int] = None
    approved: bool = False
    icp_score: Optional[int] = None


class VetBatchRequest(BaseModel):
    decisions: List[VetDecision]


class VetBatchResponse(BaseModel):
    vetted: int = 0
    skipped: int = 0
