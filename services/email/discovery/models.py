"""Typed models for email discovery orchestration."""

from dataclasses import dataclass, field
from typing import Dict, List, Optional


DEFAULT_EMAIL_PATTERN = "first.last"
DEFAULT_PATTERN_CONFIDENCE = 0.3


@dataclass(frozen=True)
class CompanyTarget:
    """Company-level unit for pattern discovery."""

    company: str
    company_key: str
    domain_hint: Optional[str]


@dataclass
class PatternMatch:
    """Resolved email pattern metadata for a company."""

    company: str
    company_key: str
    domain: Optional[str]
    domain_discovered: bool
    pattern: str = DEFAULT_EMAIL_PATTERN
    confidence: float = DEFAULT_PATTERN_CONFIDENCE
    examples: List[str] = field(default_factory=list)
    reasoning: str = ""

    @classmethod
    def fallback(
        cls,
        company: str,
        company_key: str,
        domain_hint: Optional[str],
        reasoning: str,
    ) -> "PatternMatch":
        return cls(
            company=company,
            company_key=company_key,
            domain=domain_hint,
            domain_discovered=False,
            pattern=DEFAULT_EMAIL_PATTERN,
            confidence=DEFAULT_PATTERN_CONFIDENCE,
            reasoning=reasoning,
        )

    def to_public_dict(self) -> Dict:
        """Legacy-compatible dictionary payload."""
        return {
            "company": self.company,
            "domain": self.domain,
            "domain_discovered": self.domain_discovered,
            "pattern": self.pattern,
            "confidence": self.confidence,
            "examples": self.examples,
            "reasoning": self.reasoning,
        }

    def to_patterns_summary(self) -> Dict:
        """Compact summary used by process result payload."""
        return {
            "pattern": self.pattern,
            "domain": self.domain,
            "domain_discovered": self.domain_discovered,
            "confidence": self.confidence,
        }


@dataclass(frozen=True)
class LinkedInContact:
    """Contact row loaded from linkedin_contacts."""

    contact_id: int
    company: str
    company_key: str
    domain_raw: Optional[str]
    name: str
    name_first: Optional[str]
    name_last: Optional[str]
    title: Optional[str]


@dataclass(frozen=True)
class ContactEmailUpdate:
    """Per-contact DB update payload."""

    contact_id: int
    email: str
    pattern: str


@dataclass(frozen=True)
class ContactExportRow:
    """Per-contact CSV row payload."""

    company: str
    name: str
    first_name: str
    last_name: str
    title: Optional[str]
    email: str
    pattern: str
    confidence: float
    domain: Optional[str]
    domain_verified: bool
