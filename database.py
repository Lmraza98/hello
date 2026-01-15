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
        
        # Deduplication tracking
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS dedupe_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT,
                domain TEXT,
                person_name TEXT,
                first_seen_candidate_id INTEGER,
                duplicate_candidate_ids TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        cursor.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_dedupe_email ON dedupe_log(email) WHERE email IS NOT NULL")
        
        # Campaigns table - user-defined email campaigns
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS campaigns (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                description TEXT,
                subject_template TEXT,
                body_template TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_campaigns_title ON campaigns(title)")
        
        # Workflows table - user-defined workflow definitions
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS workflows (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                description TEXT,
                workflow_json TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_workflows_name ON workflows(name)")
        
        # Workflow executions table - tracks workflow runs
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS workflow_executions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                workflow_id INTEGER NOT NULL,
                status TEXT DEFAULT 'pending',
                selected_lead_ids TEXT,
                started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                completed_at TIMESTAMP,
                error_message TEXT,
                FOREIGN KEY (workflow_id) REFERENCES workflows(id)
            )
        """)
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_workflow_executions_workflow ON workflow_executions(workflow_id)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_workflow_executions_status ON workflow_executions(status)")
        
        # Lead actions table - tracks actions applied to leads
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS lead_actions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                contact_id INTEGER NOT NULL,
                workflow_execution_id INTEGER,
                action_type TEXT NOT NULL,
                action_status TEXT DEFAULT 'pending',
                action_details TEXT,
                sf_record_url TEXT,
                linkedin_request_sent INTEGER DEFAULT 0,
                email_sent INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (workflow_execution_id) REFERENCES workflow_executions(id)
            )
        """)
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_lead_actions_contact ON lead_actions(contact_id)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_lead_actions_execution ON lead_actions(workflow_execution_id)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_lead_actions_type ON lead_actions(action_type)")
        
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
        
        # Messages table - tracks messages sent, tied to campaigns
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                campaign_id INTEGER NOT NULL,
                contact_id INTEGER NOT NULL,
                lead_action_id INTEGER,
                subject TEXT NOT NULL,
                body TEXT NOT NULL,
                message_type TEXT DEFAULT 'email',
                sent_at TIMESTAMP,
                status TEXT DEFAULT 'pending',
                response_received INTEGER DEFAULT 0,
                response_text TEXT,
                open_count INTEGER DEFAULT 0,
                click_count INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (campaign_id) REFERENCES campaigns(id),
                FOREIGN KEY (lead_action_id) REFERENCES lead_actions(id)
            )
        """)
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_messages_campaign ON messages(campaign_id)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_messages_contact ON messages(contact_id)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_messages_status ON messages(status)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_messages_sent_at ON messages(sent_at)")
        
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


# ============ Campaign Operations ============

def create_campaign(title: str, description: str = None, subject_template: str = None, body_template: str = None) -> int:
    """Create a new campaign. Returns the campaign ID."""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO campaigns (title, description, subject_template, body_template)
            VALUES (?, ?, ?, ?)
        """, (title, description, subject_template, body_template))
        return cursor.lastrowid


def get_campaigns() -> List[Dict]:
    """Get all campaigns."""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM campaigns ORDER BY created_at DESC")
        return [dict(row) for row in cursor.fetchall()]


def get_campaign(campaign_id: int) -> Optional[Dict]:
    """Get a single campaign by ID."""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM campaigns WHERE id = ?", (campaign_id,))
        row = cursor.fetchone()
        return dict(row) if row else None


def update_campaign(campaign_id: int, title: str = None, description: str = None, 
                   subject_template: str = None, body_template: str = None):
    """Update a campaign."""
    updates = []
    params = []
    
    if title is not None:
        updates.append("title = ?")
        params.append(title)
    if description is not None:
        updates.append("description = ?")
        params.append(description)
    if subject_template is not None:
        updates.append("subject_template = ?")
        params.append(subject_template)
    if body_template is not None:
        updates.append("body_template = ?")
        params.append(body_template)
    
    if not updates:
        return
    
    updates.append("updated_at = CURRENT_TIMESTAMP")
    params.append(campaign_id)
    
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute(f"""
            UPDATE campaigns SET {', '.join(updates)}
            WHERE id = ?
        """, params)


def delete_campaign(campaign_id: int):
    """Delete a campaign."""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM campaigns WHERE id = ?", (campaign_id,))


