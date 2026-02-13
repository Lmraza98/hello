"""
SQLite database schema and operations.
Single-file database for easy portability and resume capability.
"""
import sqlite3
import json
import math
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional, List, Dict, Any
from contextlib import contextmanager
from dataclasses import dataclass, asdict

import config


def get_connection() -> sqlite3.Connection:
    """Get a database connection with row factory."""
    conn = sqlite3.connect(config.DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


@contextmanager
def get_db():
    """Context manager for database connections."""
    conn = get_connection()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_database():
    """Initialize the database schema."""
    with get_db() as conn:
        cursor = conn.cursor()
        
        # Targets table - input companies for LinkedIn search
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS targets (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                domain TEXT UNIQUE,
                company_name TEXT,
                tier TEXT,
                vertical TEXT,
                target_reason TEXT,
                wedge TEXT,
                source_url TEXT,
                source TEXT,
                notes TEXT,
                status TEXT DEFAULT 'pending',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_targets_domain ON targets(domain)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_targets_status ON targets(status)")
        
        # Migration: Add new columns for existing databases
        new_columns = [
            ('company_name', 'TEXT'),
            ('tier', 'TEXT'),
            ('vertical', 'TEXT'),
            ('target_reason', 'TEXT'),
            ('wedge', 'TEXT'),
            ('vetted_at', 'TIMESTAMP'),
            ('icp_fit_score', 'INTEGER'),
        ]
        for col_name, col_type in new_columns:
            try:
                cursor.execute(f"ALTER TABLE targets ADD COLUMN {col_name} {col_type}")
            except sqlite3.OperationalError:
                pass  # Column already exists
        
        # Create indexes after migration
        try:
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_targets_company ON targets(company_name)")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_targets_tier ON targets(tier)")
        except sqlite3.OperationalError:
            pass
        
        # Pages table - fetched content
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS pages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                domain TEXT NOT NULL,
                url TEXT NOT NULL UNIQUE,
                page_type TEXT,
                fetched_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                text_path TEXT,
                html_path TEXT,
                meta_json TEXT,
                emails_found TEXT,
                phones_found TEXT,
                internal_links TEXT,
                fetch_status TEXT DEFAULT 'pending',
                FOREIGN KEY (domain) REFERENCES targets(domain)
            )
        """)
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_pages_domain ON pages(domain)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_pages_url ON pages(url)")
        
        # Candidates table - extracted lead data
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS candidates (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                domain TEXT NOT NULL,
                company_name TEXT,
                company_info TEXT,
                contacts_json TEXT,
                fit_score REAL,
                contact_quality_score REAL,
                evidence_score REAL,
                overall_score REAL,
                confidence REAL,
                fit_reason TEXT,
                domain_summary TEXT,
                llm_extracted_at TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (domain) REFERENCES targets(domain)
            )
        """)
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_candidates_domain ON candidates(domain)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_candidates_score ON candidates(overall_score)")
        
        # Send queue table - planned sends
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS send_queue (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                candidate_id INTEGER NOT NULL,
                contact_name TEXT,
                contact_email TEXT,
                contact_title TEXT,
                sf_record_type TEXT DEFAULT 'Lead',
                sf_record_url TEXT,
                planned_subject TEXT NOT NULL,
                planned_body TEXT NOT NULL,
                personalization TEXT,
                priority INTEGER DEFAULT 0,
                status TEXT DEFAULT 'pending',
                do_not_send INTEGER DEFAULT 0,
                do_not_send_reason TEXT,
                scheduled_date DATE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (candidate_id) REFERENCES candidates(id)
            )
        """)
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_send_queue_status ON send_queue(status)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_send_queue_date ON send_queue(scheduled_date)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_send_queue_email ON send_queue(contact_email)")
        
        # Send log table - actual send results
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS send_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                send_queue_id INTEGER NOT NULL,
                sf_record_url TEXT,
                sf_activity_id TEXT,
                timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                result TEXT NOT NULL,
                details TEXT,
                screenshot_path TEXT,
                FOREIGN KEY (send_queue_id) REFERENCES send_queue(id)
            )
        """)
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_send_log_queue ON send_log(send_queue_id)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_send_log_result ON send_log(result)")
        
        # LLM usage tracking (for budget control)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS llm_usage (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                date DATE NOT NULL,
                domain TEXT,
                call_type TEXT,
                input_tokens INTEGER,
                output_tokens INTEGER,
                cost_estimate REAL,
                timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_llm_usage_date ON llm_usage(date)")
        
        # LinkedIn contacts table - scraped contacts
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS linkedin_contacts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                company_name TEXT,
                domain TEXT,
                name TEXT NOT NULL,
                title TEXT,
                email_generated TEXT,
                email_pattern TEXT,
                email_confidence INTEGER,
                email_verified INTEGER DEFAULT 0,
                linkedin_url TEXT,
                phone TEXT,
                phone_source TEXT,
                phone_confidence INTEGER,
                salesforce_status TEXT DEFAULT 'pending',
                salesforce_url TEXT,
                salesforce_uploaded_at TIMESTAMP,
                salesforce_upload_batch TEXT,
                scraped_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_linkedin_contacts_company ON linkedin_contacts(company_name)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_linkedin_contacts_domain ON linkedin_contacts(domain)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_linkedin_contacts_salesforce ON linkedin_contacts(salesforce_status)")
        
        # Migration: Add salesforce tracking columns to existing databases
        sf_columns = [
            ('salesforce_url', 'TEXT'),
            ('salesforce_uploaded_at', 'TIMESTAMP'),
            ('salesforce_upload_batch', 'TEXT'),
        ]
        for col_name, col_type in sf_columns:
            try:
                cursor.execute(f"ALTER TABLE linkedin_contacts ADD COLUMN {col_name} {col_type}")
            except sqlite3.OperationalError:
                pass  # Column already exists
        
        # Email campaigns table - multi-step email sequences
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS email_campaigns (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                description TEXT,
                num_emails INTEGER DEFAULT 3,
                days_between_emails INTEGER DEFAULT 3,
                status TEXT DEFAULT 'draft',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_email_campaigns_status ON email_campaigns(status)")
        
        # Email templates - templates for each step in a campaign
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS email_templates (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                campaign_id INTEGER NOT NULL,
                step_number INTEGER NOT NULL,
                subject_template TEXT NOT NULL,
                body_template TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (campaign_id) REFERENCES email_campaigns(id) ON DELETE CASCADE
            )
        """)
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_email_templates_campaign ON email_templates(campaign_id)")
        cursor.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_email_templates_step ON email_templates(campaign_id, step_number)")
        
        # Campaign contacts - contacts enrolled in a campaign
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS campaign_contacts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                campaign_id INTEGER NOT NULL,
                contact_id INTEGER NOT NULL,
                sf_lead_url TEXT,
                current_step INTEGER DEFAULT 0,
                status TEXT DEFAULT 'active',
                enrolled_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                next_email_at TIMESTAMP,
                completed_at TIMESTAMP,
                FOREIGN KEY (campaign_id) REFERENCES email_campaigns(id) ON DELETE CASCADE,
                FOREIGN KEY (contact_id) REFERENCES linkedin_contacts(id)
            )
        """)
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_campaign_contacts_campaign ON campaign_contacts(campaign_id)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_campaign_contacts_contact ON campaign_contacts(contact_id)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_campaign_contacts_status ON campaign_contacts(status)")
        cursor.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_campaign_contacts_unique ON campaign_contacts(campaign_id, contact_id)")
        
        # Sent emails - tracks each email actually sent
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS sent_emails (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                campaign_id INTEGER NOT NULL,
                campaign_contact_id INTEGER NOT NULL,
                contact_id INTEGER NOT NULL,
                step_number INTEGER NOT NULL,
                subject TEXT NOT NULL,
                body TEXT NOT NULL,
                sf_lead_url TEXT,
                sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                status TEXT DEFAULT 'sent',
                error_message TEXT,
                screenshot_path TEXT,
                FOREIGN KEY (campaign_id) REFERENCES email_campaigns(id),
                FOREIGN KEY (campaign_contact_id) REFERENCES campaign_contacts(id),
                FOREIGN KEY (contact_id) REFERENCES linkedin_contacts(id)
            )
        """)
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_sent_emails_campaign ON sent_emails(campaign_id)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_sent_emails_contact ON sent_emails(contact_id)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_sent_emails_sent_at ON sent_emails(sent_at)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_sent_emails_status ON sent_emails(status)")
        
        # Migration: Add review/tracking columns to sent_emails
        sent_email_new_columns = [
            ('review_status', "TEXT DEFAULT 'draft'"),
            ('scheduled_send_time', 'TIMESTAMP'),
            ('rendered_subject', 'TEXT'),
            ('rendered_body', 'TEXT'),
            ('opened', 'INTEGER DEFAULT 0'),
            ('open_count', 'INTEGER DEFAULT 0'),
            ('first_opened_at', 'TIMESTAMP'),
            ('replied', 'INTEGER DEFAULT 0'),
            ('replied_at', 'TIMESTAMP'),
            ('last_tracked_at', 'TIMESTAMP'),
            ('approved_at', 'TIMESTAMP'),
            ('approved_by', "TEXT DEFAULT 'user'"),
            ('meeting_booked', 'INTEGER DEFAULT 0'),
            ('meeting_booked_at', 'TIMESTAMP'),
        ]
        for col_name, col_type in sent_email_new_columns:
            try:
                cursor.execute(f"ALTER TABLE sent_emails ADD COLUMN {col_name} {col_type}")
            except sqlite3.OperationalError:
                pass  # Column already exists
        
        # Migration: Add Outlook message tracking columns to sent_emails
        outlook_columns = [
            ('outlook_message_id', 'TEXT'),
            ('outlook_conversation_id', 'TEXT'),
            ('outlook_internet_message_id', 'TEXT'),
        ]
        for col_name, col_type in outlook_columns:
            try:
                cursor.execute(f"ALTER TABLE sent_emails ADD COLUMN {col_name} {col_type}")
            except sqlite3.OperationalError:
                pass  # Column already exists
        
        # Email replies table — stores actual reply content from Outlook
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS email_replies (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                sent_email_id INTEGER NOT NULL,
                campaign_contact_id INTEGER NOT NULL,
                contact_id INTEGER NOT NULL,
                outlook_message_id TEXT,
                from_address TEXT,
                subject TEXT,
                body_preview TEXT,
                received_at TIMESTAMP,
                detected_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (sent_email_id) REFERENCES sent_emails(id),
                FOREIGN KEY (campaign_contact_id) REFERENCES campaign_contacts(id),
                FOREIGN KEY (contact_id) REFERENCES linkedin_contacts(id)
            )
        """)
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_email_replies_sent_email ON email_replies(sent_email_id)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_email_replies_contact ON email_replies(contact_id)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_email_replies_received ON email_replies(received_at)")
        
        # Add index for review queue queries
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_sent_emails_review_status ON sent_emails(review_status)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_sent_emails_scheduled ON sent_emails(scheduled_send_time)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_sent_emails_conversation ON sent_emails(outlook_conversation_id)")
        
        # System config table — key-value settings
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS system_config (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)

        # App logs table - request/system logs for admin diagnostics
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS app_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL,
                level TEXT NOT NULL,
                feature TEXT,
                source TEXT,
                message TEXT NOT NULL,
                correlation_id TEXT,
                request_id TEXT,
                status_code INTEGER,
                duration_ms REAL,
                meta_json TEXT
            )
        """)
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_app_logs_timestamp ON app_logs(timestamp)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_app_logs_level ON app_logs(level)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_app_logs_feature ON app_logs(feature)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_app_logs_source ON app_logs(source)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_app_logs_correlation ON app_logs(correlation_id)")

        # API cost events table - normalized cost tracking by call
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS api_cost_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL,
                provider TEXT NOT NULL,
                model TEXT,
                feature TEXT,
                endpoint TEXT,
                correlation_id TEXT,
                request_id TEXT,
                usd REAL NOT NULL DEFAULT 0,
                input_tokens INTEGER,
                output_tokens INTEGER,
                meta_json TEXT
            )
        """)
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_cost_events_timestamp ON api_cost_events(timestamp)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_cost_events_provider ON api_cost_events(provider)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_cost_events_feature ON api_cost_events(feature)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_cost_events_model ON api_cost_events(model)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_cost_events_correlation ON api_cost_events(correlation_id)")

        # Unified semantic search chunks across CRM + email + files.
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS semantic_chunks (
                chunk_id TEXT PRIMARY KEY,
                source_type TEXT NOT NULL,
                source_id TEXT NOT NULL,
                chunk_type TEXT DEFAULT 'summary',
                text TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                metadata TEXT
            )
        """)
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_semantic_chunks_source ON semantic_chunks(source_type, source_id)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_semantic_chunks_created ON semantic_chunks(created_at)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_semantic_chunks_updated ON semantic_chunks(updated_at)")

        # Deterministic exact/lex index for fast local-first retrieval.
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS entity_search_index (
                entity_type TEXT NOT NULL,
                entity_id TEXT NOT NULL,
                name TEXT,
                emails TEXT,
                phones TEXT,
                domain TEXT,
                keywords TEXT,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (entity_type, entity_id)
            )
        """)
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_entity_search_updated ON entity_search_index(updated_at)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_entity_search_name ON entity_search_index(name)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_entity_search_domain ON entity_search_index(domain)")
        
        # Insert default config values
        default_configs = [
            ('daily_send_cap', '20'),
            ('send_window_start', '08:00'),
            ('send_window_end', '17:00'),
            ('min_minutes_between_sends', '20'),
            ('tracking_poll_interval_minutes', '90'),
            ('tracking_lookback_days', '14'),
        ]
        for key, value in default_configs:
            cursor.execute(
                "INSERT OR IGNORE INTO system_config (key, value) VALUES (?, ?)",
                (key, value)
            )


