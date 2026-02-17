"""
Email discovery compatibility module.

Public API is kept stable while implementation is split by concern in
`services.email.discovery`.
"""

from services.email.discovery.constants import VALID_PATTERNS
from services.email.discovery.search import search_company_emails
from services.email.discovery.llm import analyze_pattern_with_llm
from services.email.discovery.generation import generate_email
from services.email.discovery.pipeline import (
    discover_email_pattern,
    process_linkedin_contacts_with_patterns,
)

__all__ = [
    "VALID_PATTERNS",
    "search_company_emails",
    "analyze_pattern_with_llm",
    "discover_email_pattern",
    "generate_email",
    "process_linkedin_contacts_with_patterns",
]

