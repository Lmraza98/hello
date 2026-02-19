"""Pydantic models for company route modules."""

from typing import Any, Optional

from pydantic import BaseModel, ConfigDict, Field, RootModel


class CompanyCollectionRequest(BaseModel):
    query: str
    max_companies: int = 100
    save_to_db: bool = True


class CompanyLookupEntry(BaseModel):
    id: int
    company_name: str
    status: Optional[str] = None
    vetted_at: Optional[str] = None
    icp_fit_score: Optional[int] = None
    contact_count: int


class CompanyLookupResponse(RootModel[dict[str, CompanyLookupEntry]]):
    pass


class CompanyActionResponse(BaseModel):
    success: bool = True


class CompanyDeleteResponse(BaseModel):
    deleted: bool


class CompanyBulkDeleteResponse(BaseModel):
    success: bool
    deleted: int
    message: str


class CompanyImportResponse(BaseModel):
    imported: int


class CompanyResetResponse(BaseModel):
    reset: bool


class CompanySkippedResponse(BaseModel):
    skipped: int


class CompanyPendingDeleteResponse(BaseModel):
    deleted: int


class CompanyPendingCountResponse(BaseModel):
    pending: int

class CompanyCollectResponse(BaseModel):
    status: Optional[str] = None
    query: Optional[str] = None
    companies: list[dict[str, Any]] = Field(default_factory=list)
    filters_applied: Optional[dict[str, Any]] = None
    saved_count: Optional[int] = None
    total_found: Optional[int] = None
    message: Optional[str] = None

    model_config = ConfigDict(extra="allow")