# ============ Target Operations ============

def add_target(
    company_name: str,
    domain: str = None,
    tier: str = None,
    vertical: str = None,
    target_reason: str = None,
    wedge: str = None,
    source_url: str = None, 
    source: str = None, 
    notes: str = None
) -> int:
    """
    Add a new target company. Returns the ID or -1 if duplicate.
    
    Args:
        company_name: Company name for LinkedIn search (required)
        domain: Optional company domain (for deduplication). If not provided,
                a slug of the company name is used.
        tier: Priority tier (A, B, C)
        vertical: Industry/vertical
        target_reason: Why this is a good target
        wedge: Sales angle / product fit
        source_url: Optional website URL
        source: Where this lead came from
        notes: Additional notes
    """
    import re
    
    # If no domain provided, create a slug from company name for uniqueness
    if not domain and company_name:
        # Convert "DRB Facility Services" -> "drb-facility-services"
        domain = re.sub(r'[^\w\s-]', '', company_name.lower())
        domain = re.sub(r'[\s_]+', '-', domain).strip('-')
    
    with get_db() as conn:
        try:
            cursor = conn.cursor()
            cursor.execute("""
                INSERT INTO targets (
                    company_name, domain, tier, vertical, target_reason, wedge,
                    source_url, source, notes
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (company_name, domain, tier, vertical, target_reason, wedge,
                  source_url, source, notes))
            return cursor.lastrowid
        except sqlite3.IntegrityError:
            return -1  # Duplicate


def get_pending_targets(limit: int = 100) -> List[Dict]:
    """Get targets that haven't been processed yet."""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT * FROM targets 
            WHERE status = 'pending'
            ORDER BY created_at
            LIMIT ?
        """, (limit,))
        return [dict(row) for row in cursor.fetchall()]


def update_target_status(domain: str = None, company_name: str = None, status: str = None):
    """
    Update a target's processing status.
    
    Uses company_name if provided (more reliable), otherwise falls back to domain.
    """
    if not status:
        raise ValueError("status is required")
    
    with get_db() as conn:
        cursor = conn.cursor()
        
        if company_name:
            # Use company_name for matching (more reliable than slugified domain)
            cursor.execute("""
                UPDATE targets 
                SET status = ?, updated_at = CURRENT_TIMESTAMP
                WHERE company_name = ?
            """, (status, company_name))
        elif domain:
            # Fallback to domain matching
            cursor.execute("""
                UPDATE targets 
                SET status = ?, updated_at = CURRENT_TIMESTAMP
                WHERE domain = ?
            """, (status, domain))
        else:
            raise ValueError("Either domain or company_name must be provided")


def validate_and_fix_target_status(company_name: str):
    """
    Validate that a company's status matches its actual data.
    If company has contacts, ensure status is 'completed'.
    """
    with get_db() as conn:
        cursor = conn.cursor()
        
        # Check if company has contacts
        cursor.execute("""
            SELECT COUNT(*) FROM linkedin_contacts 
            WHERE company_name = ?
        """, (company_name,))
        contact_count = cursor.fetchone()[0]
        
        if contact_count > 0:
            # Company has contacts, ensure it's marked as completed
            cursor.execute("""
                SELECT status FROM targets 
                WHERE company_name = ?
            """, (company_name,))
            result = cursor.fetchone()
            
            if result and result[0] != 'completed':
                # Fix the status
                cursor.execute("""
                    UPDATE targets 
                    SET status = 'completed', updated_at = CURRENT_TIMESTAMP
                    WHERE company_name = ?
                """, (company_name,))
                return True
        
        return False


def validate_all_target_statuses():
    """
    Validate and fix all target statuses based on actual contact data.
    Ensures companies with contacts are marked as 'completed'.
    Also resets companies stuck in 'processing' for too long.
    Returns count of fixed companies.
    """
    with get_db() as conn:
        cursor = conn.cursor()
        fixed_count = 0
        
        # Fix companies with contacts but wrong status
        cursor.execute("""
            UPDATE targets 
            SET status = 'completed', updated_at = CURRENT_TIMESTAMP
            WHERE company_name IN (
                SELECT DISTINCT company_name
                FROM linkedin_contacts
                WHERE company_name IS NOT NULL
            )
            AND status != 'completed'
        """)
        fixed_count += cursor.rowcount
        
        # Reset companies stuck in 'processing' for more than 1 hour
        # (likely from interrupted/crashed runs)
        cursor.execute("""
            UPDATE targets 
            SET status = CASE 
                WHEN company_name IN (
                    SELECT DISTINCT company_name FROM linkedin_contacts
                ) THEN 'completed'
                ELSE 'pending'
            END,
            updated_at = CURRENT_TIMESTAMP
            WHERE status = 'processing'
            AND (
                updated_at < datetime('now', '-1 hour')
                OR updated_at IS NULL
            )
        """)
        fixed_count += cursor.rowcount
        
        return fixed_count


# ============ Page Operations ============

def add_page(domain: str, url: str, page_type: str = None) -> int:
    """Add a page record. Returns ID or -1 if duplicate."""
    with get_db() as conn:
        try:
            cursor = conn.cursor()
            cursor.execute("""
                INSERT INTO pages (domain, url, page_type)
                VALUES (?, ?, ?)
            """, (domain, url, page_type))
            return cursor.lastrowid
        except sqlite3.IntegrityError:
            return -1


def update_page_content(
    url: str,
    text_path: str = None,
    html_path: str = None,
    meta_json: dict = None,
    emails_found: List[str] = None,
    phones_found: List[str] = None,
    internal_links: List[dict] = None,
    fetch_status: str = "fetched"
):
    """Update a page with fetched content."""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            UPDATE pages SET
                text_path = ?,
                html_path = ?,
                meta_json = ?,
                emails_found = ?,
                phones_found = ?,
                internal_links = ?,
                fetch_status = ?,
                fetched_at = CURRENT_TIMESTAMP
            WHERE url = ?
        """, (
            text_path,
            html_path,
            json.dumps(meta_json) if meta_json else None,
            json.dumps(emails_found) if emails_found else None,
            json.dumps(phones_found) if phones_found else None,
            json.dumps(internal_links) if internal_links else None,
            fetch_status,
            url
        ))


def get_pages_for_domain(domain: str) -> List[Dict]:
    """Get all pages for a domain."""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM pages WHERE domain = ?", (domain,))
        return [dict(row) for row in cursor.fetchall()]


def get_unfetched_pages(limit: int = 50) -> List[Dict]:
    """Get pages that haven't been fetched yet."""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT * FROM pages 
            WHERE fetch_status = 'pending'
            LIMIT ?
        """, (limit,))
        return [dict(row) for row in cursor.fetchall()]


# ============ Candidate Operations ============

def add_candidate(
    domain: str,
    company_name: str = None,
    company_info: str = None,
    contacts: List[dict] = None,
    fit_score: float = None,
    contact_quality_score: float = None,
    evidence_score: float = None,
    confidence: float = None,
    fit_reason: str = None,
    domain_summary: str = None
) -> int:
    """Add or update a candidate for a domain."""
    overall_score = None
    if all(s is not None for s in [fit_score, contact_quality_score, evidence_score]):
        overall_score = (fit_score * 0.4 + contact_quality_score * 0.35 + evidence_score * 0.25)
    
    with get_db() as conn:
        cursor = conn.cursor()
        # Check if exists
        cursor.execute("SELECT id FROM candidates WHERE domain = ?", (domain,))
        existing = cursor.fetchone()
        
        if existing:
            cursor.execute("""
                UPDATE candidates SET
                    company_name = COALESCE(?, company_name),
                    company_info = COALESCE(?, company_info),
                    contacts_json = COALESCE(?, contacts_json),
                    fit_score = COALESCE(?, fit_score),
                    contact_quality_score = COALESCE(?, contact_quality_score),
                    evidence_score = COALESCE(?, evidence_score),
                    overall_score = COALESCE(?, overall_score),
                    confidence = COALESCE(?, confidence),
                    fit_reason = COALESCE(?, fit_reason),
                    domain_summary = COALESCE(?, domain_summary),
                    llm_extracted_at = CURRENT_TIMESTAMP
                WHERE domain = ?
            """, (
                company_name, company_info, 
                json.dumps(contacts) if contacts else None,
                fit_score, contact_quality_score, evidence_score, overall_score,
                confidence, fit_reason, domain_summary, domain
            ))
            return existing['id']
        else:
            cursor.execute("""
                INSERT INTO candidates (
                    domain, company_name, company_info, contacts_json,
                    fit_score, contact_quality_score, evidence_score, overall_score,
                    confidence, fit_reason, domain_summary, llm_extracted_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            """, (
                domain, company_name, company_info,
                json.dumps(contacts) if contacts else None,
                fit_score, contact_quality_score, evidence_score, overall_score,
                confidence, fit_reason, domain_summary
            ))
            return cursor.lastrowid


def get_candidates_for_sending(limit: int = 250, min_score: float = 0.5) -> List[Dict]:
    """Get scored candidates ready for send queue."""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT c.* FROM candidates c
            WHERE c.overall_score >= ?
            AND c.confidence >= ?
            AND NOT EXISTS (
                SELECT 1 FROM send_queue sq 
                WHERE sq.candidate_id = c.id 
                AND sq.status IN ('sent', 'pending')
            )
            ORDER BY c.overall_score DESC
            LIMIT ?
        """, (min_score, config.MIN_CONFIDENCE_TO_SEND, limit))
        return [dict(row) for row in cursor.fetchall()]


# ============ Send Queue Operations ============

def add_to_send_queue(
    candidate_id: int,
    contact_name: str,
    contact_email: str,
    contact_title: str,
    planned_subject: str,
    planned_body: str,
    personalization: str = None,
    priority: int = 0,
    scheduled_date: str = None
) -> int:
    """Add an item to the send queue."""
    with get_db() as conn:
        cursor = conn.cursor()
        # Check for duplicate email in queue
        if contact_email:
            cursor.execute("""
                SELECT id FROM send_queue 
                WHERE contact_email = ? AND status IN ('pending', 'sent')
            """, (contact_email,))
            if cursor.fetchone():
                return -1  # Already in queue
        
        cursor.execute("""
            INSERT INTO send_queue (
                candidate_id, contact_name, contact_email, contact_title,
                planned_subject, planned_body, personalization, priority, scheduled_date
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            candidate_id, contact_name, contact_email, contact_title,
            planned_subject, planned_body, personalization, priority,
            scheduled_date or datetime.now().strftime("%Y-%m-%d")
        ))
        return cursor.lastrowid


def get_pending_sends(limit: int = 250, date: str = None) -> List[Dict]:
    """Get pending sends for today (or specified date)."""
    if date is None:
        date = datetime.now().strftime("%Y-%m-%d")
    
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT sq.*, c.domain, c.company_name, c.company_info
            FROM send_queue sq
            JOIN candidates c ON sq.candidate_id = c.id
            WHERE sq.status = 'pending'
            AND sq.do_not_send = 0
            AND sq.scheduled_date <= ?
            ORDER BY sq.priority DESC, sq.created_at
            LIMIT ?
        """, (date, limit))
        return [dict(row) for row in cursor.fetchall()]


def update_send_queue_status(send_id: int, status: str, sf_record_url: str = None):
    """Update send queue item status."""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            UPDATE send_queue SET status = ?, sf_record_url = ?
            WHERE id = ?
        """, (status, sf_record_url, send_id))


def mark_do_not_send(send_id: int, reason: str):
    """Mark a send queue item as do-not-send."""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            UPDATE send_queue SET do_not_send = 1, do_not_send_reason = ?
            WHERE id = ?
        """, (reason, send_id))


# ============ Send Log Operations ============

def log_send_result(
    send_queue_id: int,
    result: str,
    sf_record_url: str = None,
    sf_activity_id: str = None,
    details: str = None,
    screenshot_path: str = None
):
    """Log the result of a send attempt."""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO send_log (
                send_queue_id, sf_record_url, sf_activity_id, result, details, screenshot_path
            ) VALUES (?, ?, ?, ?, ?, ?)
        """, (send_queue_id, sf_record_url, sf_activity_id, result, details, screenshot_path))


def get_daily_send_stats(date: str = None) -> Dict:
    """Get send statistics for a given date."""
    if date is None:
        date = datetime.now().strftime("%Y-%m-%d")
    
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT 
                result,
                COUNT(*) as count
            FROM send_log
            WHERE DATE(timestamp) = ?
            GROUP BY result
        """, (date,))
        
        stats = {"sent": 0, "failed": 0, "skipped": 0}
        for row in cursor.fetchall():
            stats[row['result']] = row['count']
        return stats


