"""Phone enrichment entrypoints."""

from services.enrichment.phone.discoverer import (
    discover_phone_parallel,
    process_linkedin_contacts_for_phones,
)

__all__ = ["discover_phone_parallel", "process_linkedin_contacts_for_phones"]
