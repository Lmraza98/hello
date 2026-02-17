"""Contact data-access helpers."""

from services.contacts.repository import (
    get_contacts_missing_generated_email,
    get_contacts_missing_public_urls,
    get_linkedin_contacts,
    init_linkedin_table,
    save_linkedin_contacts,
    update_generated_email,
    update_contact_linkedin_url,
)

__all__ = [
    "save_linkedin_contacts",
    "get_linkedin_contacts",
    "update_contact_linkedin_url",
    "get_contacts_missing_public_urls",
    "get_contacts_missing_generated_email",
    "update_generated_email",
    "init_linkedin_table",
]
