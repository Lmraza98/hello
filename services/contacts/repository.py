"""Database functions for storing and retrieving LinkedIn contacts."""

from __future__ import annotations

import re
import sqlite3
from typing import Dict, List

import database as db


def save_linkedin_contacts(company_name: str, employees: List[Dict], domain: str = None):
    """Save scraped LinkedIn contacts to database."""
    if not domain and company_name:
        domain = re.sub(r"[^\w\s-]", "", company_name.lower())
        domain = re.sub(r"[\s_]+", "-", domain).strip("-")

    with db.get_db() as conn:
        cursor = conn.cursor()
        for emp in employees:
            cursor.execute(
                """
                INSERT OR REPLACE INTO linkedin_contacts
                (company_name, domain, name, title, linkedin_url, scraped_at)
                VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                """,
                (company_name, domain, emp["name"], emp["title"], emp.get("linkedin_url")),
            )


def get_linkedin_contacts(company_name: str = None, domain: str = None) -> List[Dict]:
    """Get stored LinkedIn contacts by company name or domain."""
    with db.get_db() as conn:
        cursor = conn.cursor()
        if company_name:
            cursor.execute(
                """
                SELECT name, title, linkedin_url, company_name, domain
                FROM linkedin_contacts
                WHERE company_name = ?
                ORDER BY scraped_at DESC
                """,
                (company_name,),
            )
        elif domain:
            cursor.execute(
                """
                SELECT name, title, linkedin_url, company_name, domain
                FROM linkedin_contacts
                WHERE domain = ?
                ORDER BY scraped_at DESC
                """,
                (domain,),
            )
        else:
            return []
        return [dict(row) for row in cursor.fetchall()]


def init_linkedin_table():
    """Initialize LinkedIn contacts table."""
    with db.get_db() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS linkedin_contacts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                domain TEXT,
                company_name TEXT,
                name TEXT NOT NULL,
                title TEXT,
                linkedin_url TEXT,
                email_generated TEXT,
                email_confidence INTEGER DEFAULT 0,
                email_verified INTEGER DEFAULT 0,
                scraped_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(domain, name)
            )
            """
        )
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_linkedin_domain ON linkedin_contacts(domain)")

        for col, col_type in [
            ("company_name", "TEXT"),
            ("email_confidence", "INTEGER DEFAULT 0"),
            ("phone", "TEXT"),
            ("phone_source", "TEXT"),
            ("phone_confidence", "INTEGER DEFAULT 0"),
        ]:
            try:
                cursor.execute(f"ALTER TABLE linkedin_contacts ADD COLUMN {col} {col_type}")
            except sqlite3.OperationalError:
                pass

        try:
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_linkedin_company ON linkedin_contacts(company_name)")
        except sqlite3.OperationalError:
            pass


def update_contact_linkedin_url(contact_id: int, linkedin_url: str):
    """Update a contact's LinkedIn profile URL in the database."""
    with db.get_db() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            UPDATE linkedin_contacts
            SET linkedin_url = ?
            WHERE id = ?
            """,
            (linkedin_url, contact_id),
        )


def get_contacts_missing_public_urls(limit: int = 100, company_name: str | None = None) -> List[Dict]:
    """Return contacts whose linkedin_url is missing or still SalesNav-only."""
    return db.get_contacts_missing_public_urls(limit=limit, company_name=company_name)


def get_contacts_missing_generated_email(company_name: str) -> List[Dict]:
    """Return contacts for a company that still need generated email addresses."""
    return db.get_contacts_missing_generated_email(company_name)


def update_generated_email(contact_id: int, email: str, pattern: str, confidence_pct: int) -> None:
    """Persist generated email metadata for a single contact."""
    db.update_contact_generated_email(contact_id, email, pattern, confidence_pct)


# Initialize table on import.
init_linkedin_table()