# ============ LLM Usage Tracking ============

def log_llm_usage(
    domain: str,
    call_type: str,
    input_tokens: int,
    output_tokens: int
):
    """Log LLM API usage for budget tracking."""
    # Rough cost estimate for gpt-4o-mini
    cost = (input_tokens * 0.00015 + output_tokens * 0.0006) / 1000
    
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO llm_usage (date, domain, call_type, input_tokens, output_tokens, cost_estimate)
            VALUES (DATE('now'), ?, ?, ?, ?, ?)
        """, (domain, call_type, input_tokens, output_tokens, cost))


def get_daily_llm_usage(date: str = None) -> Dict:
    """Get LLM usage for a given date."""
    if date is None:
        date = datetime.now().strftime("%Y-%m-%d")
    
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT 
                COUNT(*) as calls,
                SUM(input_tokens) as total_input,
                SUM(output_tokens) as total_output,
                SUM(cost_estimate) as total_cost
            FROM llm_usage
            WHERE date = ?
        """, (date,))
        row = cursor.fetchone()
        return dict(row) if row else {"calls": 0, "total_input": 0, "total_output": 0, "total_cost": 0}


def can_make_llm_call() -> bool:
    """Check if we're under the daily LLM cap."""
    usage = get_daily_llm_usage()
    return usage['calls'] < config.LLM_CALLS_PER_DAY_CAP


# ============ Email Campaign Operations ============

def create_email_campaign(
    name: str,
    description: str = None,
    num_emails: int = 3,
    days_between_emails: int = 3
) -> int:
    """Create a new email campaign. Returns the campaign ID."""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO email_campaigns (name, description, num_emails, days_between_emails)
            VALUES (?, ?, ?, ?)
        """, (name, description, num_emails, days_between_emails))
        return cursor.lastrowid


def get_email_campaigns(status: str = None) -> List[Dict]:
    """Get all email campaigns, optionally filtered by status."""
    with get_db() as conn:
        cursor = conn.cursor()
        if status:
            cursor.execute("SELECT * FROM email_campaigns WHERE status = ? ORDER BY created_at DESC", (status,))
        else:
            cursor.execute("SELECT * FROM email_campaigns ORDER BY created_at DESC")
        return [dict(row) for row in cursor.fetchall()]


def get_email_campaign(campaign_id: int) -> Optional[Dict]:
    """Get a single email campaign with its templates."""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM email_campaigns WHERE id = ?", (campaign_id,))
        row = cursor.fetchone()
        if not row:
            return None
        campaign = dict(row)
        
        # Get templates
        cursor.execute("""
            SELECT * FROM email_templates 
            WHERE campaign_id = ? 
            ORDER BY step_number
        """, (campaign_id,))
        campaign['templates'] = [dict(r) for r in cursor.fetchall()]
        
        return campaign


def update_email_campaign(
    campaign_id: int,
    name: str = None,
    description: str = None,
    num_emails: int = None,
    days_between_emails: int = None,
    status: str = None
):
    """Update an email campaign."""
    updates = []
    params = []
    
    if name is not None:
        updates.append("name = ?")
        params.append(name)
    if description is not None:
        updates.append("description = ?")
        params.append(description)
    if num_emails is not None:
        updates.append("num_emails = ?")
        params.append(num_emails)
    if days_between_emails is not None:
        updates.append("days_between_emails = ?")
        params.append(days_between_emails)
    if status is not None:
        updates.append("status = ?")
        params.append(status)
    
    if not updates:
        return
    
    updates.append("updated_at = CURRENT_TIMESTAMP")
    params.append(campaign_id)
    
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute(f"""
            UPDATE email_campaigns SET {', '.join(updates)}
            WHERE id = ?
        """, params)


def delete_email_campaign(campaign_id: int):
    """Delete an email campaign and all related data."""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM email_campaigns WHERE id = ?", (campaign_id,))


# ============ Email Template Operations ============

def save_email_template(
    campaign_id: int,
    step_number: int,
    subject_template: str,
    body_template: str
) -> int:
    """Save or update an email template for a campaign step."""
    with get_db() as conn:
        cursor = conn.cursor()
        # Try update first, then insert
        cursor.execute("""
            INSERT OR REPLACE INTO email_templates (campaign_id, step_number, subject_template, body_template)
            VALUES (?, ?, ?, ?)
        """, (campaign_id, step_number, subject_template, body_template))
        return cursor.lastrowid


def get_email_templates(campaign_id: int) -> List[Dict]:
    """Get all templates for a campaign."""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT * FROM email_templates 
            WHERE campaign_id = ? 
            ORDER BY step_number
        """, (campaign_id,))
        return [dict(row) for row in cursor.fetchall()]


# ============ Campaign Contact Operations ============

def enroll_contacts_in_campaign(campaign_id: int, contact_ids: List[int]) -> Dict:
    """Enroll contacts in a campaign. Returns count of enrolled vs skipped."""
    enrolled = 0
    skipped = 0
    
    with get_db() as conn:
        cursor = conn.cursor()
        
        # Get campaign info for next_email_at calculation
        cursor.execute("SELECT days_between_emails FROM email_campaigns WHERE id = ?", (campaign_id,))
        campaign = cursor.fetchone()
        if not campaign:
            return {'enrolled': 0, 'skipped': 0, 'error': 'Campaign not found'}
        
        for contact_id in contact_ids:
            try:
                cursor.execute("""
                    INSERT INTO campaign_contacts (campaign_id, contact_id, next_email_at)
                    VALUES (?, ?, datetime('now'))
                """, (campaign_id, contact_id))
                enrolled += 1
            except sqlite3.IntegrityError:
                skipped += 1  # Already enrolled
    
    return {'enrolled': enrolled, 'skipped': skipped}


def get_campaign_contacts(campaign_id: int, status: str = None) -> List[Dict]:
    """Get contacts enrolled in a campaign with their details."""
    with get_db() as conn:
        cursor = conn.cursor()
        query = """
            SELECT 
                cc.*,
                lc.name as contact_name,
                lc.email_generated as email,
                lc.title,
                lc.company_name,
                lc.domain
            FROM campaign_contacts cc
            JOIN linkedin_contacts lc ON cc.contact_id = lc.id
            WHERE cc.campaign_id = ?
        """
        params = [campaign_id]
        
        if status:
            query += " AND cc.status = ?"
            params.append(status)
        
        query += " ORDER BY cc.enrolled_at DESC"
        
        cursor.execute(query, params)
        return [dict(row) for row in cursor.fetchall()]


def get_contacts_ready_for_email(campaign_id: int = None, limit: int = 50) -> List[Dict]:
    """Get campaign contacts ready to receive their next email."""
    with get_db() as conn:
        cursor = conn.cursor()
        query = """
            SELECT 
                cc.*,
                lc.name as contact_name,
                lc.email_generated as email,
                lc.title,
                lc.company_name,
                lc.domain,
                ec.name as campaign_name,
                ec.num_emails,
                ec.days_between_emails
            FROM campaign_contacts cc
            JOIN linkedin_contacts lc ON cc.contact_id = lc.id
            JOIN email_campaigns ec ON cc.campaign_id = ec.id
            WHERE cc.status = 'active'
            AND cc.current_step < ec.num_emails
            AND cc.next_email_at <= datetime('now')
            AND ec.status = 'active'
        """
        params = []
        
        if campaign_id:
            query += " AND cc.campaign_id = ?"
            params.append(campaign_id)
        
        query += " ORDER BY cc.next_email_at ASC LIMIT ?"
        params.append(limit)
        
        cursor.execute(query, params)
        return [dict(row) for row in cursor.fetchall()]


def update_campaign_contact(
    campaign_contact_id: int,
    current_step: int = None,
    status: str = None,
    sf_lead_url: str = None,
    next_email_at: str = None
):
    """Update a campaign contact's status."""
    updates = []
    params = []
    
    if current_step is not None:
        updates.append("current_step = ?")
        params.append(current_step)
    if status is not None:
        updates.append("status = ?")
        params.append(status)
    if sf_lead_url is not None:
        updates.append("sf_lead_url = ?")
        params.append(sf_lead_url)
    if next_email_at is not None:
        updates.append("next_email_at = ?")
        params.append(next_email_at)
    
    if not updates:
        return
    
    params.append(campaign_contact_id)
    
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute(f"""
            UPDATE campaign_contacts SET {', '.join(updates)}
            WHERE id = ?
        """, params)


def remove_contact_from_campaign(campaign_contact_id: int):
    """Remove a contact from a campaign."""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM campaign_contacts WHERE id = ?", (campaign_contact_id,))


# ============ Sent Email Operations ============

def log_sent_email(
    campaign_id: int,
    campaign_contact_id: int,
    contact_id: int,
    step_number: int,
    subject: str,
    body: str,
    sf_lead_url: str = None,
    status: str = 'sent',
    error_message: str = None,
    screenshot_path: str = None
) -> int:
    """Log a sent email. Sets both status and review_status to 'sent' for reply tracking."""
    with get_db() as conn:
        cursor = conn.cursor()
        # Set review_status='sent' if status='sent' so reply monitoring works
        review_status = 'sent' if status == 'sent' else 'failed'
        cursor.execute("""
            INSERT INTO sent_emails (
                campaign_id, campaign_contact_id, contact_id, step_number,
                subject, body, sf_lead_url, status, review_status, sent_at, error_message, screenshot_path
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?, ?)
        """, (
            campaign_id, campaign_contact_id, contact_id, step_number,
            subject, body, sf_lead_url, status, review_status, error_message, screenshot_path
        ))
        return cursor.lastrowid


def get_sent_emails(
    campaign_id: int = None,
    contact_id: int = None,
    limit: int = 100
) -> List[Dict]:
    """Get sent emails with optional filters."""
    with get_db() as conn:
        cursor = conn.cursor()
        query = """
            SELECT 
                se.*,
                lc.name as contact_name,
                lc.company_name,
                ec.name as campaign_name
            FROM sent_emails se
            JOIN linkedin_contacts lc ON se.contact_id = lc.id
            JOIN email_campaigns ec ON se.campaign_id = ec.id
            WHERE 1=1
        """
        params = []
        
        if campaign_id:
            query += " AND se.campaign_id = ?"
            params.append(campaign_id)
        if contact_id:
            query += " AND se.contact_id = ?"
            params.append(contact_id)
        
        query += " ORDER BY se.sent_at DESC LIMIT ?"
        params.append(limit)
        
        cursor.execute(query, params)
        return [dict(row) for row in cursor.fetchall()]


def get_email_campaign_stats(campaign_id: int = None) -> Dict:
    """Get email campaign statistics."""
    with get_db() as conn:
        cursor = conn.cursor()
        
        if campaign_id:
            # Stats for a specific campaign
            cursor.execute("""
                SELECT COUNT(*) as total_contacts FROM campaign_contacts WHERE campaign_id = ?
            """, (campaign_id,))
            total_contacts = cursor.fetchone()['total_contacts']
            
            cursor.execute("""
                SELECT COUNT(*) as active FROM campaign_contacts WHERE campaign_id = ? AND status = 'active'
            """, (campaign_id,))
            active = cursor.fetchone()['active']
            
            cursor.execute("""
                SELECT COUNT(*) as completed FROM campaign_contacts WHERE campaign_id = ? AND status = 'completed'
            """, (campaign_id,))
            completed = cursor.fetchone()['completed']
            
            cursor.execute("""
                SELECT COUNT(*) as total_sent FROM sent_emails WHERE campaign_id = ?
            """, (campaign_id,))
            total_sent = cursor.fetchone()['total_sent']
            
            cursor.execute("""
                SELECT COUNT(*) as failed FROM sent_emails WHERE campaign_id = ? AND status = 'failed'
            """, (campaign_id,))
            failed = cursor.fetchone()['failed']
            
            return {
                'total_contacts': total_contacts,
                'active': active,
                'completed': completed,
                'total_sent': total_sent,
                'failed': failed
            }
        else:
            # Overall stats
            cursor.execute("SELECT COUNT(*) as total FROM email_campaigns")
            total_campaigns = cursor.fetchone()['total']
            
            cursor.execute("SELECT COUNT(*) as active FROM email_campaigns WHERE status = 'active'")
            active_campaigns = cursor.fetchone()['active']
            
            cursor.execute("SELECT COUNT(*) as total FROM campaign_contacts")
            total_contacts = cursor.fetchone()['total']
            
            cursor.execute("SELECT COUNT(*) as total FROM sent_emails")
            total_sent = cursor.fetchone()['total']
            
            cursor.execute("SELECT COUNT(*) as today FROM sent_emails WHERE DATE(sent_at) = DATE('now')")
            sent_today = cursor.fetchone()['today']
            
            return {
                'total_campaigns': total_campaigns,
                'active_campaigns': active_campaigns,
                'total_contacts_enrolled': total_contacts,
                'total_sent': total_sent,
                'sent_today': sent_today
            }


