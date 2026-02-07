"""
Pydantic models for API requests and responses.
"""
from pydantic import BaseModel
from typing import Optional

class Company(BaseModel):
    id: Optional[int] = None
    company_name: str
    domain: Optional[str] = None
    tier: Optional[str] = None
    vertical: Optional[str] = None
    target_reason: Optional[str] = None
    wedge: Optional[str] = None
    status: Optional[str] = 'pending'

class Contact(BaseModel):
    id: Optional[int] = None
    company_name: str
    domain: Optional[str] = None
    name: str
    title: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    phone_source: Optional[str] = None
    phone_confidence: Optional[int] = None
    linkedin_url: Optional[str] = None
    scraped_at: Optional[str] = None

class Stats(BaseModel):
    total_companies: int
    total_contacts: int
    contacts_with_email: int
    contacts_today: int