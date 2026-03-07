"""Pydantic models used across contact route modules."""

from typing import Optional, List

from pydantic import BaseModel, ConfigDict, Field


class BulkActionRequest(BaseModel):
    contact_ids: List[int]
    campaign_id: Optional[int] = None


class SalesforceUrlRequest(BaseModel):
    salesforce_url: str


class ContactCreateRequest(BaseModel):
    company_name: str
    name: str
    domain: Optional[str] = None
    location: Optional[str] = None
    title: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    linkedin_url: Optional[str] = None
    salesforce_url: Optional[str] = None
    lead_source: Optional[str] = None
    ingest_batch_id: Optional[str] = None


class ContactRecord(BaseModel):
    id: int
    company_name: str
    domain: Optional[str] = None
    location: Optional[str] = None
    name: str
    title: Optional[str] = None
    email: Optional[str] = None
    email_pattern: Optional[str] = None
    email_confidence: Optional[int] = None
    email_verified: bool = False
    phone: Optional[str] = None
    phone_source: Optional[str] = None
    phone_confidence: Optional[int] = None
    linkedin_url: Optional[str] = None
    salesforce_url: Optional[str] = None
    salesforce_status: Optional[str] = None
    salesforce_sync_status: Optional[str] = None
    salesforce_uploaded_at: Optional[str] = None
    salesforce_upload_batch: Optional[str] = None
    engagement_status: Optional[str] = None
    lead_source: Optional[str] = None
    ingest_batch_id: Optional[str] = None
    scraped_at: Optional[str] = None
    vertical: Optional[str] = None


class ContactCreateResponse(BaseModel):
    id: int
    company_name: str
    domain: Optional[str] = None
    location: Optional[str] = None
    name: str
    title: Optional[str] = None
    email: Optional[str] = None
    linkedin_url: Optional[str] = None
    salesforce_url: Optional[str] = None
    salesforce_status: Optional[str] = None
    lead_source: Optional[str] = None
    ingest_batch_id: Optional[str] = None


class ContactDeleteResponse(BaseModel):
    deleted: bool


class ContactClearResponse(BaseModel):
    deleted: int


class ContactSalesforceAuthResponse(BaseModel):
    success: bool
    message: str
    traceback: Optional[str] = None


class ContactSalesforceUrlResponse(BaseModel):
    success: bool
    salesforce_url: str


class ContactSalesforceQueuedResponse(BaseModel):
    success: bool
    queued: bool
    busy: bool


class ContactSalesforceSimpleResponse(BaseModel):
    success: bool


class BulkSalesforceUploadResponse(BaseModel):
    success: bool
    csv_path: Optional[str] = None
    csv_filename: Optional[str] = None
    exported: Optional[int] = None
    skipped_already_uploaded: Optional[int] = None
    batch_id: Optional[str] = None
    message: Optional[str] = None
    already_uploaded: list[dict] = Field(default_factory=list)
    traceback: Optional[str] = None


class BulkLinkedInRequestResponse(BaseModel):
    success: bool
    processed: int
    message: str


class BulkSendEmailResponse(BaseModel):
    success: bool
    sent: int
    total: int


class BulkDeleteResponse(BaseModel):
    success: bool
    deleted: int
    message: str


class BulkCollectPhoneResponse(BaseModel):
    success: bool
    processed: int
    discovered: int
    enriched: int
    total: int
    searched: int
    message: str


class BulkMarkReviewedResponse(BaseModel):
    success: bool
    updated: int
    total: int
    message: str


class FileExportResponse(BaseModel):
    model_config = ConfigDict(extra="allow")