# ============ System Config Operations ============

def get_config(key: str, default: str = None) -> str:
    """Get a system config value."""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT value FROM system_config WHERE key = ?", (key,))
        row = cursor.fetchone()
        return row['value'] if row else default


def set_config(key: str, value: str):
    """Set a system config value."""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            INSERT OR REPLACE INTO system_config (key, value, updated_at)
            VALUES (?, ?, CURRENT_TIMESTAMP)
        """, (key, value))


def get_all_config() -> Dict:
    """Get all system config values as a dict."""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT key, value FROM system_config")
        return {row['key']: row['value'] for row in cursor.fetchall()}


# ============ Admin Logs & Cost Monitoring ============

def _range_to_start_timestamp(range_key: str) -> str:
    now = datetime.utcnow()
    if range_key == "today":
        start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    elif range_key == "7d":
        start = now - timedelta(days=7)
    elif range_key == "30d":
        start = now - timedelta(days=30)
    else:
        start = now - timedelta(days=1)
    return start.isoformat()


def _time_range_to_start_timestamp(time_range: str) -> str:
    now = datetime.utcnow()
    if time_range == "15m":
        start = now - timedelta(minutes=15)
    elif time_range == "1h":
        start = now - timedelta(hours=1)
    elif time_range == "24h":
        start = now - timedelta(hours=24)
    elif time_range == "7d":
        start = now - timedelta(days=7)
    else:
        start = now - timedelta(hours=1)
    return start.isoformat()


def insert_log(row: Dict[str, Any]) -> int:
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO app_logs (
                timestamp, level, feature, source, message, correlation_id, request_id,
                status_code, duration_ms, meta_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                row.get("timestamp") or datetime.utcnow().isoformat(),
                row.get("level", "info"),
                row.get("feature"),
                row.get("source"),
                row.get("message", ""),
                row.get("correlation_id"),
                row.get("request_id"),
                row.get("status_code"),
                row.get("duration_ms"),
                json.dumps(row.get("meta_json") or {}),
            ),
        )
        return int(cursor.lastrowid)


def query_logs(filters: Dict[str, Any]) -> List[Dict[str, Any]]:
    limit = int(filters.get("limit") or 200)
    limit = max(1, min(limit, 1000))

    sql = "SELECT * FROM app_logs WHERE 1=1"
    params: List[Any] = []

    time_range = filters.get("time_range")
    if time_range:
        sql += " AND timestamp >= ?"
        params.append(_time_range_to_start_timestamp(time_range))

    if filters.get("q"):
        sql += " AND (message LIKE ? OR feature LIKE ? OR source LIKE ?)"
        q = f"%{filters['q']}%"
        params.extend([q, q, q])

    if filters.get("level"):
        sql += " AND level = ?"
        params.append(filters["level"])

    if filters.get("feature"):
        sql += " AND feature = ?"
        params.append(filters["feature"])

    if filters.get("source"):
        sql += " AND source = ?"
        params.append(filters["source"])

    if filters.get("correlation_id"):
        sql += " AND correlation_id = ?"
        params.append(filters["correlation_id"])

    sql += " ORDER BY timestamp DESC LIMIT ?"
    params.append(limit)

    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute(sql, params)
        rows = [dict(r) for r in cursor.fetchall()]

    for row in rows:
        try:
            row["meta_json"] = json.loads(row.get("meta_json") or "{}")
        except Exception:
            row["meta_json"] = {}
    return rows


def insert_cost_event(row: Dict[str, Any]) -> int:
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO api_cost_events (
                timestamp, provider, model, feature, endpoint, correlation_id, request_id,
                usd, input_tokens, output_tokens, meta_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                row.get("timestamp") or datetime.utcnow().isoformat(),
                row.get("provider"),
                row.get("model"),
                row.get("feature"),
                row.get("endpoint"),
                row.get("correlation_id"),
                row.get("request_id"),
                float(row.get("usd") or 0.0),
                row.get("input_tokens"),
                row.get("output_tokens"),
                json.dumps(row.get("meta_json") or {}),
            ),
        )
        return int(cursor.lastrowid)


def _p95(values: List[float]) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    idx = max(0, math.ceil(len(ordered) * 0.95) - 1)
    return float(ordered[idx])


def aggregate_costs(range_key: str) -> Dict[str, Any]:
    start_ts = _range_to_start_timestamp(range_key)
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT timestamp, provider, model, feature, endpoint, correlation_id, request_id, usd,
                   input_tokens, output_tokens, meta_json
            FROM api_cost_events
            WHERE timestamp >= ?
            ORDER BY timestamp DESC
            """,
            (start_ts,),
        )
        rows = [dict(r) for r in cursor.fetchall()]

    normalized = []
    for row in rows:
        raw_meta = row.get("meta_json")
        try:
            meta = json.loads(raw_meta or "{}")
        except Exception:
            meta = {}
        if not isinstance(meta, dict):
            meta = {}
        try:
            usd = float(row.get("usd") or 0.0)
        except Exception:
            usd = 0.0
        if not math.isfinite(usd):
            usd = 0.0
        normalized.append({**row, "meta_json": meta, "usd": usd})

    total_usd = sum(r["usd"] for r in normalized)
    openai_usd = sum(r["usd"] for r in normalized if r.get("provider") == "openai")
    tavily_usd = sum(r["usd"] for r in normalized if r.get("provider") == "tavily")
    requests = len(normalized)
    avg_cost = (total_usd / requests) if requests else 0.0
    p95 = _p95([r["usd"] for r in normalized])

    feature_map: Dict[str, Dict[str, Any]] = {}
    model_map: Dict[str, Dict[str, Any]] = {}
    expensive_map: Dict[tuple, Dict[str, Any]] = {}
    daily_map: Dict[str, Dict[str, Any]] = {}

    for row in normalized:
        feature_key = row.get("feature") or "unknown"
        model_key = row.get("model") or row.get("provider") or "unknown"
        tool = row["meta_json"].get("tool")
        error_flag = 1 if row["meta_json"].get("error") else 0

        f = feature_map.setdefault(feature_key, {"key": feature_key, "requests": 0, "total_usd": 0.0, "errors": 0})
        f["requests"] += 1
        f["total_usd"] += row["usd"]
        f["errors"] += error_flag

        m = model_map.setdefault(model_key, {"key": model_key, "requests": 0, "total_usd": 0.0, "errors": 0})
        m["requests"] += 1
        m["total_usd"] += row["usd"]
        m["errors"] += error_flag

        exp_key = (row.get("correlation_id"), row.get("endpoint"), tool)
        e = expensive_map.setdefault(
            exp_key,
            {
                "correlation_id": row.get("correlation_id"),
                "endpoint": row.get("endpoint"),
                "tool": tool,
                "total_usd": 0.0,
                "requests": 0,
            },
        )
        e["total_usd"] += row["usd"]
        e["requests"] += 1

        date_key = str(row.get("timestamp") or "")[:10]
        d = daily_map.setdefault(date_key, {"date": date_key, "total_usd": 0.0, "openai_usd": 0.0, "tavily_usd": 0.0})
        d["total_usd"] += row["usd"]
        if row.get("provider") == "openai":
            d["openai_usd"] += row["usd"]
        elif row.get("provider") == "tavily":
            d["tavily_usd"] += row["usd"]

    by_feature = [
        {
            **v,
            "avg_usd": (v["total_usd"] / v["requests"]) if v["requests"] else 0.0,
        }
        for v in feature_map.values()
    ]
    by_feature.sort(key=lambda x: x["total_usd"], reverse=True)

    by_model = [
        {
            **v,
            "avg_usd": (v["total_usd"] / v["requests"]) if v["requests"] else 0.0,
        }
        for v in model_map.values()
    ]
    by_model.sort(key=lambda x: x["total_usd"], reverse=True)

    top_expensive = list(expensive_map.values())
    top_expensive.sort(key=lambda x: x["total_usd"], reverse=True)

    daily = list(daily_map.values())
    daily.sort(key=lambda x: x["date"])

    return {
        "summary": {
            "total_usd": round(total_usd, 6),
            "openai_usd": round(openai_usd, 6),
            "tavily_usd": round(tavily_usd, 6),
            "requests": requests,
            "avg_cost_usd": round(avg_cost, 6),
            "p95_cost_usd": round(p95, 6),
        },
        "by_feature": by_feature,
        "by_model": by_model,
        "top_expensive": top_expensive[:20],
        "daily": daily,
    }


# ============ Review Queue Operations ============

def get_review_queue(limit: int = 50) -> List[Dict]:
    """Get emails pending review (review_status = 'ready_for_review').
    Joins with linkedin_contacts and email_campaigns for display data."""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT 
                se.*,
                lc.name as contact_name,
                lc.company_name,
                lc.title as contact_title,
                lc.email_generated as contact_email,
                ec.name as campaign_name,
                ec.num_emails
            FROM sent_emails se
            JOIN linkedin_contacts lc ON se.contact_id = lc.id
            JOIN email_campaigns ec ON se.campaign_id = ec.id
            WHERE se.review_status = 'ready_for_review'
            ORDER BY se.id ASC
            LIMIT ?
        """, (limit,))
        return [dict(row) for row in cursor.fetchall()]


def approve_email(sent_email_id: int, edited_subject: str = None, edited_body: str = None):
    """Approve a draft email. Optionally update subject/body if user edited.
    Sets review_status = 'approved', approved_at = now.
    Assigns scheduled_send_time based on config and existing schedule."""
    with get_db() as conn:
        cursor = conn.cursor()
        
        updates = ["review_status = 'approved'", "approved_at = CURRENT_TIMESTAMP"]
        params = []
        
        if edited_subject is not None:
            updates.append("rendered_subject = ?")
            params.append(edited_subject)
        if edited_body is not None:
            updates.append("rendered_body = ?")
            params.append(edited_body)
        
        # Calculate scheduled send time
        send_time = _calculate_next_send_time(cursor)
        updates.append("scheduled_send_time = ?")
        params.append(send_time)
        
        params.append(sent_email_id)
        
        cursor.execute(f"""
            UPDATE sent_emails SET {', '.join(updates)}
            WHERE id = ?
        """, params)


def reject_email(sent_email_id: int, reason: str = None):
    """Reject a draft. Sets review_status = 'rejected'."""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            UPDATE sent_emails 
            SET review_status = 'rejected', error_message = ?
            WHERE id = ?
        """, (reason, sent_email_id))


def approve_all_emails(sent_email_ids: List[int]):
    """Bulk approve. Each gets a unique scheduled_send_time spread across the send window."""
    with get_db() as conn:
        cursor = conn.cursor()
        
        # Get existing scheduled times for today
        existing_times = _get_existing_scheduled_times(cursor)
        send_times = calculate_send_times(len(sent_email_ids), existing_times)
        
        for i, email_id in enumerate(sent_email_ids):
            send_time = send_times[i] if i < len(send_times) else send_times[-1] if send_times else None
            cursor.execute("""
                UPDATE sent_emails 
                SET review_status = 'approved', 
                    approved_at = CURRENT_TIMESTAMP,
                    scheduled_send_time = ?
                WHERE id = ?
            """, (send_time, email_id))


def get_scheduled_emails(limit: int = 10) -> List[Dict]:
    """Get approved emails where scheduled_send_time <= now and review_status = 'approved'.
    These are ready for the Salesforce bot to send."""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT 
                se.*,
                lc.name as contact_name,
                lc.company_name,
                lc.title as contact_title,
                lc.email_generated as contact_email,
                ec.name as campaign_name,
                ec.num_emails,
                ec.days_between_emails,
                cc.id as campaign_contact_id
            FROM sent_emails se
            JOIN linkedin_contacts lc ON se.contact_id = lc.id
            JOIN email_campaigns ec ON se.campaign_id = ec.id
            JOIN campaign_contacts cc ON se.campaign_contact_id = cc.id
            WHERE se.review_status = 'approved'
            AND se.scheduled_send_time <= datetime('now')
            ORDER BY se.scheduled_send_time ASC
            LIMIT ?
        """, (limit,))
        return [dict(row) for row in cursor.fetchall()]


def get_all_scheduled_emails(campaign_id: int = None, limit: int = 200) -> List[Dict]:
    """Get ALL approved emails with future scheduled_send_time (not yet sent).
    Used for the Scheduled tab UI."""
    with get_db() as conn:
        cursor = conn.cursor()
        query = """
            SELECT 
                se.id, se.campaign_id, se.contact_id, se.step_number,
                se.subject, se.body, se.rendered_subject, se.rendered_body,
                se.review_status, se.scheduled_send_time, se.status,
                se.opened, se.open_count, se.first_opened_at,
                se.replied, se.replied_at,
                lc.name as contact_name,
                lc.company_name,
                lc.title as contact_title,
                lc.email_generated as contact_email,
                lc.linkedin_url as contact_linkedin,
                ec.name as campaign_name,
                ec.num_emails,
                ec.days_between_emails,
                cc.id as campaign_contact_id
            FROM sent_emails se
            JOIN linkedin_contacts lc ON se.contact_id = lc.id
            JOIN email_campaigns ec ON se.campaign_id = ec.id
            JOIN campaign_contacts cc ON se.campaign_contact_id = cc.id
            WHERE se.review_status = 'approved'
            AND (se.status IS NULL OR se.status = 'draft' OR se.status = 'pending')
            AND se.scheduled_send_time IS NOT NULL
        """
        params = []
        if campaign_id:
            query += " AND se.campaign_id = ?"
            params.append(campaign_id)
        
        query += " ORDER BY se.scheduled_send_time ASC LIMIT ?"
        params.append(limit)
        
        cursor.execute(query, params)
        return [dict(row) for row in cursor.fetchall()]


def reschedule_email(sent_email_id: int, new_send_time: str):
    """Reschedule a single email to a new send time."""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            UPDATE sent_emails 
            SET scheduled_send_time = ?
            WHERE id = ? AND review_status = 'approved'
        """, (new_send_time, sent_email_id))
        return cursor.rowcount > 0