# ============ Workflow Operations ============

def create_workflow(name: str, description: str = None, workflow_json: str = None) -> int:
    """Create a new workflow. Returns the workflow ID."""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO workflows (name, description, workflow_json)
            VALUES (?, ?, ?)
        """, (name, description, workflow_json or '{}'))
        return cursor.lastrowid


def get_workflows() -> List[Dict]:
    """Get all workflows."""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM workflows ORDER BY created_at DESC")
        return [dict(row) for row in cursor.fetchall()]


def get_workflow(workflow_id: int) -> Optional[Dict]:
    """Get a single workflow by ID."""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM workflows WHERE id = ?", (workflow_id,))
        row = cursor.fetchone()
        return dict(row) if row else None


def update_workflow(workflow_id: int, name: str = None, description: str = None, workflow_json: str = None):
    """Update a workflow."""
    updates = []
    params = []
    
    if name is not None:
        updates.append("name = ?")
        params.append(name)
    if description is not None:
        updates.append("description = ?")
        params.append(description)
    if workflow_json is not None:
        updates.append("workflow_json = ?")
        params.append(workflow_json)
    
    if not updates:
        return
    
    updates.append("updated_at = CURRENT_TIMESTAMP")
    params.append(workflow_id)
    
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute(f"""
            UPDATE workflows SET {', '.join(updates)}
            WHERE id = ?
        """, params)


def delete_workflow(workflow_id: int):
    """Delete a workflow."""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM workflows WHERE id = ?", (workflow_id,))


# ============ Workflow Execution Operations ============

def create_workflow_execution(workflow_id: int, selected_lead_ids: List[int] = None) -> int:
    """Create a new workflow execution. Returns the execution ID."""
    with get_db() as conn:
        cursor = conn.cursor()
        lead_ids_json = json.dumps(selected_lead_ids or [])
        cursor.execute("""
            INSERT INTO workflow_executions (workflow_id, selected_lead_ids)
            VALUES (?, ?)
        """, (workflow_id, lead_ids_json))
        return cursor.lastrowid


def get_workflow_execution(execution_id: int) -> Optional[Dict]:
    """Get a workflow execution by ID."""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM workflow_executions WHERE id = ?", (execution_id,))
        row = cursor.fetchone()
        if row:
            result = dict(row)
            if result.get('selected_lead_ids'):
                result['selected_lead_ids'] = json.loads(result['selected_lead_ids'])
            return result
        return None


def update_workflow_execution_status(execution_id: int, status: str, error_message: str = None):
    """Update workflow execution status."""
    with get_db() as conn:
        cursor = conn.cursor()
        if status == 'completed':
            cursor.execute("""
                UPDATE workflow_executions 
                SET status = ?, completed_at = CURRENT_TIMESTAMP, error_message = ?
                WHERE id = ?
            """, (status, error_message, execution_id))
        else:
            cursor.execute("""
                UPDATE workflow_executions 
                SET status = ?, error_message = ?
                WHERE id = ?
            """, (status, error_message, execution_id))


# ============ Lead Action Operations ============

def create_lead_action(contact_id: int, workflow_execution_id: int = None, 
                      action_type: str = None, action_details: str = None) -> int:
    """Create a lead action. Returns the action ID."""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO lead_actions (contact_id, workflow_execution_id, action_type, action_details)
            VALUES (?, ?, ?, ?)
        """, (contact_id, workflow_execution_id, action_type, action_details))
        return cursor.lastrowid


def update_lead_action(action_id: int, action_status: str = None, action_details: str = None,
                      sf_record_url: str = None, linkedin_request_sent: bool = None, 
                      email_sent: bool = None):
    """Update a lead action."""
    updates = []
    params = []
    
    if action_status is not None:
        updates.append("action_status = ?")
        params.append(action_status)
    if action_details is not None:
        updates.append("action_details = ?")
        params.append(action_details)
    if sf_record_url is not None:
        updates.append("sf_record_url = ?")
        params.append(sf_record_url)
    if linkedin_request_sent is not None:
        updates.append("linkedin_request_sent = ?")
        params.append(1 if linkedin_request_sent else 0)
    if email_sent is not None:
        updates.append("email_sent = ?")
        params.append(1 if email_sent else 0)
    
    if not updates:
        return
    
    updates.append("updated_at = CURRENT_TIMESTAMP")
    params.append(action_id)
    
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute(f"""
            UPDATE lead_actions SET {', '.join(updates)}
            WHERE id = ?
        """, params)


