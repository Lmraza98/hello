"""Pydantic models for Salesforce API route modules."""

from typing import Optional

from pydantic import BaseModel


class CredentialsInput(BaseModel):
    username: str
    password: str


class CredentialsResponse(BaseModel):
    success: bool
    message: str


class AuthStatusResponse(BaseModel):
    status: str  # "authenticated", "expired", "not_configured"
    username: Optional[str] = None
    message: str


class ReauthResponse(BaseModel):
    success: bool
    message: str
    in_progress: bool