def reorder_scheduled_emails(email_ids: List[int], start_time: str = None):
    """Reorder scheduled emails. Assigns new send times with 1-minute spacing
    starting from the given time (or the earliest existing time)."""
    from datetime import timedelta
    
    with get_db() as conn:
        cursor = conn.cursor()
        
        if not start_time:
            # Use the earliest scheduled time from the provided emails
            placeholders = ','.join(['?'] * len(email_ids))
            cursor.execute(f"""
                SELECT MIN(scheduled_send_time) as earliest 
                FROM sent_emails 
                WHERE id IN ({placeholders})
            """, email_ids)
            row = cursor.fetchone()
            start_time = row['earliest'] if row and row['earliest'] else datetime.now().isoformat()
        
        base_time = datetime.fromisoformat(start_time)
        
        for i, email_id in enumerate(email_ids):
            new_time = base_time + timedelta(minutes=i)
            cursor.execute("""
                UPDATE sent_emails 
                SET scheduled_send_time = ?
                WHERE id = ? AND review_status = 'approved'
            """, (new_time.isoformat(), email_id))
        
        return True


def get_email_detail(sent_email_id: int) -> Optional[Dict]:
    """Get detailed info for a single scheduled/sent email including sequence history."""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT 
                se.*, 
                lc.name as contact_name,
                lc.company_name,
                lc.title as contact_title,
                lc.email_generated as contact_email,
                lc.linkedin_url as contact_linkedin,
                ec.name as campaign_name,
                ec.num_emails,
                ec.days_between_emails,
                cc.id as campaign_contact_id,
                cc.current_step,
                cc.status as enrollment_status
            FROM sent_emails se
            JOIN linkedin_contacts lc ON se.contact_id = lc.id
            JOIN email_campaigns ec ON se.campaign_id = ec.id
            JOIN campaign_contacts cc ON se.campaign_contact_id = cc.id
            WHERE se.id = ?
        """, (sent_email_id,))
        email = cursor.fetchone()
        if not email:
            return None
        
        result = dict(email)
        
        # Get all emails in the same sequence (same contact + campaign)
        cursor.execute("""
            SELECT id, step_number, subject, rendered_subject, status, review_status,
                   sent_at, scheduled_send_time, opened, open_count, replied, replied_at
            FROM sent_emails
            WHERE contact_id = ? AND campaign_id = ?
            ORDER BY step_number ASC
        """, (result['contact_id'], result['campaign_id']))
        result['sequence_emails'] = [dict(row) for row in cursor.fetchall()]
        
        return result


def get_campaign_scheduled_summary() -> List[Dict]:
    """Get per-campaign summary of scheduled and pending-review counts,
    including the next contact name and last activity timestamp."""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT 
                ec.id as campaign_id,
                ec.name as campaign_name,
                ec.status as campaign_status,
                COUNT(CASE WHEN se.review_status = 'approved' AND se.scheduled_send_time IS NOT NULL 
                      AND (se.status IS NULL OR se.status IN ('draft','pending')) THEN 1 END) as scheduled_count,
                COUNT(CASE WHEN se.review_status = 'draft' THEN 1 END) as pending_review_count,
                MIN(CASE WHEN se.review_status = 'approved' AND se.scheduled_send_time IS NOT NULL 
                    AND (se.status IS NULL OR se.status IN ('draft','pending')) 
                    THEN se.scheduled_send_time END) as next_send_time,
                MAX(se.sent_at) as last_sent_at
            FROM email_campaigns ec
            LEFT JOIN sent_emails se ON se.campaign_id = ec.id
            GROUP BY ec.id
        """)
        results = [dict(row) for row in cursor.fetchall()]
        
        # For each campaign with a next_send_time, look up the contact name
        for r in results:
            if r.get('next_send_time'):
                cursor.execute("""
                    SELECT lc.name as next_contact_name
                    FROM sent_emails se
                    JOIN linkedin_contacts lc ON se.contact_id = lc.id
                    WHERE se.campaign_id = ? 
                    AND se.scheduled_send_time = ?
                    AND se.review_status = 'approved'
                    LIMIT 1
                """, (r['campaign_id'], r['next_send_time']))
                row = cursor.fetchone()
                r['next_contact_name'] = row['next_contact_name'] if row else None
            else:
                r['next_contact_name'] = None
        
        return results


def mark_email_sent(sent_email_id: int, sf_lead_url: str = None):
    """Called after successful Salesforce send. Sets review_status = 'sent', sent_at = now."""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            UPDATE sent_emails 
            SET review_status = 'sent', 
                status = 'sent',
                sent_at = CURRENT_TIMESTAMP,
                sf_lead_url = COALESCE(?, sf_lead_url)
            WHERE id = ?
        """, (sf_lead_url, sent_email_id))


def mark_email_failed(sent_email_id: int, error_message: str = None):
    """Called after a failed Salesforce send attempt."""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            UPDATE sent_emails 
            SET review_status = 'failed', 
                status = 'failed',
                error_message = ?
            WHERE id = ?
        """, (error_message, sent_email_id))


# ============ Tracking Operations ============

def get_emails_needing_tracking(lookback_days: int = 14) -> List[Dict]:
    """Get sent emails from the last N days that haven't been tracked recently.
    Orders by last_tracked_at ASC so the oldest-tracked get checked first."""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT 
                se.*,
                lc.name as contact_name,
                lc.company_name
            FROM sent_emails se
            JOIN linkedin_contacts lc ON se.contact_id = lc.id
            WHERE se.review_status = 'sent'
            AND se.sent_at >= datetime('now', ?)
            AND (se.last_tracked_at IS NULL OR se.last_tracked_at < datetime('now', '-1 hour'))
            ORDER BY se.last_tracked_at ASC NULLS FIRST
        """, (f'-{lookback_days} days',))
        return [dict(row) for row in cursor.fetchall()]


def update_email_tracking(sent_email_id: int, opened: bool = None, open_count: int = None, replied: bool = None):
    """Update tracking data from Salesforce polling. Sets last_tracked_at = now."""
    with get_db() as conn:
        cursor = conn.cursor()
        
        updates = ["last_tracked_at = CURRENT_TIMESTAMP"]
        params = []
        
        if opened is not None:
            updates.append("opened = ?")
            params.append(1 if opened else 0)
            if opened:
                updates.append("first_opened_at = COALESCE(first_opened_at, CURRENT_TIMESTAMP)")
        if open_count is not None:
            updates.append("open_count = ?")
            params.append(open_count)
        if replied is not None:
            updates.append("replied = ?")
            params.append(1 if replied else 0)
            if replied:
                updates.append("replied_at = COALESCE(replied_at, CURRENT_TIMESTAMP)")
        
        params.append(sent_email_id)
        
        cursor.execute(f"""
            UPDATE sent_emails SET {', '.join(updates)}
            WHERE id = ?
        """, params)


def get_todays_draft_count() -> int:
    """Count how many drafts have been created today. Used to enforce daily cap."""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT COUNT(*) as count FROM sent_emails
            WHERE DATE(sent_at) = DATE('now')
            AND review_status IN ('draft', 'ready_for_review', 'approved', 'scheduled', 'sent')
        """)
        return cursor.fetchone()['count']


def get_tracking_stats(days: int = 7) -> Dict:
    """Get aggregate tracking stats for the dashboard."""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT 
                COUNT(*) as total_sent,
                SUM(CASE WHEN opened = 1 THEN 1 ELSE 0 END) as total_opened,
                SUM(CASE WHEN replied = 1 THEN 1 ELSE 0 END) as total_replied,
                AVG(open_count) as avg_open_count
            FROM sent_emails
            WHERE review_status = 'sent'
            AND sent_at >= datetime('now', ?)
        """, (f'-{days} days',))
        row = cursor.fetchone()
        if row:
            total = row['total_sent'] or 0
            opened = row['total_opened'] or 0
            replied = row['total_replied'] or 0
            return {
                'total_sent': total,
                'total_opened': opened,
                'total_replied': replied,
                'open_rate': round((opened / total * 100), 1) if total > 0 else 0,
                'reply_rate': round((replied / total * 100), 1) if total > 0 else 0,
                'avg_open_count': round(row['avg_open_count'] or 0, 1)
            }
        return {'total_sent': 0, 'total_opened': 0, 'total_replied': 0, 'open_rate': 0, 'reply_rate': 0, 'avg_open_count': 0}


def get_campaign_tracking_stats(campaign_id: int) -> Dict:
    """Get tracking stats for a specific campaign."""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT 
                COUNT(*) as total_sent,
                SUM(CASE WHEN opened = 1 THEN 1 ELSE 0 END) as total_opened,
                SUM(CASE WHEN replied = 1 THEN 1 ELSE 0 END) as total_replied
            FROM sent_emails
            WHERE campaign_id = ?
            AND review_status = 'sent'
        """, (campaign_id,))
        row = cursor.fetchone()
        if row:
            total = row['total_sent'] or 0
            opened = row['total_opened'] or 0
            replied = row['total_replied'] or 0
            return {
                'total_sent': total,
                'total_opened': opened,
                'total_replied': replied,
                'open_rate': round((opened / total * 100), 1) if total > 0 else 0,
                'reply_rate': round((replied / total * 100), 1) if total > 0 else 0,
            }
        return {'total_sent': 0, 'total_opened': 0, 'total_replied': 0, 'open_rate': 0, 'reply_rate': 0}


def get_daily_email_stats(days: int = 30) -> List[Dict]:
    """Get daily sent/opened/replied counts for the last N days."""
    from datetime import timedelta

    end_date = datetime.now().date()
    start_date = end_date - timedelta(days=days - 1)
    all_dates: Dict[str, Dict[str, int]] = {}

    current = start_date
    while current <= end_date:
        key = current.isoformat()
        all_dates[key] = {"date": key, "sent": 0, "viewed": 0, "responded": 0}
        current += timedelta(days=1)

    with get_db() as conn:
        cursor = conn.cursor()

        cursor.execute("""
            SELECT DATE(sent_at) as day, COUNT(*) as count
            FROM sent_emails
            WHERE review_status = 'sent'
            AND sent_at >= date('now', ?)
            GROUP BY day
        """, (f'-{days - 1} days',))
        for row in cursor.fetchall():
            day = row['day']
            if day in all_dates:
                all_dates[day]["sent"] = row['count'] or 0

        cursor.execute("""
            SELECT DATE(first_opened_at) as day, COUNT(*) as count
            FROM sent_emails
            WHERE review_status = 'sent'
            AND first_opened_at IS NOT NULL
            AND first_opened_at >= date('now', ?)
            GROUP BY day
        """, (f'-{days - 1} days',))
        for row in cursor.fetchall():
            day = row['day']
            if day in all_dates:
                all_dates[day]["viewed"] = row['count'] or 0

        cursor.execute("""
            SELECT DATE(replied_at) as day, COUNT(*) as count
            FROM sent_emails
            WHERE review_status = 'sent'
            AND replied_at IS NOT NULL
            AND replied_at >= date('now', ?)
            GROUP BY day
        """, (f'-{days - 1} days',))
        for row in cursor.fetchall():
            day = row['day']
            if day in all_dates:
                all_dates[day]["responded"] = row['count'] or 0

    return [all_dates[d] for d in sorted(all_dates.keys())]


def get_active_conversations_count(days: int = 30) -> int:
    """Count unique contacts with replies in the last N days."""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT COUNT(DISTINCT contact_id) as count
            FROM sent_emails
            WHERE review_status = 'sent'
            AND replied = 1
            AND replied_at >= datetime('now', ?)
        """, (f'-{days} days',))
        row = cursor.fetchone()
        return row['count'] if row else 0


def get_meeting_booking_rate(days: int = 30) -> Dict:
    """Get meeting booking rate from sent emails in the last N days."""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT
                COUNT(*) as total_sent,
                SUM(CASE WHEN meeting_booked = 1 THEN 1 ELSE 0 END) as total_meetings
            FROM sent_emails
            WHERE review_status = 'sent'
            AND sent_at >= datetime('now', ?)
        """, (f'-{days} days',))
        row = cursor.fetchone()
        total = row['total_sent'] or 0
        meetings = row['total_meetings'] or 0
        rate = round((meetings / total * 100), 1) if total > 0 else 0
        return {"total_sent": total, "total_meetings": meetings, "meeting_rate": rate}


