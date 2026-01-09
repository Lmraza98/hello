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


def update_target_status(domain: str, status: str):
    """Update a target's processing status."""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            UPDATE targets 
            SET status = ?, updated_at = CURRENT_TIMESTAMP
            WHERE domain = ?
        """, (status, domain))


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


# Initialize database when module is imported
init_database()


