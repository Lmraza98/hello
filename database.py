"""
SQLite database schema and operations.
Single-file database for easy portability and resume capability.
"""
import sqlite3
import json
from datetime import datetime
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
                phone_links TEXT,
                salesforce_status TEXT DEFAULT 'pending',
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
        ]
        for col_name, col_type in sent_email_new_columns:
            try:
                cursor.execute(f"ALTER TABLE sent_emails ADD COLUMN {col_name} {col_type}")
            except sqlite3.OperationalError:
                pass  # Column already exists
        
        # Add index for review queue queries
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_sent_emails_review_status ON sent_emails(review_status)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_sent_emails_scheduled ON sent_emails(scheduled_send_time)")
        
        # System config table — key-value settings
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS system_config (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        
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
    """Log a sent email."""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO sent_emails (
                campaign_id, campaign_contact_id, contact_id, step_number,
                subject, body, sf_lead_url, status, error_message, screenshot_path
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            campaign_id, campaign_contact_id, contact_id, step_number,
            subject, body, sf_lead_url, status, error_message, screenshot_path
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


# Initialize database when module is imported
init_database()