def _get_best_campaign_by_vertical(cursor, days: int) -> Optional[Dict]:
    cursor.execute("""
        SELECT
            ec.id as campaign_id,
            ec.name as campaign_name,
            t.vertical as segment_value,
            COUNT(*) as total_sent,
            SUM(CASE WHEN se.replied = 1 THEN 1 ELSE 0 END) as total_replied
        FROM sent_emails se
        JOIN email_campaigns ec ON se.campaign_id = ec.id
        JOIN linkedin_contacts lc ON se.contact_id = lc.id
        LEFT JOIN targets t ON lc.domain = t.domain
        WHERE se.review_status = 'sent'
        AND se.sent_at >= datetime('now', ?)
        AND t.vertical IS NOT NULL
        AND t.vertical != ''
        GROUP BY ec.id, t.vertical
        ORDER BY (CAST(total_replied AS FLOAT) / NULLIF(COUNT(*), 0)) DESC, COUNT(*) DESC
        LIMIT 1
    """, (f'-{days} days',))
    row = cursor.fetchone()
    if not row:
        return None
    total = row['total_sent'] or 0
    replied = row['total_replied'] or 0
    return {
        "campaign_id": row['campaign_id'],
        "campaign_name": row['campaign_name'],
        "segment_type": "vertical",
        "segment_value": row['segment_value'],
        "total_sent": total,
        "total_replied": replied,
        "reply_rate": round((replied / total * 100), 1) if total > 0 else 0,
    }


def _get_best_campaign_by_title(cursor, days: int) -> Optional[Dict]:
    cursor.execute("""
        SELECT
            ec.id as campaign_id,
            ec.name as campaign_name,
            lc.title as segment_value,
            COUNT(*) as total_sent,
            SUM(CASE WHEN se.replied = 1 THEN 1 ELSE 0 END) as total_replied
        FROM sent_emails se
        JOIN email_campaigns ec ON se.campaign_id = ec.id
        JOIN linkedin_contacts lc ON se.contact_id = lc.id
        WHERE se.review_status = 'sent'
        AND se.sent_at >= datetime('now', ?)
        AND lc.title IS NOT NULL
        AND lc.title != ''
        GROUP BY ec.id, lc.title
        ORDER BY (CAST(total_replied AS FLOAT) / NULLIF(COUNT(*), 0)) DESC, COUNT(*) DESC
        LIMIT 1
    """, (f'-{days} days',))
    row = cursor.fetchone()
    if not row:
        return None
    total = row['total_sent'] or 0
    replied = row['total_replied'] or 0
    return {
        "campaign_id": row['campaign_id'],
        "campaign_name": row['campaign_name'],
        "segment_type": "title",
        "segment_value": row['segment_value'],
        "total_sent": total,
        "total_replied": replied,
        "reply_rate": round((replied / total * 100), 1) if total > 0 else 0,
    }


def get_best_campaign_segment(days: int = 30) -> Optional[Dict]:
    """Return best-performing campaign segment by reply rate (vertical or title)."""
    with get_db() as conn:
        cursor = conn.cursor()
        by_vertical = _get_best_campaign_by_vertical(cursor, days)
        by_title = _get_best_campaign_by_title(cursor, days)

    if by_vertical and by_title:
        if by_vertical["reply_rate"] == by_title["reply_rate"]:
            return by_vertical if by_vertical["total_sent"] >= by_title["total_sent"] else by_title
        return by_vertical if by_vertical["reply_rate"] > by_title["reply_rate"] else by_title

    return by_vertical or by_title


# ============ Send Time Calculation Helpers ============

def _get_existing_scheduled_times(cursor) -> List[str]:
    """Get all scheduled send times for today."""
    cursor.execute("""
        SELECT scheduled_send_time FROM sent_emails
        WHERE DATE(scheduled_send_time) = DATE('now')
        AND review_status IN ('approved', 'sent')
        ORDER BY scheduled_send_time
    """)
    return [row['scheduled_send_time'] for row in cursor.fetchall()]


def _calculate_next_send_time(cursor) -> str:
    """Calculate the next available send time for a single email."""
    existing = _get_existing_scheduled_times(cursor)
    times = calculate_send_times(1, existing)
    return times[0] if times else datetime.now().isoformat()


def calculate_send_times(count: int, existing_times: List[str] = None) -> List[str]:
    """Calculate evenly-spaced send times within the configured window.
    Avoids conflicts with already-scheduled times.
    Returns list of ISO timestamp strings."""
    from datetime import timedelta
    
    # Get config
    window_start = get_config('send_window_start', '08:00')
    window_end = get_config('send_window_end', '17:00')
    min_gap = int(get_config('min_minutes_between_sends', '20'))
    
    today = datetime.now().date()
    start_hour, start_min = map(int, window_start.split(':'))
    end_hour, end_min = map(int, window_end.split(':'))
    
    window_start_dt = datetime(today.year, today.month, today.day, start_hour, start_min)
    window_end_dt = datetime(today.year, today.month, today.day, end_hour, end_min)
    
    now = datetime.now()
    
    # If we're past today's window, schedule for tomorrow
    if now >= window_end_dt:
        tomorrow = today + timedelta(days=1)
        window_start_dt = datetime(tomorrow.year, tomorrow.month, tomorrow.day, start_hour, start_min)
        window_end_dt = datetime(tomorrow.year, tomorrow.month, tomorrow.day, end_hour, end_min)
    
    # Start from now if within the window, otherwise from window start
    effective_start = max(now, window_start_dt)
    
    # Parse existing times
    taken_times = []
    if existing_times:
        for t in existing_times:
            try:
                taken_times.append(datetime.fromisoformat(t))
            except (ValueError, TypeError):
                pass
    
    # Generate send times
    result = []
    current = effective_start
    
    for _ in range(count):
        # Find next available slot
        while current < window_end_dt:
            conflict = False
            for taken in taken_times:
                if abs((current - taken).total_seconds()) < min_gap * 60:
                    conflict = True
                    break
            if not conflict:
                break
            current += timedelta(minutes=1)
        
        if current >= window_end_dt:
            # Overflow to next day
            next_day = current.date() + timedelta(days=1)
            current = datetime(next_day.year, next_day.month, next_day.day, start_hour, start_min)
        
        result.append(current.isoformat())
        taken_times.append(current)
        current += timedelta(minutes=min_gap)
    
    return result


# ============ Outlook Reply Tracking Operations ============

def update_sent_email_outlook_ids(
    sent_email_id: int,
    outlook_message_id: str = None,
    outlook_conversation_id: str = None,
    outlook_internet_message_id: str = None,
):
    """Store Outlook message/conversation IDs after an email is sent."""
    updates = []
    params = []
    if outlook_message_id is not None:
        updates.append("outlook_message_id = ?")
        params.append(outlook_message_id)
    if outlook_conversation_id is not None:
        updates.append("outlook_conversation_id = ?")
        params.append(outlook_conversation_id)
    if outlook_internet_message_id is not None:
        updates.append("outlook_internet_message_id = ?")
        params.append(outlook_internet_message_id)
    if not updates:
        return
    params.append(sent_email_id)
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute(f"""
            UPDATE sent_emails SET {', '.join(updates)}
            WHERE id = ?
        """, params)


def get_sent_emails_with_outlook_ids(lookback_days: int = 30) -> List[Dict]:
    """Get sent emails that have Outlook conversation IDs, for reply matching."""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT 
                se.id, se.campaign_id, se.campaign_contact_id, se.contact_id,
                se.subject, se.rendered_subject,
                se.outlook_message_id, se.outlook_conversation_id,
                se.outlook_internet_message_id, se.replied, se.replied_at,
                lc.name as contact_name, lc.email_generated as contact_email,
                lc.company_name
            FROM sent_emails se
            JOIN linkedin_contacts lc ON se.contact_id = lc.id
            WHERE se.review_status = 'sent'
            AND se.replied = 0
            AND se.sent_at >= datetime('now', ?)
            AND (se.outlook_conversation_id IS NOT NULL 
                 OR se.outlook_internet_message_id IS NOT NULL)
        """, (f'-{lookback_days} days',))
        return [dict(row) for row in cursor.fetchall()]


def get_sent_emails_for_reply_matching(lookback_days: int = 30) -> List[Dict]:
    """Get ALL sent emails (with or without Outlook IDs) for subject/sender matching."""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT 
                se.id, se.campaign_id, se.campaign_contact_id, se.contact_id,
                se.subject, se.rendered_subject,
                se.outlook_message_id, se.outlook_conversation_id,
                se.outlook_internet_message_id, se.replied,
                lc.name as contact_name, lc.email_generated as contact_email,
                lc.company_name
            FROM sent_emails se
            JOIN linkedin_contacts lc ON se.contact_id = lc.id
            WHERE se.review_status = 'sent'
            AND se.replied = 0
            AND se.sent_at >= datetime('now', ?)
        """, (f'-{lookback_days} days',))
        return [dict(row) for row in cursor.fetchall()]