def get_lead_actions(contact_id: int = None, workflow_execution_id: int = None) -> List[Dict]:
    """Get lead actions, optionally filtered by contact or execution."""
    with get_db() as conn:
        cursor = conn.cursor()
        if contact_id:
            cursor.execute("SELECT * FROM lead_actions WHERE contact_id = ? ORDER BY created_at DESC", (contact_id,))
        elif workflow_execution_id:
            cursor.execute("SELECT * FROM lead_actions WHERE workflow_execution_id = ? ORDER BY created_at DESC", (workflow_execution_id,))
        else:
            cursor.execute("SELECT * FROM lead_actions ORDER BY created_at DESC")
        return [dict(row) for row in cursor.fetchall()]


# ============ Message Operations ============

def create_message(campaign_id: int, contact_id: int, lead_action_id: int = None,
                  subject: str = None, body: str = None, message_type: str = 'email') -> int:
    """Create a message record. Returns the message ID."""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO messages (campaign_id, contact_id, lead_action_id, subject, body, message_type)
            VALUES (?, ?, ?, ?, ?, ?)
        """, (campaign_id, contact_id, lead_action_id, subject, body, message_type))
        return cursor.lastrowid


def update_message_status(message_id: int, status: str = None, sent_at: str = None):
    """Update message status."""
    updates = []
    params = []
    
    if status is not None:
        updates.append("status = ?")
        params.append(status)
    if sent_at is not None:
        updates.append("sent_at = ?")
        params.append(sent_at)
    
    if not updates:
        return
    
    params.append(message_id)
    
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute(f"""
            UPDATE messages SET {', '.join(updates)}
            WHERE id = ?
        """, params)


def get_messages(campaign_id: int = None, contact_id: int = None) -> List[Dict]:
    """Get messages, optionally filtered by campaign or contact."""
    with get_db() as conn:
        cursor = conn.cursor()
        if campaign_id:
            cursor.execute("SELECT * FROM messages WHERE campaign_id = ? ORDER BY created_at DESC", (campaign_id,))
        elif contact_id:
            cursor.execute("SELECT * FROM messages WHERE contact_id = ? ORDER BY created_at DESC", (contact_id,))
        else:
            cursor.execute("SELECT * FROM messages ORDER BY created_at DESC")
        return [dict(row) for row in cursor.fetchall()]


def get_campaign_stats(campaign_id: int) -> Dict:
    """Get statistics for a campaign."""
    with get_db() as conn:
        cursor = conn.cursor()
        
        # Total messages
        cursor.execute("SELECT COUNT(*) as total FROM messages WHERE campaign_id = ?", (campaign_id,))
        total = cursor.fetchone()['total']
        
        # Sent messages
        cursor.execute("SELECT COUNT(*) as sent FROM messages WHERE campaign_id = ? AND status = 'sent'", (campaign_id,))
        sent = cursor.fetchone()['sent']
        
        # Pending messages
        cursor.execute("SELECT COUNT(*) as pending FROM messages WHERE campaign_id = ? AND status = 'pending'", (campaign_id,))
        pending = cursor.fetchone()['pending']
        
        # Responses
        cursor.execute("SELECT COUNT(*) as responses FROM messages WHERE campaign_id = ? AND response_received = 1", (campaign_id,))
        responses = cursor.fetchone()['responses']
        
        # Opens
        cursor.execute("SELECT SUM(open_count) as opens FROM messages WHERE campaign_id = ?", (campaign_id,))
        opens_row = cursor.fetchone()
        opens = opens_row['opens'] or 0
        
        # Clicks
        cursor.execute("SELECT SUM(click_count) as clicks FROM messages WHERE campaign_id = ?", (campaign_id,))
        clicks_row = cursor.fetchone()
        clicks = clicks_row['clicks'] or 0
        
        return {
            'total': total,
            'sent': sent,
            'pending': pending,
            'responses': responses,
            'opens': opens,
            'clicks': clicks,
            'response_rate': (responses / sent * 100) if sent > 0 else 0,
            'open_rate': (opens / sent * 100) if sent > 0 else 0,
            'click_rate': (clicks / sent * 100) if sent > 0 else 0
        }


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


# Initialize database when module is imported
init_database()