def log_email_reply(
    sent_email_id: int,
    campaign_contact_id: int,
    contact_id: int,
    outlook_message_id: str = None,
    from_address: str = None,
    subject: str = None,
    body_preview: str = None,
    received_at: str = None,
) -> int:
    """Log a detected reply and update tracking flags."""
    with get_db() as conn:
        cursor = conn.cursor()
        # Insert the reply record
        cursor.execute("""
            INSERT INTO email_replies (
                sent_email_id, campaign_contact_id, contact_id,
                outlook_message_id, from_address, subject, body_preview, received_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            sent_email_id, campaign_contact_id, contact_id,
            outlook_message_id, from_address, subject, body_preview, received_at,
        ))
        reply_id = cursor.lastrowid

        # Mark the sent email as replied
        cursor.execute("""
            UPDATE sent_emails
            SET replied = 1,
                replied_at = COALESCE(replied_at, ?)
            WHERE id = ?
        """, (received_at or datetime.now().isoformat(), sent_email_id))

        # Pause the campaign contact (stop further emails)
        cursor.execute("""
            UPDATE campaign_contacts
            SET status = 'replied'
            WHERE id = ?
        """, (campaign_contact_id,))

        return reply_id


def get_email_replies(
    contact_id: int = None,
    campaign_id: int = None,
    limit: int = 50,
) -> List[Dict]:
    """Get email replies with contact/campaign info."""
    with get_db() as conn:
        cursor = conn.cursor()
        query = """
            SELECT
                er.*,
                lc.name as contact_name,
                lc.company_name,
                lc.email_generated as contact_email,
                ec.name as campaign_name,
                se.rendered_subject as original_subject
            FROM email_replies er
            JOIN linkedin_contacts lc ON er.contact_id = lc.id
            JOIN sent_emails se ON er.sent_email_id = se.id
            JOIN email_campaigns ec ON se.campaign_id = ec.id
            WHERE 1=1
        """
        params = []
        if contact_id:
            query += " AND er.contact_id = ?"
            params.append(contact_id)
        if campaign_id:
            query += " AND se.campaign_id = ?"
            params.append(campaign_id)
        query += " ORDER BY er.received_at DESC LIMIT ?"
        params.append(limit)
        cursor.execute(query, params)
        return [dict(row) for row in cursor.fetchall()]


def get_active_conversations(days: int = 30, limit: int = 50) -> List[Dict]:
    """Get contacts who replied recently — 'active conversations' for dashboard."""
    with get_db() as conn:
        cursor = conn.cursor()
        # Add handled column if it doesn't exist yet
        try:
            cursor.execute("ALTER TABLE email_replies ADD COLUMN handled INTEGER DEFAULT 0")
        except Exception:
            pass
        cursor.execute("""
            SELECT
                er.id as reply_id,
                er.contact_id,
                er.subject as reply_subject,
                er.body_preview,
                er.received_at,
                lc.name as contact_name,
                lc.company_name,
                lc.email_generated as contact_email,
                lc.title as contact_title,
                ec.name as campaign_name,
                se.rendered_subject as original_subject
            FROM email_replies er
            JOIN linkedin_contacts lc ON er.contact_id = lc.id
            JOIN sent_emails se ON er.sent_email_id = se.id
            JOIN email_campaigns ec ON se.campaign_id = ec.id
            WHERE er.received_at >= datetime('now', ?)
            AND COALESCE(er.handled, 0) = 0
            ORDER BY er.received_at DESC
            LIMIT ?
        """, (f'-{days} days', limit))
        return [dict(row) for row in cursor.fetchall()]


def mark_conversation_handled(reply_id: int) -> bool:
    """Mark a conversation (reply) as handled. Returns True if successful."""
    with get_db() as conn:
        cursor = conn.cursor()
        # Add handled column if it doesn't exist
        try:
            cursor.execute("ALTER TABLE email_replies ADD COLUMN handled INTEGER DEFAULT 0")
        except Exception:
            pass  # Column already exists

        cursor.execute("""
            UPDATE email_replies SET handled = 1 WHERE id = ?
        """, (reply_id,))
        return cursor.rowcount > 0


def get_conversation_thread(contact_id: int, limit: int = 20) -> List[Dict]:
    """Get the full conversation thread for a contact — sent emails + replies."""
    with get_db() as conn:
        cursor = conn.cursor()
        # Get all sent emails to this contact
        cursor.execute("""
            SELECT
                'sent' as msg_type,
                se.id,
                se.rendered_subject as subject,
                se.rendered_body as body,
                se.sent_at as timestamp,
                ec.name as campaign_name,
                se.step_number
            FROM sent_emails se
            JOIN email_campaigns ec ON se.campaign_id = ec.id
            WHERE se.contact_id = ?
            AND se.review_status = 'sent'
            ORDER BY se.sent_at DESC
            LIMIT ?
        """, (contact_id, limit))
        sent = [dict(row) for row in cursor.fetchall()]

        # Get all replies from this contact
        cursor.execute("""
            SELECT
                'reply' as msg_type,
                er.id,
                er.subject,
                er.body_preview as body,
                er.received_at as timestamp,
                ec.name as campaign_name,
                se.step_number
            FROM email_replies er
            JOIN sent_emails se ON er.sent_email_id = se.id
            JOIN email_campaigns ec ON se.campaign_id = ec.id
            WHERE er.contact_id = ?
            ORDER BY er.received_at DESC
            LIMIT ?
        """, (contact_id, limit))
        replies = [dict(row) for row in cursor.fetchall()]

        # Merge and sort chronologically
        thread = sent + replies
        thread.sort(key=lambda m: m.get('timestamp') or '', reverse=False)
        return thread


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _normalize_text(value: Optional[str]) -> str:
    if not value:
        return ""
    return " ".join(str(value).strip().lower().split())


def _tokenize(text: str) -> List[str]:
    cleaned = "".join(ch.lower() if ch.isalnum() else " " for ch in (text or ""))
    return [tok for tok in cleaned.split() if len(tok) >= 2]


def _json_loads_safe(raw: Optional[str], default):
    if not raw:
        return default
    try:
        return json.loads(raw)
    except Exception:
        return default


def _delete_semantic_and_index_rows(entity_type: str, entity_id: str):
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "DELETE FROM semantic_chunks WHERE source_type = ? AND source_id = ?",
            (entity_type, str(entity_id)),
        )
        cursor.execute(
            "DELETE FROM entity_search_index WHERE entity_type = ? AND entity_id = ?",
            (entity_type, str(entity_id)),
        )


def upsert_semantic_chunk(
    source_type: str,
    source_id: str,
    text: str,
    chunk_type: str = "summary",
    metadata: Optional[Dict[str, Any]] = None,
    chunk_id: Optional[str] = None,
) -> str:
    """
    Upsert one semantic chunk row.

    `chunk_id` defaults to "{source_type}:{source_id}:{chunk_type}" for deterministic updates.
    """
    normalized_source_type = (source_type or "").strip()
    normalized_source_id = str(source_id or "").strip()
    if not normalized_source_type or not normalized_source_id:
        raise ValueError("source_type and source_id are required")
    if not text or not text.strip():
        raise ValueError("text is required")

    now = _utc_now_iso()
    final_chunk_id = chunk_id or f"{normalized_source_type}:{normalized_source_id}:{chunk_type}"
    metadata_json = json.dumps(metadata or {}, ensure_ascii=False)
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO semantic_chunks
                (chunk_id, source_type, source_id, chunk_type, text, created_at, updated_at, metadata)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(chunk_id) DO UPDATE SET
                source_type=excluded.source_type,
                source_id=excluded.source_id,
                chunk_type=excluded.chunk_type,
                text=excluded.text,
                updated_at=excluded.updated_at,
                metadata=excluded.metadata
            """,
            (
                final_chunk_id,
                normalized_source_type,
                normalized_source_id,
                chunk_type,
                text.strip(),
                now,
                now,
                metadata_json,
            ),
        )
    return final_chunk_id


def build_contact_embedding_text(contact_id: int) -> Optional[str]:
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT
                lc.id, lc.name, lc.title, lc.company_name, lc.domain,
                lc.email_generated, lc.phone, lc.phone_source,
                lc.linkedin_url, lc.scraped_at, t.vertical
            FROM linkedin_contacts lc
            LEFT JOIN targets t ON LOWER(t.company_name) = LOWER(lc.company_name)
            WHERE lc.id = ?
            """,
            (contact_id,),
        )
        row = cursor.fetchone()
    if not row:
        return None
    company = row["company_name"] or ""
    lines = [
        f"Contact: {row['name'] or ''}",
        f"Title: {row['title'] or ''}",
        f"Company: {company}",
        f"Domain: {row['domain'] or ''}",
        f"Email: {row['email_generated'] or ''}",
        f"Phone: {row['phone'] or ''}",
        f"Vertical: {row['vertical'] or ''}",
        f"LinkedIn: {row['linkedin_url'] or ''}",
        f"Last interaction summary: scraped_at={row['scraped_at'] or ''}",
    ]
    return "\n".join(lines).strip()


def build_company_embedding_text(company_id: int) -> Optional[str]:
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT
                id, company_name, domain, tier, vertical, target_reason, wedge, status, updated_at
            FROM targets
            WHERE id = ?
            """,
            (company_id,),
        )
        row = cursor.fetchone()
    if not row:
        return None
    lines = [
        f"Company: {row['company_name'] or ''}",
        f"Domain: {row['domain'] or ''}",
        f"Industry: {row['vertical'] or ''}",
        f"Tier: {row['tier'] or ''}",
        f"ICP fit notes: {row['target_reason'] or ''}",
        f"Pain points / wedge: {row['wedge'] or ''}",
        f"Status: {row['status'] or ''}",
        f"Recent interactions: updated_at={row['updated_at'] or ''}",
    ]
    return "\n".join(lines).strip()


def build_campaign_embedding_text(campaign_id: int) -> Optional[str]:
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT id, name, description, status, num_emails, days_between_emails, updated_at
            FROM email_campaigns
            WHERE id = ?
            """,
            (campaign_id,),
        )
        campaign = cursor.fetchone()
        if not campaign:
            return None
        cursor.execute(
            """
            SELECT step_number, subject_template, body_template
            FROM email_templates
            WHERE campaign_id = ?
            ORDER BY step_number
            """,
            (campaign_id,),
        )
        templates = cursor.fetchall()

    template_summaries = []
    for row in templates[:5]:
        subject = row["subject_template"] or ""
        body_preview = (row["body_template"] or "").replace("\n", " ").strip()[:160]
        template_summaries.append(f"Step {row['step_number']}: {subject} | {body_preview}")

    lines = [
        f"Campaign: {campaign['name'] or ''}",
        f"Objective: {campaign['description'] or ''}",
        f"Status: {campaign['status'] or ''}",
        f"Cadence: {campaign['num_emails'] or 0} emails, every {campaign['days_between_emails'] or 0} days",
        f"Templates summary: {' ; '.join(template_summaries) if template_summaries else 'none'}",
        f"Updated: {campaign['updated_at'] or ''}",
    ]
    return "\n".join(lines).strip()


def build_note_embedding_text(note_id: int) -> Optional[str]:
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT
                er.id, er.subject, er.body_preview, er.received_at,
                lc.name as contact_name, lc.company_name
            FROM email_replies er
            JOIN linkedin_contacts lc ON lc.id = er.contact_id
            WHERE er.id = ?
            """,
            (note_id,),
        )
        row = cursor.fetchone()
    if not row:
        return None
    lines = [
        f"Note/Interaction ID: {row['id']}",
        f"Contact: {row['contact_name'] or ''}",
        f"Company: {row['company_name'] or ''}",
        f"Subject: {row['subject'] or ''}",
        f"Outcome summary: {row['body_preview'] or ''}",
        f"Timestamp: {row['received_at'] or ''}",
    ]
    return "\n".join(lines).strip()


def _upsert_entity_search_index_row(
    entity_type: str,
    entity_id: str,
    name: str = "",
    emails: str = "",
    phones: str = "",
    domain: str = "",
    keywords: str = "",
):
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO entity_search_index
                (entity_type, entity_id, name, emails, phones, domain, keywords, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(entity_type, entity_id) DO UPDATE SET
                name=excluded.name,
                emails=excluded.emails,
                phones=excluded.phones,
                domain=excluded.domain,
                keywords=excluded.keywords,
                updated_at=excluded.updated_at
            """,
            (
                entity_type,
                entity_id,
                name,
                emails,
                phones,
                domain,
                keywords,
                _utc_now_iso(),
            ),
        )


def sync_entity_semantic_index(entity_type: str, entity_id: int | str):
    normalized_type = (entity_type or "").strip().lower()
    normalized_id = str(entity_id)
    text: Optional[str] = None
    metadata: Dict[str, Any] = {"entity_type": normalized_type, "entity_id": normalized_id}

    if normalized_type == "contact":
        text = build_contact_embedding_text(int(entity_id))
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute(
                "SELECT id, name, company_name, title, email_generated, phone, domain FROM linkedin_contacts WHERE id = ?",
                (entity_id,),
            )
            row = cursor.fetchone()
            if row:
                _upsert_entity_search_index_row(
                    "contact",
                    str(row["id"]),
                    name=row["name"] or "",
                    emails=row["email_generated"] or "",
                    phones=row["phone"] or "",
                    domain=row["domain"] or "",
                    keywords=" ".join([row["company_name"] or "", row["title"] or ""]).strip(),
                )
                metadata["title"] = f"{row['name'] or 'Unknown'} @ {row['company_name'] or 'Unknown company'}"
    elif normalized_type == "company":
        text = build_company_embedding_text(int(entity_id))
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute(
                "SELECT id, company_name, domain, vertical, target_reason, wedge FROM targets WHERE id = ?",
                (entity_id,),
            )
            row = cursor.fetchone()
            if row:
                _upsert_entity_search_index_row(
                    "company",
                    str(row["id"]),
                    name=row["company_name"] or "",
                    domain=row["domain"] or "",
                    keywords=" ".join([row["vertical"] or "", row["target_reason"] or "", row["wedge"] or ""]).strip(),
                )
                metadata["title"] = row["company_name"] or f"company {row['id']}"
    elif normalized_type == "campaign":
        text = build_campaign_embedding_text(int(entity_id))
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT id, name, description FROM email_campaigns WHERE id = ?", (entity_id,))
            row = cursor.fetchone()
            if row:
                _upsert_entity_search_index_row(
                    "campaign",
                    str(row["id"]),
                    name=row["name"] or "",
                    keywords=row["description"] or "",
                )
                metadata["title"] = row["name"] or f"campaign {row['id']}"
    elif normalized_type in {"note", "conversation"}:
        text = build_note_embedding_text(int(entity_id))
    else:
        return

    if text and text.strip():
        upsert_semantic_chunk(
            source_type=normalized_type,
            source_id=normalized_id,
            chunk_type="summary",
            text=text,
            metadata=metadata,
        )
    else:
        _delete_semantic_and_index_rows(normalized_type, normalized_id)


def delete_entity_semantic_index(entity_type: str, entity_id: int | str):
    _delete_semantic_and_index_rows((entity_type or "").strip().lower(), str(entity_id))


def refresh_entity_search_index(entity_types: Optional[List[str]] = None):
    wanted = set(entity_types or ["contact", "company", "campaign", "email_message", "conversation"])
    if "contact" in wanted:
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                SELECT id, name, company_name, title, email_generated, phone, domain
                FROM linkedin_contacts
                """
            )
            for row in cursor.fetchall():
                keywords = " ".join(
                    [
                        row["name"] or "",
                        row["company_name"] or "",
                        row["title"] or "",
                    ]
                ).strip()
                _upsert_entity_search_index_row(
                    "contact",
                    str(row["id"]),
                    name=row["name"] or "",
                    emails=row["email_generated"] or "",
                    phones=row["phone"] or "",
                    domain=row["domain"] or "",
                    keywords=keywords,
                )
    if "company" in wanted:
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT id, company_name, domain, vertical, target_reason, wedge FROM targets")
            for row in cursor.fetchall():
                keywords = " ".join(
                    [row["vertical"] or "", row["target_reason"] or "", row["wedge"] or ""]
                ).strip()
                _upsert_entity_search_index_row(
                    "company",
                    str(row["id"]),
                    name=row["company_name"] or "",
                    domain=row["domain"] or "",
                    keywords=keywords,
                )
    if "campaign" in wanted:
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT id, name, description FROM email_campaigns")
            for row in cursor.fetchall():
                _upsert_entity_search_index_row(
                    "campaign",
                    str(row["id"]),
                    name=row["name"] or "",
                    keywords=row["description"] or "",
                )
    if "email_message" in wanted:
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                SELECT id, rendered_subject, rendered_body, sent_at
                FROM sent_emails
                WHERE review_status = 'sent'
                """
            )
            for row in cursor.fetchall():
                body = (row["rendered_body"] or "")[:400]
                _upsert_entity_search_index_row(
                    "email_message",
                    str(row["id"]),
                    name=row["rendered_subject"] or "",
                    keywords=f"{row['rendered_subject'] or ''} {body} {row['sent_at'] or ''}",
                )
    if "conversation" in wanted:
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                SELECT er.id, lc.name as contact_name, lc.company_name, er.subject, er.body_preview, er.received_at
                FROM email_replies er
                JOIN linkedin_contacts lc ON lc.id = er.contact_id
                """
            )
            for row in cursor.fetchall():
                _upsert_entity_search_index_row(
                    "conversation",
                    str(row["id"]),
                    name=row["contact_name"] or "",
                    keywords=" ".join(
                        [
                            row["company_name"] or "",
                            row["subject"] or "",
                            row["body_preview"] or "",
                            row["received_at"] or "",
                        ]
                    ),
                )


class VectorBackend:
    name = "base"

    def search(
        self,
        query: str,
        query_tokens: set[str],
        entity_types: set[str],
        filters: Dict[str, Any],
    ) -> List[Dict[str, Any]]:
        raise NotImplementedError


class TokenOverlapVectorBackend(VectorBackend):
    name = "token_overlap"

    def search(
        self,
        query: str,
        query_tokens: set[str],
        entity_types: set[str],
        filters: Dict[str, Any],
    ) -> List[Dict[str, Any]]:
        time_range = (filters.get("time_range") or "").strip().lower()
        out: List[Dict[str, Any]] = []
        with get_db() as conn:
            cursor = conn.cursor()
            placeholders = ",".join(["?"] * len(entity_types)) if entity_types else "?"
            where = [f"source_type IN ({placeholders})"]
            params: List[Any] = [*entity_types]
            if time_range in {"last 7 days", "last_7_days"}:
                where.append("created_at >= datetime('now', '-7 days')")
            elif time_range in {"last 30 days", "last_30_days"}:
                where.append("created_at >= datetime('now', '-30 days')")
            cursor.execute(
                f"""
                SELECT chunk_id, source_type, source_id, chunk_type, text, created_at, updated_at, metadata
                FROM semantic_chunks
                WHERE {' AND '.join(where)}
                ORDER BY updated_at DESC
                LIMIT 400
                """,
                params,
            )
            for row in cursor.fetchall():
                text = row["text"] or ""
                text_tokens = set(_tokenize(text))
                overlap = len(query_tokens.intersection(text_tokens))
                if overlap <= 0:
                    continue
                vec_score = min(1.0, overlap / max(len(query_tokens), 1))
                metadata = _json_loads_safe(row["metadata"], {})
                title = metadata.get("title") or f"{row['source_type']} {row['source_id']}"
                out.append(
                    _build_result(
                        row["source_type"],
                        row["source_id"],
                        title,
                        text[:260],
                        timestamp=row["updated_at"] or row["created_at"],
                        source_refs=[
                            {
                                "chunk_id": row["chunk_id"],
                                "source_id": row["source_id"],
                                "source_type": row["source_type"],
                                "chunk_type": row["chunk_type"],
                            }
                        ],
                        score_vec=vec_score,
                    )
                )
        return out


class SqliteVecVectorBackend(VectorBackend):
    name = "sqlite_vec"

    def _has_sqlite_vec_tables(self, cursor) -> bool:
        cursor.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('semantic_embeddings', 'semantic_chunks')"
        )
        names = {row[0] for row in cursor.fetchall()}
        return "semantic_embeddings" in names and "semantic_chunks" in names

    def search(
        self,
        query: str,
        query_tokens: set[str],
        entity_types: set[str],
        filters: Dict[str, Any],
    ) -> List[Dict[str, Any]]:
        # Adapter scaffold. Query embedding generation/indexing lands in next slice.
        try:
            with get_db() as conn:
                cursor = conn.cursor()
                if not self._has_sqlite_vec_tables(cursor):
                    return []
        except Exception:
            return []
        return []


def _resolve_vector_backend() -> VectorBackend:
    mode = (getattr(config, "VECTOR_BACKEND", "auto") or "auto").strip().lower()
    if mode == "sqlite_vec":
        return SqliteVecVectorBackend()
    if mode == "fallback":
        return TokenOverlapVectorBackend()
    sqlite_backend = SqliteVecVectorBackend()
    try:
        with get_db() as conn:
            cursor = conn.cursor()
            if sqlite_backend._has_sqlite_vec_tables(cursor):
                return sqlite_backend
    except Exception:
        pass
    return TokenOverlapVectorBackend()


def _build_result(
    entity_type: str,
    entity_id: str,
    title: str,
    snippet: str,
    timestamp: Optional[str] = None,
    source_refs: Optional[List[Dict[str, Any]]] = None,
    score_exact: float = 0.0,
    score_lex: float = 0.0,
    score_vec: float = 0.0,
) -> Dict[str, Any]:
    refs = source_refs or [
        {
            "kind": "entity",
            "entity_type": entity_type,
            "entity_id": str(entity_id),
            "field": "primary",
        }
    ]
    score_total = score_exact * 100.0 + score_lex * 40.0 + score_vec * 25.0
    return {
        "entity_type": entity_type,
        "entity_id": str(entity_id),
        "score_total": round(score_total, 5),
        "score_exact": round(score_exact, 5),
        "score_lex": round(score_lex, 5),
        "score_vec": round(score_vec, 5),
        "title": title,
        "snippet": snippet[:400],
        "source_refs": refs,
        "timestamp": timestamp,
    }


def resolve_entity(
    name_or_identifier: str,
    entity_types: Optional[List[str]] = None,
    limit: int = 10,
) -> List[Dict[str, Any]]:
    q = (name_or_identifier or "").strip()
    if not q:
        return []
    entity_types = entity_types or ["contact", "company", "campaign"]
    allowed_types = set(entity_types)
    out: List[Dict[str, Any]] = []
    max_rows = max(1, min(int(limit), 50))

    with get_db() as conn:
        cursor = conn.cursor()
        if "contact" in allowed_types:
            cursor.execute(
                """
                SELECT id, name, company_name, email_generated, phone, scraped_at
                FROM linkedin_contacts
                WHERE LOWER(name) = LOWER(?)
                   OR LOWER(email_generated) = LOWER(?)
                   OR REPLACE(REPLACE(REPLACE(COALESCE(phone,''), ' ', ''), '-', ''), '(', '') = REPLACE(REPLACE(REPLACE(?, ' ', ''), '-', ''), '(', '')
                   OR CAST(id as TEXT) = ?
                LIMIT ?
                """,
                (q, q, q, q, max_rows),
            )
            for row in cursor.fetchall():
                out.append(
                    _build_result(
                        "contact",
                        str(row["id"]),
                        f"{row['name'] or 'Unknown'} @ {row['company_name'] or 'Unknown company'}",
                        f"email={row['email_generated'] or 'n/a'}, phone={row['phone'] or 'n/a'}",
                        timestamp=row["scraped_at"],
                        source_refs=[{"row_id": row["id"], "table": "linkedin_contacts"}],
                        score_exact=1.0,
                    )
                )

        if "company" in allowed_types:
            cursor.execute(
                """
                SELECT id, company_name, domain, vertical, updated_at
                FROM targets
                WHERE LOWER(company_name) = LOWER(?)
                   OR LOWER(domain) = LOWER(?)
                   OR CAST(id as TEXT) = ?
                LIMIT ?
                """,
                (q, q, q, max_rows),
            )
            for row in cursor.fetchall():
                out.append(
                    _build_result(
                        "company",
                        str(row["id"]),
                        row["company_name"] or "Unknown company",
                        f"domain={row['domain'] or 'n/a'}, vertical={row['vertical'] or 'n/a'}",
                        timestamp=row["updated_at"],
                        source_refs=[{"row_id": row["id"], "table": "targets"}],
                        score_exact=1.0,
                    )
                )

        if "campaign" in allowed_types:
            cursor.execute(
                """
                SELECT id, name, description, updated_at
                FROM email_campaigns
                WHERE LOWER(name) = LOWER(?)
                   OR CAST(id as TEXT) = ?
                LIMIT ?
                """,
                (q, q, max_rows),
            )
            for row in cursor.fetchall():
                out.append(
                    _build_result(
                        "campaign",
                        str(row["id"]),
                        row["name"] or "Unknown campaign",
                        row["description"] or "",
                        timestamp=row["updated_at"],
                        source_refs=[{"row_id": row["id"], "table": "email_campaigns"}],
                        score_exact=1.0,
                    )
                )

    out.sort(key=lambda x: (x["score_total"], x["entity_type"]), reverse=True)
    return out[:max_rows]


def hybrid_search(
    query: str,
    entity_types: Optional[List[str]] = None,
    filters: Optional[Dict[str, Any]] = None,
    k: int = 10,
) -> List[Dict[str, Any]]:
    """
    Hybrid retrieval: exact + lexical + semantic-like chunk overlap.
    Vector stage currently uses token-overlap fallback until dedicated vector index is added.
    """
    q = (query or "").strip()
    if not q:
        return []
    entity_types = entity_types or [
        "contact",
        "company",
        "campaign",
        "note",
        "conversation",
        "email_message",
        "email_thread",
        "file_chunk",
    ]
    allowed_types = set(entity_types)
    filters = filters or {}
    limit = max(1, min(int(k or 10), 50))

    # Keep deterministic index warm for exact/lex retrieval.
    refresh_entity_search_index([t for t in allowed_types if t in {"contact", "company", "campaign", "email_message", "conversation"}])

    results_by_key: Dict[str, Dict[str, Any]] = {}
    q_norm = _normalize_text(q)
    q_tokens = set(_tokenize(q_norm))

    def _upsert(item: Dict[str, Any]):
        key = f"{item['entity_type']}:{item['entity_id']}"
        prev = results_by_key.get(key)
        if not prev:
            results_by_key[key] = item
            return
        prev["score_exact"] = max(prev["score_exact"], item["score_exact"])
        prev["score_lex"] = max(prev["score_lex"], item["score_lex"])
        prev["score_vec"] = max(prev["score_vec"], item["score_vec"])
        prev["score_total"] = round(prev["score_exact"] * 100.0 + prev["score_lex"] * 40.0 + prev["score_vec"] * 25.0, 5)
        if len(item.get("snippet", "")) > len(prev.get("snippet", "")):
            prev["snippet"] = item["snippet"]
        prev["source_refs"] = (prev.get("source_refs") or []) + (item.get("source_refs") or [])
        if not prev.get("timestamp") and item.get("timestamp"):
            prev["timestamp"] = item["timestamp"]

    # A) Exact / deterministic stage.
    for item in resolve_entity(q, list(allowed_types), limit=10):
        _upsert(item)

    # B) Lexical stage via entity_search_index.
    with get_db() as conn:
        cursor = conn.cursor()
        placeholders = ",".join(["?"] * len(allowed_types)) if allowed_types else "?"
        like = f"%{q_norm}%"
        cursor.execute(
            f"""
            SELECT entity_type, entity_id, name, emails, phones, domain, keywords, updated_at
            FROM entity_search_index
            WHERE entity_type IN ({placeholders})
              AND (
                LOWER(COALESCE(name, '')) LIKE ?
                OR LOWER(COALESCE(emails, '')) LIKE ?
                OR LOWER(COALESCE(phones, '')) LIKE ?
                OR LOWER(COALESCE(domain, '')) LIKE ?
                OR LOWER(COALESCE(keywords, '')) LIKE ?
              )
            ORDER BY updated_at DESC
            LIMIT 200
            """,
            [*allowed_types, like, like, like, like, like],
        )
        for row in cursor.fetchall():
            searchable = " ".join(
                [
                    row["name"] or "",
                    row["emails"] or "",
                    row["phones"] or "",
                    row["domain"] or "",
                    row["keywords"] or "",
                ]
            )
            words = set(_tokenize(searchable))
            overlap = len(q_tokens.intersection(words))
            if overlap <= 0:
                continue
            lex_score = min(1.0, overlap / max(len(q_tokens), 1))
            snippet = " ".join(filter(None, [row["keywords"], row["emails"], row["phones"]]))[:260]
            _upsert(
                _build_result(
                    row["entity_type"],
                    row["entity_id"],
                    row["name"] or f"{row['entity_type']} {row['entity_id']}",
                    snippet or (row["domain"] or ""),
                    timestamp=row["updated_at"],
                    source_refs=[{"row_id": row["entity_id"], "table": "entity_search_index"}],
                    score_lex=lex_score,
                )
            )

    # C) Semantic/vector stage via backend adapter (sqlite-vec optional).
    vector_backend = _resolve_vector_backend()
    vector_results = vector_backend.search(q, q_tokens, allowed_types, filters)
    if not vector_results and vector_backend.name != "token_overlap":
        vector_results = TokenOverlapVectorBackend().search(q, q_tokens, allowed_types, filters)
    for item in vector_results:
        _upsert(item)

    ranked = sorted(
        results_by_key.values(),
        key=lambda x: (x["score_total"], x["score_exact"], x["score_lex"], x["score_vec"]),
        reverse=True,
    )
    return ranked[:limit]


# Initialize database when module is imported
init_database()
