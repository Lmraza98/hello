"""
SQLite database schema and operations.
Single-file database for easy portability and resume capability.
"""
import sqlite3
import json
import math
import time
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional, List, Dict, Any
from contextlib import contextmanager
from dataclasses import dataclass, asdict

import config

_ENTITY_SEARCH_REFRESH_TTL_SECONDS = 30
_ENTITY_SEARCH_LAST_REFRESH: Dict[str, float] = {}


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

        # Generic entity notes (chat/user annotations)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS entity_notes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                entity_type TEXT NOT NULL,
                entity_id TEXT NOT NULL,
                content TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_entity_notes_entity ON entity_notes(entity_type, entity_id)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_entity_notes_created ON entity_notes(created_at)")
        
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
                location TEXT,
                name TEXT NOT NULL,
                name_raw TEXT,
                name_first TEXT,
                name_middle TEXT,
                name_last TEXT,
                name_prefix TEXT,
                name_suffix TEXT,
                name_confidence REAL,
                name_review_reason TEXT,
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
                salesforce_sync_status TEXT,
                salesforce_url TEXT,
                salesforce_uploaded_at TIMESTAMP,
                salesforce_upload_batch TEXT,
                lead_source TEXT,
                ingest_batch_id TEXT,
                scraped_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_linkedin_contacts_company ON linkedin_contacts(company_name)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_linkedin_contacts_domain ON linkedin_contacts(domain)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_linkedin_contacts_salesforce ON linkedin_contacts(salesforce_status)")
        
        # Migration: Add salesforce tracking columns to existing databases
        sf_columns = [
            ('salesforce_url', 'TEXT'),
            ('salesforce_sync_status', 'TEXT'),
            ('salesforce_uploaded_at', 'TIMESTAMP'),
            ('salesforce_upload_batch', 'TEXT'),
            ('lead_source', 'TEXT'),
            ('ingest_batch_id', 'TEXT'),
            ('location', 'TEXT'),
            ('name_raw', 'TEXT'),
            ('name_first', 'TEXT'),
            ('name_middle', 'TEXT'),
            ('name_last', 'TEXT'),
            ('name_prefix', 'TEXT'),
            ('name_suffix', 'TEXT'),
            ('name_confidence', 'REAL'),
            ('name_review_reason', 'TEXT'),
        ]
        for col_name, col_type in sf_columns:
            try:
                cursor.execute(f"ALTER TABLE linkedin_contacts ADD COLUMN {col_name} {col_type}")
            except sqlite3.OperationalError:
                pass  # Column already exists

        # Create source index after migration so existing DBs without the
        # new column do not fail during startup.
        cursor.execute("PRAGMA table_info(linkedin_contacts)")
        contact_columns = {row[1] for row in cursor.fetchall()}
        if "lead_source" in contact_columns:
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_linkedin_contacts_lead_source ON linkedin_contacts(lead_source)")
        if "salesforce_sync_status" in contact_columns:
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_linkedin_contacts_sf_sync ON linkedin_contacts(salesforce_sync_status)")

        # Documents table - uploaded files for retrieval and analysis
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS documents (
                id TEXT PRIMARY KEY,
                filename TEXT NOT NULL,
                mime_type TEXT NOT NULL,
                file_size_bytes INTEGER,
                storage_backend TEXT NOT NULL,
                storage_path TEXT NOT NULL,
                folder_path TEXT DEFAULT '',
                status TEXT NOT NULL DEFAULT 'pending',
                status_message TEXT,
                processed_at TIMESTAMP,
                extracted_text TEXT,
                text_length INTEGER,
                page_count INTEGER,
                document_type TEXT,
                document_type_confidence REAL,
                summary TEXT,
                key_points TEXT,
                extracted_entities TEXT,
                linked_company_id INTEGER REFERENCES targets(id) ON DELETE SET NULL,
                link_confirmed BOOLEAN DEFAULT 0,
                link_confirmed_at TIMESTAMP,
                link_confirmed_by TEXT,
                uploaded_by TEXT,
                uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                source TEXT DEFAULT 'chat',
                conversation_id TEXT,
                notes TEXT
            )
        """)
        # Migration: folder path support for user-managed document trees.
        try:
            cursor.execute("ALTER TABLE documents ADD COLUMN folder_path TEXT DEFAULT ''")
        except sqlite3.OperationalError:
            pass
        cursor.execute("UPDATE documents SET folder_path = '' WHERE folder_path IS NULL")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_documents_folder_path ON documents(folder_path)")

        # User-defined document folders (supports empty folders and nested hierarchy).
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS document_folders (
                path TEXT PRIMARY KEY,
                parent_path TEXT NOT NULL DEFAULT '',
                name TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_document_folders_parent_path ON document_folders(parent_path)")

        cursor.execute("""
            CREATE TABLE IF NOT EXISTS document_chunks (
                id TEXT PRIMARY KEY,
                document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
                chunk_index INTEGER NOT NULL,
                content TEXT NOT NULL,
                token_count INTEGER,
                page_number INTEGER,
                start_char INTEGER,
                end_char INTEGER,
                embedding BLOB,
                embedding_model TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(document_id, chunk_index)
            )
        """)

        cursor.execute("""
            CREATE TABLE IF NOT EXISTS document_contacts (
                document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
                contact_id INTEGER NOT NULL REFERENCES linkedin_contacts(id) ON DELETE CASCADE,
                mention_type TEXT,
                confidence REAL,
                confirmed BOOLEAN DEFAULT 0,
                context_snippet TEXT,
                PRIMARY KEY (document_id, contact_id)
            )
        """)

        cursor.execute("CREATE INDEX IF NOT EXISTS idx_documents_status ON documents(status)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_documents_company ON documents(linked_company_id)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_documents_type ON documents(document_type)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_documents_uploaded ON documents(uploaded_at DESC)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_chunks_document ON document_chunks(document_id)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_doc_contacts_document ON document_contacts(document_id)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_doc_contacts_contact ON document_contacts(contact_id)")
        
        # Email campaigns table - multi-step email sequences
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS email_campaigns (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                description TEXT,
                num_emails INTEGER DEFAULT 3,
                days_between_emails INTEGER DEFAULT 3,
                template_id INTEGER,
                template_mode TEXT DEFAULT 'copied',
                status TEXT DEFAULT 'draft',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_email_campaigns_status ON email_campaigns(status)")
        for col_name, col_type in [("template_id", "INTEGER"), ("template_mode", "TEXT DEFAULT 'copied'")]:
            try:
                cursor.execute(f"ALTER TABLE email_campaigns ADD COLUMN {col_name} {col_type}")
            except sqlite3.OperationalError:
                pass
        try:
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_email_campaigns_template_id ON email_campaigns(template_id)")
        except sqlite3.OperationalError:
            pass

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

        # Reusable template library (ActiveCampaign-style templates)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS email_template_library (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                subject TEXT NOT NULL,
                preheader TEXT,
                from_name TEXT,
                from_email TEXT,
                reply_to TEXT,
                html_body TEXT NOT NULL,
                text_body TEXT,
                status TEXT DEFAULT 'active',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_email_template_library_status ON email_template_library(status)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_email_template_library_name ON email_template_library(name)")

        cursor.execute("""
            CREATE TABLE IF NOT EXISTS email_template_revisions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                template_id INTEGER NOT NULL,
                revision_number INTEGER NOT NULL,
                snapshot_json TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (template_id) REFERENCES email_template_library(id) ON DELETE CASCADE
            )
        """)
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_email_template_revisions_template ON email_template_revisions(template_id)")
        cursor.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_email_template_revisions_number ON email_template_revisions(template_id, revision_number)")

        cursor.execute("""
            CREATE TABLE IF NOT EXISTS email_template_blocks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                category TEXT,
                html TEXT NOT NULL,
                text TEXT,
                status TEXT DEFAULT 'active',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_email_template_blocks_status ON email_template_blocks(status)")
        
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
            ('sf_email_url', 'TEXT'),
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

        # Inbound lead notifications parsed from third-party notification emails.
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS inbound_lead_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                outlook_message_id TEXT UNIQUE,
                source_sender TEXT,
                subject TEXT,
                body_preview TEXT,
                lead_name TEXT,
                lead_company TEXT,
                lead_email TEXT,
                lead_phone TEXT,
                lead_title TEXT,
                lead_industry TEXT,
                lead_location TEXT,
                contact_id INTEGER,
                status TEXT DEFAULT 'created',
                error TEXT,
                received_at TIMESTAMP,
                detected_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                seen INTEGER DEFAULT 0,
                seen_at TIMESTAMP,
                FOREIGN KEY (contact_id) REFERENCES linkedin_contacts(id)
            )
        """)
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_inbound_lead_events_seen ON inbound_lead_events(seen)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_inbound_lead_events_received ON inbound_lead_events(received_at)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_inbound_lead_events_email ON inbound_lead_events(lead_email)")
        try:
            cursor.execute("ALTER TABLE inbound_lead_events ADD COLUMN lead_location TEXT")
        except Exception:
            pass
        
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

        # Embeddings table for semantic vector search.
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS semantic_embeddings (
                chunk_id TEXT PRIMARY KEY,
                source_type TEXT NOT NULL,
                source_id TEXT NOT NULL,
                embedding BLOB NOT NULL,
                model TEXT NOT NULL,
                dimensions INTEGER NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (chunk_id) REFERENCES semantic_chunks(chunk_id) ON DELETE CASCADE
            )
        """)
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_semantic_embeddings_source ON semantic_embeddings(source_type, source_id)")

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
            ('outlook_poll_interval_minutes', '1'),
        ]
        for key, value in default_configs:
            cursor.execute(
                "INSERT OR IGNORE INTO system_config (key, value) VALUES (?, ?)",
                (key, value)
            )


# ============ Target Operations ============

def _table_exists(cursor: sqlite3.Cursor, table_name: str) -> bool:
    cursor.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name = ? LIMIT 1",
        (table_name,),
    )
    return cursor.fetchone() is not None


def _normalize_name(value: str | None) -> str:
    if not value:
        return ""
    return " ".join(str(value).strip().lower().split())


def _normalize_domain(value: str | None) -> str:
    if not value:
        return ""
    text = str(value).strip().lower()
    text = re.sub(r"^https?://", "", text)
    text = re.sub(r"^www\.", "", text)
    text = text.split("/")[0]
    text = text.split(":")[0]
    return text


def _company_key(domain: str | None, name: str | None) -> str:
    normalized_domain = _normalize_domain(domain)
    if normalized_domain:
        return normalized_domain
    fallback = re.sub(r"[^a-z0-9]+", "-", _normalize_name(name)).strip("-")
    return f"name:{fallback}" if fallback else "name:unknown"


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
    
    If ``vertical`` is not provided, attempts to auto-classify the company
    industry using a local LLM call (~200-500ms).
    
    Args:
        company_name: Company name for LinkedIn search (required)
        domain: Optional company domain (for deduplication). If not provided,
                a slug of the company name is used.
        tier: Priority tier (A, B, C)
        vertical: Industry/vertical (auto-classified if missing)
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

    # Auto-classify vertical when missing — uses deterministic SalesNav parser mappings.
    if not vertical or not vertical.strip():
        try:
            from services.web_automation.linkedin.salesnav.filter_parser import infer_company_vertical
            vertical = infer_company_vertical(company_name, domain)
        except Exception:
            pass  # Non-fatal: better to insert without vertical than to fail
    
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


def get_pending_targets(limit: int = 100, tier: str | None = None) -> List[Dict]:
    """Get targets that haven't been processed yet."""
    with get_db() as conn:
        cursor = conn.cursor()
        query = """
            SELECT *
            FROM targets
            WHERE status = 'pending'
        """
        params: list = []
        if tier:
            query += " AND tier = ?"
            params.append(tier)
        query += " ORDER BY created_at LIMIT ?"
        params.append(limit)
        cursor.execute(query, params)
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


def get_contacts_missing_public_urls(limit: int = 100, company_name: str | None = None) -> List[Dict]:
    """Get contacts whose LinkedIn URL is missing or still points to Sales Navigator."""
    with get_db() as conn:
        cursor = conn.cursor()
        query = """
            SELECT id, name, company_name, title, linkedin_url
            FROM linkedin_contacts
            WHERE (linkedin_url IS NULL
                   OR linkedin_url = ''
                   OR linkedin_url LIKE '%/sales/lead/%'
                   OR linkedin_url LIKE '%/sales/people/%')
        """
        params: list = []
        if company_name:
            query += " AND company_name = ?"
            params.append(company_name)
        query += " ORDER BY company_name, name LIMIT ?"
        params.append(limit)
        cursor.execute(query, params)
        return [dict(row) for row in cursor.fetchall()]


def _slugify_company_domain(company_name: str) -> str:
    normalized = re.sub(r"[^\w\s-]", "", company_name.lower())
    return re.sub(r"[\s_]+", "-", normalized).strip("-")


def _prepare_ingested_name(raw_name: str) -> Dict[str, Any]:
    from services.identity.name_classifier import classify_name

    classified = classify_name(raw_name or "")
    cleaned = (classified.cleaned_full_name or "").strip() or (raw_name or "").strip()
    return {
        "name": cleaned,
        "name_raw": (raw_name or "").strip() or cleaned,
        "name_first": (classified.first or "").strip() or None,
        "name_middle": (classified.middle or "").strip() or None,
        "name_last": (classified.last or "").strip() or None,
        "name_prefix": (classified.prefix_title or "").strip() or None,
        "name_suffix": (classified.suffix_credentials or "").strip() or None,
        "name_confidence": float(classified.confidence),
        "name_review_reason": (classified.review_reason or "").strip() or None,
        "needs_review": bool(classified.needs_review),
    }


def _merge_contact_title(existing_title: str | None, incoming_title: str | None, name_prefix: str | None) -> str | None:
    incoming = (incoming_title or "").strip()
    existing = (existing_title or "").strip()
    prefix = (name_prefix or "").strip()
    if incoming:
        return incoming
    if existing:
        return existing
    return prefix or None


def add_linkedin_contact(
    *,
    company_name: str,
    name: str,
    domain: str | None = None,
    location: str | None = None,
    title: str | None = None,
    email_generated: str | None = None,
    linkedin_url: str | None = None,
    phone: str | None = None,
    salesforce_url: str | None = None,
    salesforce_status: str | None = None,
    lead_source: str | None = None,
    ingest_batch_id: str | None = None,
) -> int:
    """Insert one LinkedIn contact after ingestion-time name normalization."""
    if not domain and company_name:
        domain = _slugify_company_domain(company_name)
    prepared = _prepare_ingested_name(name)
    merged_title = _merge_contact_title(None, title, prepared["name_prefix"])

    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO linkedin_contacts (
                company_name, domain, location, name, name_raw, name_first, name_middle, name_last,
                name_prefix, name_suffix, name_confidence, name_review_reason,
                title, email_generated, linkedin_url, phone, salesforce_url, salesforce_status,
                lead_source, ingest_batch_id, scraped_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            """,
            (
                company_name,
                domain,
                (location or "").strip() or None,
                prepared["name"],
                prepared["name_raw"],
                prepared["name_first"],
                prepared["name_middle"],
                prepared["name_last"],
                prepared["name_prefix"],
                prepared["name_suffix"],
                prepared["name_confidence"],
                prepared["name_review_reason"],
                merged_title,
                (email_generated or "").strip() or None,
                (linkedin_url or "").strip() or None,
                (phone or "").strip() or None,
                (salesforce_url or "").strip() or None,
                (salesforce_status or "").strip() or None,
                (lead_source or "").strip() or None,
                (ingest_batch_id or "").strip() or None,
            ),
        )
        return int(cursor.lastrowid)


def save_linkedin_contacts(
    company_name: str,
    employees: List[Dict],
    domain: str | None = None,
    lead_source: str | None = None,
    ingest_batch_id: str | None = None,
) -> int:
    """Upsert LinkedIn contacts for a company and return number of affected rows."""
    if not domain and company_name:
        domain = _slugify_company_domain(company_name)

    affected_rows = 0
    with get_db() as conn:
        cursor = conn.cursor()
        for employee in employees:
            raw_name = str(employee.get("name") or "").strip()
            if not raw_name:
                continue
            prepared = _prepare_ingested_name(raw_name)
            normalized_name = prepared["name"]

            title = str(employee.get("title") or "").strip() or None
            location = str(employee.get("location") or "").strip() or None
            linkedin_url = (
                str(employee.get("linkedin_url") or "").strip()
                or str(employee.get("public_url") or "").strip()
                or str(employee.get("sales_nav_url") or "").strip()
                or None
            )

            row = None
            if linkedin_url:
                cursor.execute(
                    """
                    SELECT id, title, linkedin_url
                    FROM linkedin_contacts
                    WHERE company_name = ? AND name = ? AND linkedin_url = ?
                    ORDER BY id DESC
                    LIMIT 1
                    """,
                    (company_name, normalized_name, linkedin_url),
                )
                row = cursor.fetchone()

            if not row:
                cursor.execute(
                    """
                    SELECT id, title, linkedin_url
                    FROM linkedin_contacts
                    WHERE company_name = ? AND name = ?
                    ORDER BY id DESC
                    LIMIT 1
                    """,
                    (company_name, normalized_name),
                )
                row = cursor.fetchone()

            if row:
                contact_id = int(row["id"])
                merged_title = _merge_contact_title(row["title"], title, prepared["name_prefix"])
                merged_url = linkedin_url or row["linkedin_url"]
                cursor.execute(
                    """
                    UPDATE linkedin_contacts
                    SET domain = ?,
                        location = COALESCE(NULLIF(?, ''), location),
                        name = ?,
                        name_raw = ?,
                        name_first = ?,
                        name_middle = ?,
                        name_last = ?,
                        name_prefix = ?,
                        name_suffix = ?,
                        name_confidence = ?,
                        name_review_reason = ?,
                        title = ?,
                        linkedin_url = ?,
                        lead_source = COALESCE(NULLIF(lead_source, ''), ?),
                        ingest_batch_id = COALESCE(NULLIF(ingest_batch_id, ''), ?),
                        scraped_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                    """,
                    (
                        domain,
                        location,
                        prepared["name"],
                        prepared["name_raw"],
                        prepared["name_first"],
                        prepared["name_middle"],
                        prepared["name_last"],
                        prepared["name_prefix"],
                        prepared["name_suffix"],
                        prepared["name_confidence"],
                        prepared["name_review_reason"],
                        merged_title,
                        merged_url,
                        (lead_source or "").strip() or None,
                        (ingest_batch_id or "").strip() or None,
                        contact_id,
                    ),
                )
                affected_rows += int(cursor.rowcount)
                continue

            cursor.execute(
                """
                INSERT INTO linkedin_contacts
                (
                    company_name, domain, location, name, name_raw, name_first, name_middle, name_last,
                    name_prefix, name_suffix, name_confidence, name_review_reason,
                    title, linkedin_url, lead_source, ingest_batch_id, scraped_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                """,
                (
                    company_name,
                    domain,
                    location,
                    prepared["name"],
                    prepared["name_raw"],
                    prepared["name_first"],
                    prepared["name_middle"],
                    prepared["name_last"],
                    prepared["name_prefix"],
                    prepared["name_suffix"],
                    prepared["name_confidence"],
                    prepared["name_review_reason"],
                    _merge_contact_title(None, title, prepared["name_prefix"]),
                    linkedin_url,
                    (lead_source or "").strip() or None,
                    (ingest_batch_id or "").strip() or None,
                ),
            )
            affected_rows += int(cursor.rowcount)

    return affected_rows


def get_contacts_missing_generated_email(company_name: str) -> List[Dict]:
    """Get contacts for a company with no generated email yet."""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT id, name
            FROM linkedin_contacts
            WHERE company_name = ?
              AND (email_generated IS NULL OR email_generated = '')
            """,
            (company_name,),
        )
        return [dict(row) for row in cursor.fetchall()]


def update_contact_generated_email(contact_id: int, email: str, pattern: str, confidence_pct: int) -> None:
    """Persist generated email metadata for one contact."""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            UPDATE linkedin_contacts
            SET email_generated = ?, email_pattern = ?, email_confidence = ?
            WHERE id = ?
            """,
            (email, pattern, confidence_pct, contact_id),
        )


def update_contact_linkedin_url(contact_id: int, linkedin_url: str) -> None:
    """Update a contact's LinkedIn URL."""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            UPDATE linkedin_contacts
            SET linkedin_url = ?, scraped_at = CURRENT_TIMESTAMP
            WHERE id = ?
            """,
            (linkedin_url, contact_id),
        )


def get_linkedin_contacts(company_name: str | None = None, domain: str | None = None) -> List[Dict]:
    """Get stored LinkedIn contacts by company name or domain."""
    if not company_name and not domain:
        return []

    with get_db() as conn:
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
        else:
            cursor.execute(
                """
                SELECT name, title, linkedin_url, company_name, domain
                FROM linkedin_contacts
                WHERE domain = ?
                ORDER BY scraped_at DESC
                """,
                (domain,),
            )
        return [dict(row) for row in cursor.fetchall()]


def count_targets(status: str | None = None) -> int:
    """Count target rows, optionally filtered by status."""
    with get_db() as conn:
        cursor = conn.cursor()
        if status:
            cursor.execute("SELECT COUNT(*) FROM targets WHERE status = ?", (status,))
        else:
            cursor.execute("SELECT COUNT(*) FROM targets")
        return int(cursor.fetchone()[0])


def count_linkedin_contacts(*, with_generated_email: bool = False) -> int:
    """Count LinkedIn contacts, optionally only those with generated emails."""
    with get_db() as conn:
        cursor = conn.cursor()
        if with_generated_email:
            cursor.execute(
                """
                SELECT COUNT(*)
                FROM linkedin_contacts
                WHERE email_generated IS NOT NULL AND email_generated != ''
                """
            )
        else:
            cursor.execute("SELECT COUNT(*) FROM linkedin_contacts")
        return int(cursor.fetchone()[0])


def count_email_campaigns() -> int:
    """Count email campaigns."""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT COUNT(*) FROM email_campaigns")
        return int(cursor.fetchone()[0])


def count_sent_emails() -> int:
    """Count sent email records."""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT COUNT(*) FROM sent_emails")
        return int(cursor.fetchone()[0])


def clear_pending_send_queue() -> int:
    """Delete pending send-queue rows and return deleted row count."""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM send_queue WHERE status = 'pending'")
        return int(cursor.rowcount)


def reset_all_target_statuses(status: str = "pending") -> int:
    """Set all targets to a single status and return updated row count."""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            UPDATE targets
            SET status = ?, updated_at = CURRENT_TIMESTAMP
            """,
            (status,),
        )
        return int(cursor.rowcount)


def reset_uploaded_salesforce_contacts() -> int:
    """Reset contacts with uploaded Salesforce status back to pending."""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            UPDATE linkedin_contacts
            SET salesforce_status = 'pending',
                salesforce_uploaded_at = NULL,
                salesforce_upload_batch = NULL
            WHERE salesforce_status = 'uploaded'
            """
        )
        return int(cursor.rowcount)


def clear_all_linkedin_contacts() -> int:
    """Delete all LinkedIn contacts and return deleted row count."""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM linkedin_contacts")
        return int(cursor.rowcount)


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
    days_between_emails: int = 3,
    template_id: int = None,
    template_mode: str = "copied",
) -> int:
    """Create a new email campaign. Returns the campaign ID."""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO email_campaigns (name, description, num_emails, days_between_emails, template_id, template_mode)
            VALUES (?, ?, ?, ?, ?, ?)
        """, (name, description, num_emails, days_between_emails, template_id, template_mode or "copied"))
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
    template_id: int = None,
    template_mode: str = None,
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
    if template_id is not None:
        updates.append("template_id = ?")
        params.append(template_id)
    if template_mode is not None:
        updates.append("template_mode = ?")
        params.append(template_mode)
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


def set_campaign_template_link(campaign_id: int, template_id: int = None, template_mode: str = "linked") -> bool:
    """Attach/detach a library template from a campaign."""
    if template_mode not in {"linked", "copied"}:
        template_mode = "linked"
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            UPDATE email_campaigns
            SET template_id = ?, template_mode = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            """,
            (template_id, template_mode, campaign_id),
        )
        return cursor.rowcount > 0


def list_email_library_templates(
    query: str = None,
    status: str = None,
    limit: int = 100,
    offset: int = 0,
) -> List[Dict]:
    with get_db() as conn:
        cursor = conn.cursor()
        sql = "SELECT * FROM email_template_library WHERE 1=1"
        params: List[Any] = []
        if status in {"active", "archived"}:
            sql += " AND status = ?"
            params.append(status)
        if query:
            like = f"%{query.strip()}%"
            sql += " AND (name LIKE ? OR subject LIKE ? OR html_body LIKE ?)"
            params.extend([like, like, like])
        sql += " ORDER BY updated_at DESC, id DESC LIMIT ? OFFSET ?"
        params.extend([max(1, min(int(limit), 200)), max(0, int(offset))])
        cursor.execute(sql, params)
        return [dict(row) for row in cursor.fetchall()]


def get_email_library_template(template_id: int) -> Optional[Dict]:
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM email_template_library WHERE id = ?", (template_id,))
        row = cursor.fetchone()
        return dict(row) if row else None


def _record_template_revision(cursor: sqlite3.Cursor, template_id: int, snapshot: Dict[str, Any], max_revisions: int = 20) -> None:
    cursor.execute(
        "SELECT COALESCE(MAX(revision_number), 0) AS rev FROM email_template_revisions WHERE template_id = ?",
        (template_id,),
    )
    rev = int((cursor.fetchone() or {"rev": 0})["rev"]) + 1
    cursor.execute(
        """
        INSERT INTO email_template_revisions (template_id, revision_number, snapshot_json)
        VALUES (?, ?, ?)
        """,
        (template_id, rev, json.dumps(snapshot)),
    )
    cursor.execute(
        """
        DELETE FROM email_template_revisions
        WHERE template_id = ?
          AND id NOT IN (
            SELECT id FROM email_template_revisions
            WHERE template_id = ?
            ORDER BY revision_number DESC
            LIMIT ?
          )
        """,
        (template_id, template_id, max(1, int(max_revisions))),
    )


def create_email_library_template(
    name: str,
    subject: str,
    html_body: str,
    preheader: str = None,
    from_name: str = None,
    from_email: str = None,
    reply_to: str = None,
    text_body: str = None,
    status: str = "active",
) -> int:
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO email_template_library
            (name, subject, preheader, from_name, from_email, reply_to, html_body, text_body, status, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            """,
            (name, subject, preheader, from_name, from_email, reply_to, html_body, text_body, status or "active"),
        )
        template_id = int(cursor.lastrowid)
        snapshot = get_email_library_template(template_id) or {}
        _record_template_revision(cursor, template_id, snapshot)
        return template_id


def update_email_library_template(template_id: int, updates: Dict[str, Any], max_revisions: int = 20) -> bool:
    allowed = {"name", "subject", "preheader", "from_name", "from_email", "reply_to", "html_body", "text_body", "status"}
    set_parts: List[str] = []
    params: List[Any] = []
    for key, value in (updates or {}).items():
        if key in allowed:
            set_parts.append(f"{key} = ?")
            params.append(value)
    if not set_parts:
        return False
    set_parts.append("updated_at = CURRENT_TIMESTAMP")
    params.append(template_id)
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute(f"UPDATE email_template_library SET {', '.join(set_parts)} WHERE id = ?", params)
        if cursor.rowcount <= 0:
            return False
        snapshot = get_email_library_template(template_id) or {}
        _record_template_revision(cursor, template_id, snapshot, max_revisions=max_revisions)
        return True


def duplicate_email_library_template(template_id: int, name_suffix: str = "Copy") -> Optional[int]:
    original = get_email_library_template(template_id)
    if not original:
        return None
    return create_email_library_template(
        name=f"{original.get('name') or 'Template'} ({name_suffix})",
        subject=original.get("subject") or "",
        preheader=original.get("preheader"),
        from_name=original.get("from_name"),
        from_email=original.get("from_email"),
        reply_to=original.get("reply_to"),
        html_body=original.get("html_body") or "",
        text_body=original.get("text_body"),
        status="active",
    )


def list_email_template_revisions(template_id: int, limit: int = 20) -> List[Dict]:
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT * FROM email_template_revisions
            WHERE template_id = ?
            ORDER BY revision_number DESC
            LIMIT ?
            """,
            (template_id, max(1, min(int(limit), 100))),
        )
        rows = [dict(row) for row in cursor.fetchall()]
        for row in rows:
            row["snapshot"] = _json_loads_safe(row.get("snapshot_json"), {})
        return rows


def revert_email_library_template(template_id: int, revision_number: int, max_revisions: int = 20) -> bool:
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT snapshot_json FROM email_template_revisions
            WHERE template_id = ? AND revision_number = ?
            """,
            (template_id, revision_number),
        )
        row = cursor.fetchone()
        if not row:
            return False
        snapshot = _json_loads_safe(row["snapshot_json"], {})
        updates = {
            "name": snapshot.get("name"),
            "subject": snapshot.get("subject"),
            "preheader": snapshot.get("preheader"),
            "from_name": snapshot.get("from_name"),
            "from_email": snapshot.get("from_email"),
            "reply_to": snapshot.get("reply_to"),
            "html_body": snapshot.get("html_body"),
            "text_body": snapshot.get("text_body"),
            "status": snapshot.get("status") or "active",
        }
        set_parts = ", ".join([f"{k} = ?" for k in updates.keys()])
        cursor.execute(
            f"UPDATE email_template_library SET {set_parts}, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            [*updates.values(), template_id],
        )
        if cursor.rowcount <= 0:
            return False
        snapshot = get_email_library_template(template_id) or {}
        _record_template_revision(cursor, template_id, snapshot, max_revisions=max_revisions)
        return True


def list_email_template_blocks(status: str = None) -> List[Dict]:
    with get_db() as conn:
        cursor = conn.cursor()
        if status in {"active", "archived"}:
            cursor.execute(
                "SELECT * FROM email_template_blocks WHERE status = ? ORDER BY updated_at DESC, id DESC",
                (status,),
            )
        else:
            cursor.execute("SELECT * FROM email_template_blocks ORDER BY updated_at DESC, id DESC")
        return [dict(row) for row in cursor.fetchall()]


def get_email_template_block(block_id: int) -> Optional[Dict]:
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM email_template_blocks WHERE id = ?", (block_id,))
        row = cursor.fetchone()
        return dict(row) if row else None


def create_email_template_block(name: str, html: str, category: str = None, text: str = None, status: str = "active") -> int:
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO email_template_blocks (name, category, html, text, status, updated_at)
            VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            """,
            (name, category, html, text, status or "active"),
        )
        return int(cursor.lastrowid)


def update_email_template_block(block_id: int, updates: Dict[str, Any]) -> bool:
    allowed = {"name", "category", "html", "text", "status"}
    set_parts: List[str] = []
    params: List[Any] = []
    for key, value in (updates or {}).items():
        if key in allowed:
            set_parts.append(f"{key} = ?")
            params.append(value)
    if not set_parts:
        return False
    set_parts.append("updated_at = CURRENT_TIMESTAMP")
    params.append(block_id)
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute(f"UPDATE email_template_blocks SET {', '.join(set_parts)} WHERE id = ?", params)
        return cursor.rowcount > 0


def delete_email_template_block(block_id: int) -> bool:
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM email_template_blocks WHERE id = ?", (block_id,))
        return cursor.rowcount > 0


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
                lc.domain,
                lc.salesforce_url
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


def get_contact_campaign_enrollments(contact_id: int) -> List[Dict]:
    """Get campaign enrollment rows for a contact."""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT
                cc.id,
                cc.campaign_id,
                cc.contact_id,
                cc.status,
                cc.current_step,
                cc.next_email_at,
                cc.enrolled_at,
                ec.name AS campaign_name
            FROM campaign_contacts cc
            JOIN email_campaigns ec ON ec.id = cc.campaign_id
            WHERE cc.contact_id = ?
            ORDER BY datetime(COALESCE(cc.enrolled_at, cc.next_email_at)) DESC, cc.id DESC
            """,
            (contact_id,),
        )
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
                lc.location,
                t.vertical,
                ec.name as campaign_name,
                ec.num_emails,
                ec.days_between_emails,
                ec.template_id,
                ec.template_mode
            FROM campaign_contacts cc
            JOIN linkedin_contacts lc ON cc.contact_id = lc.id
            JOIN email_campaigns ec ON cc.campaign_id = ec.id
            LEFT JOIN targets t ON TRIM(LOWER(lc.company_name)) = TRIM(LOWER(t.company_name))
            WHERE cc.status = 'active'
            AND cc.current_step < ec.num_emails
            AND cc.next_email_at <= datetime('now')
            AND ec.status = 'active'
            AND NOT EXISTS (
                SELECT 1
                FROM sent_emails se_pending
                WHERE se_pending.campaign_contact_id = cc.id
                  AND se_pending.step_number = (cc.current_step + 1)
                  AND lower(COALESCE(se_pending.review_status, '')) IN ('draft', 'ready_for_review', 'approved')
            )
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
    sf_email_url: str = None,
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
                subject, body, sf_lead_url, sf_email_url, status, review_status, sent_at, error_message, screenshot_path
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?, ?)
        """, (
            campaign_id, campaign_contact_id, contact_id, step_number,
            subject, body, sf_lead_url, sf_email_url, status, review_status, error_message, screenshot_path
        ))
        return cursor.lastrowid


def get_latest_sent_email_message_url(campaign_contact_id: int, step_lt: int = None) -> Optional[str]:
    """Get the most recent Salesforce EmailMessage URL for a campaign contact."""
    with get_db() as conn:
        cursor = conn.cursor()
        query = """
            SELECT sf_email_url
            FROM sent_emails
            WHERE campaign_contact_id = ?
              AND lower(COALESCE(review_status, '')) = 'sent'
              AND COALESCE(NULLIF(sf_email_url, ''), '') <> ''
        """
        params: List[Any] = [campaign_contact_id]
        if step_lt is not None:
            query += " AND COALESCE(step_number, 0) < ?"
            params.append(step_lt)
        query += " ORDER BY COALESCE(step_number, 0) DESC, id DESC LIMIT 1"
        cursor.execute(query, params)
        row = cursor.fetchone()
        return (row["sf_email_url"] or "").strip() if row and row["sf_email_url"] else None


def backfill_missing_sf_email_urls(campaign_contact_id: int, email_urls: List[str]) -> int:
    """
    Fill missing sf_email_url values for already-sent rows in newest-first order.
    Timeline links are expected newest-first and mapped to highest step/id first.
    """
    cleaned: List[str] = []
    seen = set()
    for raw in email_urls or []:
        url = (raw or "").strip()
        if not url or url in seen:
            continue
        seen.add(url)
        cleaned.append(url)
    if not cleaned:
        return 0

    updated = 0
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT id
            FROM sent_emails
            WHERE campaign_contact_id = ?
              AND lower(COALESCE(review_status, '')) = 'sent'
              AND COALESCE(NULLIF(sf_email_url, ''), '') = ''
            ORDER BY COALESCE(step_number, 0) DESC, id DESC
            """,
            (campaign_contact_id,),
        )
        rows = cursor.fetchall()
        for idx, row in enumerate(rows):
            if idx >= len(cleaned):
                break
            cursor.execute(
                "UPDATE sent_emails SET sf_email_url = ? WHERE id = ?",
                (cleaned[idx], int(row["id"])),
            )
            updated += int(cursor.rowcount or 0)
    return updated


def get_campaign_contacts_missing_sf_email_urls(campaign_id: int, limit: int = 500) -> List[Dict]:
    """List campaign contacts with sent rows missing sf_email_url."""
    bounded = max(1, min(int(limit or 500), 5000))
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT
                cc.id AS campaign_contact_id,
                cc.contact_id,
                lc.name AS contact_name,
                lc.company_name,
                COALESCE(NULLIF(cc.sf_lead_url, ''), NULLIF(lc.salesforce_url, '')) AS sf_lead_url,
                COUNT(*) AS missing_rows
            FROM sent_emails se
            JOIN campaign_contacts cc ON cc.id = se.campaign_contact_id
            JOIN linkedin_contacts lc ON lc.id = cc.contact_id
            WHERE se.campaign_id = ?
              AND lower(COALESCE(se.review_status, '')) = 'sent'
              AND COALESCE(NULLIF(se.sf_email_url, ''), '') = ''
            GROUP BY cc.id, cc.contact_id, lc.name, lc.company_name, COALESCE(NULLIF(cc.sf_lead_url, ''), NULLIF(lc.salesforce_url, ''))
            HAVING COALESCE(NULLIF(cc.sf_lead_url, ''), NULLIF(lc.salesforce_url, '')) IS NOT NULL
               AND COALESCE(NULLIF(cc.sf_lead_url, ''), NULLIF(lc.salesforce_url, '')) <> ''
            ORDER BY missing_rows DESC, cc.id DESC
            LIMIT ?
            """,
            (campaign_id, bounded),
        )
        return [dict(row) for row in cursor.fetchall()]


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


def get_outlook_poll_status() -> Dict[str, Any]:
    """Return the most recent Outlook poll summary persisted in system config."""
    cfg = get_all_config()

    def _as_int(key: str, default: int = 0) -> int:
        try:
            return int(cfg.get(key, str(default)) or default)
        except Exception:
            return default

    return {
        "last_polled_at": cfg.get("outlook_last_poll_at"),
        "success": str(cfg.get("outlook_last_poll_success", "0")).strip() in {"1", "true", "True"},
        "checked": _as_int("outlook_last_poll_checked"),
        "new_replies": _as_int("outlook_last_poll_new_replies"),
        "new_leads": _as_int("outlook_last_poll_new_leads"),
        "message": cfg.get("outlook_last_poll_message"),
        "error": cfg.get("outlook_last_poll_error"),
    }


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

def get_review_queue(limit: int | None = None) -> List[Dict]:
    """Get emails pending review (review_status = 'ready_for_review').
    Joins with linkedin_contacts and email_campaigns for display data."""
    with get_db() as conn:
        cursor = conn.cursor()
        query = """
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
        """
        params: list[object] = []
        if limit is not None:
            query += "\n            LIMIT ?"
            params.append(limit)
        cursor.execute(query, params)
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
            AND cc.status = 'active'
            AND ec.status = 'active'
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
            AND cc.status = 'active'
            AND ec.status = 'active'
        """
        params = []
        if campaign_id:
            query += " AND se.campaign_id = ?"
            params.append(campaign_id)
        
        query += " ORDER BY se.scheduled_send_time ASC LIMIT ?"
        params.append(limit)
        
        cursor.execute(query, params)
        return [dict(row) for row in cursor.fetchall()]


def reconcile_campaign_progress(campaign_id: int, limit: int = 2000) -> Dict[str, Any]:
    """
    Recompute campaign_contact progression from sent/reply history.
    This keeps multi-step campaign state aligned after imports/backfills.
    """
    scanned = 0
    updated = 0
    marked_replied = 0
    marked_completed = 0
    active_remaining = 0
    canceled_pending = 0

    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT cc.id, cc.current_step, cc.status, cc.next_email_at,
                   ec.num_emails, ec.days_between_emails
            FROM campaign_contacts cc
            JOIN email_campaigns ec ON ec.id = cc.campaign_id
            WHERE cc.campaign_id = ?
            ORDER BY cc.id ASC
            LIMIT ?
            """,
            (campaign_id, max(1, min(int(limit or 2000), 10000))),
        )
        contacts = cursor.fetchall()

        now = datetime.now()
        for row in contacts:
            scanned += 1
            campaign_contact_id = int(row["id"])
            num_emails = max(1, int(row["num_emails"] or 1))
            days_between = max(1, int(row["days_between_emails"] or 3))

            cursor.execute(
                """
                SELECT
                  MAX(CASE WHEN lower(COALESCE(review_status, '')) = 'sent' THEN COALESCE(step_number, 0) ELSE 0 END) as max_sent_step,
                  MAX(CASE WHEN lower(COALESCE(review_status, '')) = 'sent' THEN sent_at ELSE NULL END) as last_sent_at,
                  MAX(CASE WHEN COALESCE(replied, 0) = 1 THEN 1 ELSE 0 END) as has_reply
                FROM sent_emails
                WHERE campaign_contact_id = ?
                """,
                (campaign_contact_id,),
            )
            agg = cursor.fetchone()
            max_sent_step = int(agg["max_sent_step"] or 0)
            has_reply = int(agg["has_reply"] or 0) == 1
            last_sent_raw = agg["last_sent_at"]
            last_sent_dt = None
            if last_sent_raw:
                try:
                    last_sent_dt = datetime.fromisoformat(str(last_sent_raw).replace("Z", "+00:00")).replace(tzinfo=None)
                except Exception:
                    last_sent_dt = None

            next_step = min(max_sent_step, num_emails)
            if has_reply:
                next_status = "replied"
                next_email_at = None
                marked_replied += 1
            elif max_sent_step >= num_emails:
                next_status = "completed"
                next_email_at = None
                marked_completed += 1
            else:
                next_status = "active"
                active_remaining += 1
                if last_sent_dt is None:
                    next_email_at = now.isoformat(timespec="seconds")
                else:
                    target = last_sent_dt + timedelta(days=days_between)
                    next_email_at = max(now, target).isoformat(timespec="seconds")

            if next_status in {"replied", "completed"}:
                cursor.execute(
                    """
                    UPDATE sent_emails
                    SET review_status = 'rejected',
                        status = 'failed',
                        error_message = COALESCE(error_message, 'Auto-cancelled after campaign reconcile')
                    WHERE campaign_contact_id = ?
                      AND lower(COALESCE(review_status, '')) IN ('draft', 'ready_for_review', 'approved')
                    """,
                    (campaign_contact_id,),
                )
                canceled_pending += int(cursor.rowcount or 0)
            else:
                cursor.execute(
                    """
                    UPDATE sent_emails
                    SET review_status = 'rejected',
                        status = 'failed',
                        error_message = COALESCE(error_message, 'Auto-cancelled stale step after campaign reconcile')
                    WHERE campaign_contact_id = ?
                      AND lower(COALESCE(review_status, '')) IN ('draft', 'ready_for_review', 'approved')
                      AND COALESCE(step_number, 0) <= ?
                    """,
                    (campaign_contact_id, next_step),
                )
                canceled_pending += int(cursor.rowcount or 0)

            prev_step = int(row["current_step"] or 0)
            prev_status = str(row["status"] or "active")
            prev_next = str(row["next_email_at"] or "")
            next_next = str(next_email_at or "")
            if prev_step != next_step or prev_status != next_status or prev_next != next_next:
                update_parts = ["current_step = ?", "status = ?"]
                params: List[Any] = [next_step, next_status]
                if next_email_at is None:
                    update_parts.append("next_email_at = NULL")
                else:
                    update_parts.append("next_email_at = ?")
                    params.append(next_email_at)
                if next_status == "completed":
                    update_parts.append("completed_at = COALESCE(completed_at, CURRENT_TIMESTAMP)")
                params.append(campaign_contact_id)
                cursor.execute(
                    f"UPDATE campaign_contacts SET {', '.join(update_parts)} WHERE id = ?",
                    params,
                )
                updated += 1

    return {
        "success": True,
        "campaign_id": int(campaign_id),
        "scanned": int(scanned),
        "updated": int(updated),
        "marked_replied": int(marked_replied),
        "marked_completed": int(marked_completed),
        "active_remaining": int(active_remaining),
        "canceled_pending": int(canceled_pending),
    }


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


def mark_email_sent(sent_email_id: int, sf_lead_url: str = None, sf_email_url: str = None):
    """Called after successful Salesforce send. Sets review_status = 'sent', sent_at = now."""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            UPDATE sent_emails 
            SET review_status = 'sent', 
                status = 'sent',
                sent_at = CURRENT_TIMESTAMP,
                sf_lead_url = COALESCE(?, sf_lead_url),
                sf_email_url = COALESCE(?, sf_email_url)
            WHERE id = ?
        """, (sf_lead_url, sf_email_url, sent_email_id))


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

        # Stop remaining sequence sends if this contact replied.
        if replied:
            cursor.execute(
                """
                UPDATE campaign_contacts
                SET status = 'replied',
                    next_email_at = NULL
                WHERE id = (
                    SELECT campaign_contact_id
                    FROM sent_emails
                    WHERE id = ?
                )
                """,
                (sent_email_id,),
            )


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
            SET status = 'replied',
                next_email_at = NULL
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


def find_contact_for_inbound_lead(
    *,
    lead_email: str | None = None,
    name: str | None = None,
    company_name: str | None = None,
) -> Optional[int]:
    """Resolve an existing contact id for an inbound lead using email-first matching."""
    with get_db() as conn:
        cursor = conn.cursor()
        email = (lead_email or "").strip().lower()
        if email:
            cursor.execute(
                """
                SELECT id
                FROM linkedin_contacts
                WHERE lower(email_generated) = ?
                ORDER BY id DESC
                LIMIT 1
                """,
                (email,),
            )
            row = cursor.fetchone()
            if row:
                return int(row["id"])

        normalized_name = (name or "").strip().lower()
        normalized_company = (company_name or "").strip().lower()
        if normalized_name and normalized_company:
            cursor.execute(
                """
                SELECT id
                FROM linkedin_contacts
                WHERE lower(name) = ? AND lower(company_name) = ?
                ORDER BY id DESC
                LIMIT 1
                """,
                (normalized_name, normalized_company),
            )
            row = cursor.fetchone()
            if row:
                return int(row["id"])
    return None


def upsert_inbound_lead_contact(
    *,
    lead_name: str,
    lead_company: str | None = None,
    lead_email: str | None = None,
    lead_phone: str | None = None,
    lead_title: str | None = None,
    lead_location: str | None = None,
    lead_source: str | None = None,
    ingest_batch_id: str | None = None,
) -> tuple[int, bool]:
    """
    Create or update a contact from inbound lead data.
    Returns (contact_id, created_new).
    """
    company_name = (lead_company or "").strip() or "Inbound Leads"
    resolved_id = find_contact_for_inbound_lead(
        lead_email=lead_email,
        name=lead_name,
        company_name=company_name,
    )
    if resolved_id:
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                UPDATE linkedin_contacts
                SET
                    email_generated = COALESCE(NULLIF(email_generated, ''), ?),
                    phone = COALESCE(NULLIF(phone, ''), ?),
                    title = COALESCE(NULLIF(title, ''), ?),
                    location = COALESCE(NULLIF(location, ''), ?),
                    company_name = COALESCE(NULLIF(company_name, ''), ?),
                    lead_source = COALESCE(NULLIF(lead_source, ''), ?),
                    ingest_batch_id = COALESCE(NULLIF(ingest_batch_id, ''), ?),
                    salesforce_status = CASE
                        WHEN COALESCE(NULLIF(salesforce_status, ''), '') = '' THEN 'inbound mapped'
                        ELSE salesforce_status
                    END,
                    salesforce_sync_status = CASE
                        WHEN COALESCE(NULLIF(salesforce_sync_status, ''), '') = '' THEN 'queued'
                        ELSE salesforce_sync_status
                    END
                WHERE id = ?
                """,
                (
                    (lead_email or "").strip() or None,
                    (lead_phone or "").strip() or None,
                    (lead_title or "").strip() or None,
                    (lead_location or "").strip() or None,
                    company_name,
                    (lead_source or "").strip() or "website_form",
                    (ingest_batch_id or "").strip() or None,
                    resolved_id,
                ),
            )
        return resolved_id, False

    created_id = add_linkedin_contact(
        company_name=company_name,
        name=(lead_name or "").strip() or "Unknown Lead",
        title=(lead_title or "").strip() or None,
        location=(lead_location or "").strip() or None,
        email_generated=(lead_email or "").strip() or None,
        phone=(lead_phone or "").strip() or None,
        salesforce_status="inbound created",
        lead_source=(lead_source or "").strip() or "website_form",
        ingest_batch_id=(ingest_batch_id or "").strip() or None,
    )
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "UPDATE linkedin_contacts SET salesforce_sync_status = 'queued' WHERE id = ?",
            (created_id,),
        )
    return int(created_id), True


def insert_inbound_lead_event(
    *,
    outlook_message_id: str | None,
    source_sender: str | None,
    subject: str | None,
    body_preview: str | None,
    lead_name: str | None,
    lead_company: str | None,
    lead_email: str | None,
    lead_phone: str | None,
    lead_title: str | None,
    lead_industry: str | None,
    lead_location: str | None,
    contact_id: int | None,
    received_at: str | None,
    status: str = "created",
    error: str | None = None,
) -> tuple[int, bool]:
    """Insert inbound lead event if new. Returns (event_id, inserted_new)."""
    normalized_msg_id = (outlook_message_id or "").strip() or None
    normalized_status = (status or "").strip() or "created"
    with get_db() as conn:
        cursor = conn.cursor()
        if normalized_msg_id:
            cursor.execute(
                """
                SELECT id, status FROM inbound_lead_events WHERE outlook_message_id = ?
                """,
                (normalized_msg_id,),
            )
            row = cursor.fetchone()
            if row:
                existing_id = int(row["id"])
                existing_status = (row["status"] or "").strip().lower()
                # Allow parser backfills to upgrade previously failed rows.
                if existing_status == "parse_failed" and (
                    (lead_name or "").strip() or (lead_email or "").strip()
                ):
                    cursor.execute(
                        """
                        UPDATE inbound_lead_events
                        SET
                            source_sender = COALESCE(NULLIF(source_sender, ''), ?),
                            subject = COALESCE(NULLIF(subject, ''), ?),
                            body_preview = COALESCE(NULLIF(body_preview, ''), ?),
                            lead_name = COALESCE(NULLIF(lead_name, ''), ?),
                            lead_company = COALESCE(NULLIF(lead_company, ''), ?),
                            lead_email = COALESCE(NULLIF(lead_email, ''), ?),
                            lead_phone = COALESCE(NULLIF(lead_phone, ''), ?),
                            lead_title = COALESCE(NULLIF(lead_title, ''), ?),
                            lead_industry = COALESCE(NULLIF(lead_industry, ''), ?),
                            lead_location = COALESCE(NULLIF(lead_location, ''), ?),
                            contact_id = COALESCE(contact_id, ?),
                            received_at = COALESCE(received_at, ?),
                            status = ?,
                            error = NULL
                        WHERE id = ?
                        """,
                        (
                            (source_sender or "").strip() or None,
                            (subject or "").strip() or None,
                            (body_preview or "").strip() or None,
                            (lead_name or "").strip() or None,
                            (lead_company or "").strip() or None,
                            (lead_email or "").strip() or None,
                            (lead_phone or "").strip() or None,
                            (lead_title or "").strip() or None,
                            (lead_industry or "").strip() or None,
                            (lead_location or "").strip() or None,
                            contact_id,
                            received_at,
                            normalized_status,
                            existing_id,
                        ),
                    )
                return int(row["id"]), False

        cursor.execute(
            """
            INSERT INTO inbound_lead_events (
                outlook_message_id, source_sender, subject, body_preview,
                lead_name, lead_company, lead_email, lead_phone, lead_title, lead_industry, lead_location,
                contact_id, received_at, status, error
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                normalized_msg_id,
                (source_sender or "").strip() or None,
                (subject or "").strip() or None,
                (body_preview or "").strip() or None,
                (lead_name or "").strip() or None,
                (lead_company or "").strip() or None,
                (lead_email or "").strip() or None,
                (lead_phone or "").strip() or None,
                (lead_title or "").strip() or None,
                (lead_industry or "").strip() or None,
                (lead_location or "").strip() or None,
                contact_id,
                received_at,
                normalized_status,
                (error or "").strip() or None,
            ),
        )
        return int(cursor.lastrowid), True


def update_inbound_lead_event_details(
    *,
    event_id: int,
    lead_name: str | None = None,
    lead_company: str | None = None,
    lead_email: str | None = None,
    lead_phone: str | None = None,
    lead_title: str | None = None,
    lead_industry: str | None = None,
    lead_location: str | None = None,
    body_preview: str | None = None,
    contact_id: int | None = None,
    status: str | None = None,
    error: str | None = None,
) -> bool:
    """Patch missing inbound lead event fields while preserving existing non-empty values."""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            UPDATE inbound_lead_events
            SET
                lead_name = COALESCE(NULLIF(lead_name, ''), ?),
                lead_company = COALESCE(NULLIF(lead_company, ''), ?),
                lead_email = COALESCE(NULLIF(lead_email, ''), ?),
                lead_phone = COALESCE(NULLIF(lead_phone, ''), ?),
                lead_title = COALESCE(NULLIF(lead_title, ''), ?),
                lead_industry = COALESCE(NULLIF(lead_industry, ''), ?),
                lead_location = COALESCE(NULLIF(lead_location, ''), ?),
                body_preview = COALESCE(NULLIF(body_preview, ''), ?),
                contact_id = COALESCE(contact_id, ?),
                status = COALESCE(NULLIF(?, ''), status),
                error = CASE
                    WHEN ? IS NULL OR ? = '' THEN error
                    ELSE ?
                END
            WHERE id = ?
            """,
            (
                (lead_name or "").strip() or None,
                (lead_company or "").strip() or None,
                (lead_email or "").strip() or None,
                (lead_phone or "").strip() or None,
                (lead_title or "").strip() or None,
                (lead_industry or "").strip() or None,
                (lead_location or "").strip() or None,
                (body_preview or "").strip() or None,
                contact_id,
                (status or "").strip() or None,
                (error or "").strip() or None,
                (error or "").strip() or None,
                (error or "").strip() or None,
                int(event_id),
            ),
        )
        return int(cursor.rowcount or 0) > 0


def get_unseen_inbound_lead_count() -> int:
    """Count inbound lead events not yet acknowledged in the UI."""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT COUNT(*) AS c FROM inbound_lead_events WHERE COALESCE(seen, 0) = 0")
        row = cursor.fetchone()
        return int(row["c"] if row and row["c"] is not None else 0)


def mark_inbound_leads_seen() -> int:
    """Mark all unseen inbound lead events as seen. Returns affected rows."""
    now_iso = datetime.utcnow().isoformat()
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            UPDATE inbound_lead_events
            SET seen = 1,
                seen_at = COALESCE(seen_at, ?)
            WHERE COALESCE(seen, 0) = 0
            """,
            (now_iso,),
        )
        return int(cursor.rowcount or 0)


def get_recent_inbound_leads(limit: int = 20) -> List[Dict]:
    """Fetch recent inbound lead ingestion events for UI display."""
    bounded_limit = max(1, min(int(limit or 20), 200))
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT
                ile.id,
                ile.outlook_message_id,
                ile.source_sender,
                ile.subject,
                ile.body_preview,
                ile.lead_name,
                ile.lead_company,
                ile.lead_email,
                ile.lead_phone,
                ile.lead_title,
                ile.lead_industry,
                ile.lead_location,
                ile.contact_id,
                ile.status,
                ile.error,
                ile.received_at,
                ile.detected_at,
                ile.seen,
                ile.seen_at,
                lc.name AS contact_name
            FROM inbound_lead_events ile
            LEFT JOIN linkedin_contacts lc ON lc.id = ile.contact_id
            ORDER BY datetime(COALESCE(ile.received_at, ile.detected_at)) DESC, ile.id DESC
            LIMIT ?
            """,
            (bounded_limit,),
        )
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
                COALESCE(NULLIF(se.rendered_subject, ''), NULLIF(se.subject, '')) as subject,
                COALESCE(NULLIF(se.rendered_body, ''), NULLIF(se.body, '')) as body,
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


def _coerce_int(value: Any, default: int, minimum: int, maximum: int) -> int:
    try:
        parsed = int(value)
    except Exception:
        return default
    return max(minimum, min(maximum, parsed))


def _coerce_float(value: Any, default: float, minimum: float, maximum: float) -> float:
    try:
        parsed = float(value)
    except Exception:
        return default
    return max(minimum, min(maximum, parsed))


def _coerce_bool(value: Any, default: bool = False) -> bool:
    if isinstance(value, bool):
        return value
    if value is None:
        return default
    lowered = str(value).strip().lower()
    if lowered in {"1", "true", "yes", "y", "on"}:
        return True
    if lowered in {"0", "false", "no", "n", "off"}:
        return False
    return default


def _estimate_token_count(text: str) -> int:
    if not text:
        return 0
    # Approximation tuned for retrieval budgeting.
    return max(1, int(round(len(text.split()) * 1.3)))


def _to_int_set(value: Any) -> set[int]:
    if value is None:
        return set()
    if isinstance(value, (list, tuple, set)):
        out: set[int] = set()
        for part in value:
            try:
                out.add(int(part))
            except Exception:
                continue
        return out
    try:
        return {int(value)}
    except Exception:
        return set()


def _to_str_set(value: Any) -> set[str]:
    if value is None:
        return set()
    if isinstance(value, (list, tuple, set)):
        return {str(part).strip() for part in value if str(part).strip()}
    text = str(value).strip()
    return {text} if text else set()


def _build_file_chunk_allowlist(filters: Dict[str, Any]) -> Optional[set[str]]:
    document_ids = _to_str_set(filters.get("document_ids"))
    company_ids = _to_int_set(filters.get("company_id"))
    if not company_ids:
        company_ids = _to_int_set(filters.get("company_ids"))
    contact_ids = _to_int_set(filters.get("contact_id"))
    if not contact_ids:
        contact_ids = _to_int_set(filters.get("contact_ids"))
    document_type = str(filters.get("document_type") or "").strip().lower()
    status = str(filters.get("document_status") or "").strip().lower()

    has_filter = bool(document_ids or company_ids or contact_ids or document_type or status)
    if not has_filter:
        return None

    where: List[str] = ["1=1"]
    params: List[Any] = []
    if document_ids:
        placeholders = ",".join(["?"] * len(document_ids))
        where.append(f"d.id IN ({placeholders})")
        params.extend(sorted(document_ids))
    if company_ids:
        placeholders = ",".join(["?"] * len(company_ids))
        where.append(f"d.linked_company_id IN ({placeholders})")
        params.extend(sorted(company_ids))
    if document_type:
        where.append("LOWER(COALESCE(d.document_type,'')) = ?")
        params.append(document_type)
    if status:
        where.append("LOWER(COALESCE(d.status,'')) = ?")
        params.append(status)
    if contact_ids:
        placeholders = ",".join(["?"] * len(contact_ids))
        where.append(
            f"EXISTS (SELECT 1 FROM document_contacts dc WHERE dc.document_id = d.id AND dc.contact_id IN ({placeholders}))"
        )
        params.extend(sorted(contact_ids))

    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute(
            f"""
            SELECT d.id
            FROM documents d
            WHERE {' AND '.join(where)}
            """,
            params,
        )
        return {str(row["id"]) for row in cursor.fetchall()}


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

    # Compute and store embedding (non-blocking, best-effort).
    try:
        from services.search.embeddings import embed_text, embedding_to_blob, EMBEDDING_MODEL
        embedding = embed_text(text.strip())
        if embedding:
            blob = embedding_to_blob(embedding)
            with get_db() as conn2:
                conn2.cursor().execute(
                    """
                    INSERT INTO semantic_embeddings
                        (chunk_id, source_type, source_id, embedding, model, dimensions, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(chunk_id) DO UPDATE SET
                        embedding=excluded.embedding,
                        model=excluded.model,
                        dimensions=excluded.dimensions,
                        created_at=excluded.created_at
                    """,
                    (
                        final_chunk_id,
                        normalized_source_type,
                        normalized_source_id,
                        blob,
                        EMBEDDING_MODEL,
                        len(embedding),
                        now,
                    ),
                )
    except Exception:
        pass  # Embedding is best-effort — never block the chunk upsert.

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
                """SELECT lc.id, lc.name, lc.company_name, lc.title,
                          lc.email_generated, lc.phone, lc.domain,
                          t.vertical
                   FROM linkedin_contacts lc
                   LEFT JOIN targets t ON TRIM(LOWER(lc.company_name)) = TRIM(LOWER(t.company_name))
                   WHERE lc.id = ?""",
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
                    keywords=" ".join([
                        row["company_name"] or "",
                        row["title"] or "",
                        row["vertical"] or "",
                    ]).strip(),
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
                SELECT lc.id, lc.name, lc.company_name, lc.title,
                       lc.email_generated, lc.phone, lc.domain,
                       t.vertical
                FROM linkedin_contacts lc
                LEFT JOIN targets t ON TRIM(LOWER(lc.company_name)) = TRIM(LOWER(t.company_name))
                """
            )
            for row in cursor.fetchall():
                keywords = " ".join(
                    [
                        row["name"] or "",
                        row["company_name"] or "",
                        row["title"] or "",
                        row["vertical"] or "",
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

def _ensure_entity_search_index_fresh(entity_types: Optional[List[str]] = None):
    return _ensure_entity_search_index_fresh_with_stats(entity_types)


def _ensure_entity_search_index_fresh_with_stats(entity_types: Optional[List[str]] = None) -> Dict[str, Any]:
    wanted = set(entity_types or ["contact", "company", "campaign", "email_message", "conversation"])
    mode = (getattr(config, "ENTITY_SEARCH_REFRESH_MODE", "missing") or "missing").strip().lower()
    if mode not in {"missing", "stale", "off"}:
        mode = "missing"

    if not wanted or mode == "off":
        return {
            "refreshed": False,
            "stale_types": [],
            "refreshed_types": [],
            "refresh_ms": 0,
            "mode": mode,
        }

    refresh_types: List[str] = []
    if mode == "stale":
        now = time.time()
        refresh_types = sorted(
            [
                entity_type
                for entity_type in wanted
                if (now - _ENTITY_SEARCH_LAST_REFRESH.get(entity_type, 0.0)) >= _ENTITY_SEARCH_REFRESH_TTL_SECONDS
            ]
        )
    else:
        with get_db() as conn:
            cursor = conn.cursor()
            placeholders = ",".join(["?"] * len(wanted))
            cursor.execute(
                f"""
                SELECT DISTINCT entity_type
                FROM entity_search_index
                WHERE entity_type IN ({placeholders})
                """,
                [*wanted],
            )
            present = {str(row["entity_type"]) for row in cursor.fetchall()}
        refresh_types = sorted([entity_type for entity_type in wanted if entity_type not in present])

    if not refresh_types:
        return {
            "refreshed": False,
            "stale_types": [],
            "refreshed_types": [],
            "refresh_ms": 0,
            "mode": mode,
        }

    refresh_started = time.perf_counter()
    refresh_entity_search_index(refresh_types)
    refresh_ms = int(round((time.perf_counter() - refresh_started) * 1000))
    refreshed_at = time.time()
    for entity_type in refresh_types:
        _ENTITY_SEARCH_LAST_REFRESH[entity_type] = refreshed_at
    return {
        "refreshed": True,
        "stale_types": sorted(refresh_types),
        "refreshed_types": sorted(refresh_types),
        "refresh_ms": refresh_ms,
        "mode": mode,
    }


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
        top_k_vector_candidates = _coerce_int(filters.get("top_k_vector_candidates"), 500, 50, 2000)
        min_vector_similarity = _coerce_float(filters.get("min_vector_similarity"), 0.2, 0.0, 1.0)
        allowed_file_ids = filters.get("__file_chunk_allowlist")
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
                LIMIT ?
                """,
                [*params, top_k_vector_candidates],
            )
            for row in cursor.fetchall():
                if row["source_type"] == "file_chunk" and allowed_file_ids is not None:
                    if str(row["source_id"]) not in allowed_file_ids:
                        continue
                text = row["text"] or ""
                text_tokens = set(_tokenize(text))
                overlap = len(query_tokens.intersection(text_tokens))
                if overlap <= 0:
                    continue
                vec_score = min(1.0, overlap / max(len(query_tokens), 1))
                if vec_score < min_vector_similarity:
                    continue
                metadata = _json_loads_safe(row["metadata"], {})
                page_number = metadata.get("page_number")
                token_count = metadata.get("token_count")
                title = metadata.get("title") or f"{row['source_type']} {row['source_id']}"
                out.append(
                    _build_result(
                        row["source_type"],
                        row["source_id"],
                        title,
                        text[:1200],
                        timestamp=row["updated_at"] or row["created_at"],
                        source_refs=[
                            {
                                "chunk_id": row["chunk_id"],
                                "source_id": row["source_id"],
                                "source_type": row["source_type"],
                                "chunk_type": row["chunk_type"],
                                "page_number": page_number,
                                "token_count": token_count if isinstance(token_count, int) else _estimate_token_count(text),
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
        try:
            from services.search.embeddings import (
                embed_text,
                blob_to_embedding,
                cosine_similarity,
            )
        except ImportError:
            return []

        try:
            with get_db() as conn:
                cursor = conn.cursor()
                if not self._has_sqlite_vec_tables(cursor):
                    return []
        except Exception:
            return []

        # Compute query embedding
        query_embedding = embed_text(query)
        if not query_embedding:
            return []

        # Fetch candidate embeddings from the database
        out: List[Dict[str, Any]] = []
        top_k_vector_candidates = _coerce_int(filters.get("top_k_vector_candidates"), 500, 50, 3000)
        min_vector_similarity = _coerce_float(filters.get("min_vector_similarity"), 0.3, 0.0, 1.0)
        allowed_file_ids = filters.get("__file_chunk_allowlist")
        try:
            with get_db() as conn:
                cursor = conn.cursor()
                placeholders = ",".join(["?"] * len(entity_types)) if entity_types else "?"
                time_range = (filters.get("time_range") or "").strip().lower()
                where = [f"se.source_type IN ({placeholders})"]
                params: List[Any] = [*entity_types]
                if time_range in {"last 7 days", "last_7_days"}:
                    where.append("sc.created_at >= datetime('now', '-7 days')")
                elif time_range in {"last 30 days", "last_30_days"}:
                    where.append("sc.created_at >= datetime('now', '-30 days')")

                cursor.execute(
                    f"""
                    SELECT se.chunk_id, se.source_type, se.source_id, se.embedding,
                           sc.text, sc.chunk_type, sc.created_at, sc.updated_at, sc.metadata
                    FROM semantic_embeddings se
                    JOIN semantic_chunks sc ON se.chunk_id = sc.chunk_id
                    WHERE {' AND '.join(where)}
                    LIMIT ?
                    """,
                    [*params, top_k_vector_candidates],
                )

                for row in cursor.fetchall():
                    if row["source_type"] == "file_chunk" and allowed_file_ids is not None:
                        if str(row["source_id"]) not in allowed_file_ids:
                            continue
                    try:
                        stored_embedding = blob_to_embedding(row["embedding"])
                    except Exception:
                        continue

                    sim = cosine_similarity(query_embedding, stored_embedding)
                    if sim < min_vector_similarity:
                        continue

                    metadata = _json_loads_safe(row["metadata"], {})
                    page_number = metadata.get("page_number")
                    token_count = metadata.get("token_count")
                    title = metadata.get("title") or f"{row['source_type']} {row['source_id']}"
                    text = row["text"] or ""
                    out.append(
                        _build_result(
                            row["source_type"],
                            row["source_id"],
                            title,
                            text[:1200],
                            timestamp=row["updated_at"] or row["created_at"],
                            source_refs=[
                                {
                                    "chunk_id": row["chunk_id"],
                                    "source_id": row["source_id"],
                                    "source_type": row["source_type"],
                                    "chunk_type": row["chunk_type"],
                                    "page_number": page_number,
                                    "token_count": token_count if isinstance(token_count, int) else _estimate_token_count(text),
                                }
                            ],
                            score_vec=sim,
                        )
                    )

                # Sort by similarity descending
                out.sort(key=lambda x: x.get("score_vec", 0), reverse=True)
        except Exception:
            return []

        return out


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
            matched_contact_ids: set[str] = set()
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
                row_id = str(row["id"])
                matched_contact_ids.add(row_id)
                out.append(
                    _build_result(
                        "contact",
                        row_id,
                        f"{row['name'] or 'Unknown'} @ {row['company_name'] or 'Unknown company'}",
                        f"email={row['email_generated'] or 'n/a'}, phone={row['phone'] or 'n/a'}",
                        timestamp=row["scraped_at"],
                        source_refs=[{"row_id": row["id"], "table": "linkedin_contacts"}],
                        score_exact=1.0,
                    )
                )

            # Fallback for first-name/partial-name queries when exact contact resolution misses.
            if not matched_contact_ids and len(q) >= 3 and not q.isdigit():
                cursor.execute(
                    """
                    SELECT id, name, company_name, email_generated, phone, scraped_at
                    FROM linkedin_contacts
                    WHERE LOWER(name) LIKE LOWER(?)
                    LIMIT ?
                    """,
                    (f"%{q}%", max_rows),
                )
                for row in cursor.fetchall():
                    row_id = str(row["id"])
                    if row_id in matched_contact_ids:
                        continue
                    matched_contact_ids.add(row_id)
                    out.append(
                        _build_result(
                            "contact",
                            row_id,
                            f"{row['name'] or 'Unknown'} @ {row['company_name'] or 'Unknown company'}",
                            f"email={row['email_generated'] or 'n/a'}, phone={row['phone'] or 'n/a'}",
                            timestamp=row["scraped_at"],
                            source_refs=[{"row_id": row["id"], "table": "linkedin_contacts"}],
                            score_exact=0.8,
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
    debug_timing: Optional[Dict[str, Any]] = None,
) -> List[Dict[str, Any]]:
    """
    Hybrid retrieval: exact + lexical + semantic-like chunk overlap.
    Vector stage currently uses token-overlap fallback until dedicated vector index is added.
    """
    q = (query or "").strip()
    if not q:
        return []
    total_started = time.perf_counter()
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
    working_filters = dict(filters)
    file_chunk_allowlist = _build_file_chunk_allowlist(working_filters)
    working_filters["__file_chunk_allowlist"] = file_chunk_allowlist
    top_k_exact = _coerce_int(working_filters.get("top_k_exact"), 10, 1, 100)
    top_k_lexical = _coerce_int(working_filters.get("top_k_lexical"), 200, 10, 1200)
    per_doc_cap = _coerce_int(working_filters.get("per_doc_cap"), 3, 1, 20)
    max_evidence_tokens = _coerce_int(working_filters.get("max_evidence_tokens"), 2800, 200, 20000)
    rerank_enabled = _coerce_bool(working_filters.get("rerank"), True)
    rerank_top_n = _coerce_int(working_filters.get("rerank_top_n"), max(limit * 4, 20), 5, 200)

    # Keep index warm for exact/lex retrieval without full rebuild on every request.
    index_refresh = _ensure_entity_search_index_fresh_with_stats(
        [t for t in allowed_types if t in {"contact", "company", "campaign", "email_message", "conversation"}]
    )

    results_by_key: Dict[str, Dict[str, Any]] = {}
    q_norm = _normalize_text(q)
    q_tokens = set(_tokenize(q_norm))
    low_signal_tokens = {
        "who",
        "what",
        "where",
        "when",
        "why",
        "how",
        "is",
        "are",
        "was",
        "were",
        "did",
        "do",
        "does",
        "we",
        "i",
        "you",
        "me",
        "my",
        "our",
        "about",
        "thread",
        "previously",
    }
    lexical_tokens = [token for token in q_tokens if len(token) >= 2 and token not in low_signal_tokens]
    if not lexical_tokens:
        lexical_tokens = [token for token in q_tokens if len(token) >= 2]

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

    exact_started = time.perf_counter()
    # A) Exact / deterministic stage.
    for item in resolve_entity(q, list(allowed_types), limit=top_k_exact):
        _upsert(item)
    exact_ms = int(round((time.perf_counter() - exact_started) * 1000))

    # B) Lexical stage via entity_search_index.
    lexical_started = time.perf_counter()
    with get_db() as conn:
        cursor = conn.cursor()
        placeholders = ",".join(["?"] * len(allowed_types)) if allowed_types else "?"
        full_like = f"%{q_norm}%"
        token_clauses: List[str] = []
        token_params: List[Any] = []
        for token in lexical_tokens[:6]:
            like = f"%{token}%"
            token_clauses.append(
                "("
                "LOWER(COALESCE(name, '')) LIKE ? OR "
                "LOWER(COALESCE(emails, '')) LIKE ? OR "
                "LOWER(COALESCE(phones, '')) LIKE ? OR "
                "LOWER(COALESCE(domain, '')) LIKE ? OR "
                "LOWER(COALESCE(keywords, '')) LIKE ?"
                ")"
            )
            token_params.extend([like, like, like, like, like])
        lexical_where = (
            f"({' OR '.join(token_clauses)})"
            if token_clauses
            else "("
            "LOWER(COALESCE(name, '')) LIKE ? OR "
            "LOWER(COALESCE(emails, '')) LIKE ? OR "
            "LOWER(COALESCE(phones, '')) LIKE ? OR "
            "LOWER(COALESCE(domain, '')) LIKE ? OR "
            "LOWER(COALESCE(keywords, '')) LIKE ?"
            ")"
        )
        lexical_params = token_params if token_params else [full_like, full_like, full_like, full_like, full_like]
        cursor.execute(
            f"""
            SELECT entity_type, entity_id, name, emails, phones, domain, keywords, updated_at
            FROM entity_search_index
            WHERE entity_type IN ({placeholders})
              AND {lexical_where}
            ORDER BY updated_at DESC
            LIMIT ?
            """,
            [*allowed_types, *lexical_params, top_k_lexical],
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
    lexical_ms = int(round((time.perf_counter() - lexical_started) * 1000))

    # C) Semantic/vector stage via backend adapter (sqlite-vec optional).
    vector_started = time.perf_counter()
    vector_backend = _resolve_vector_backend()
    vector_results = vector_backend.search(q, q_tokens, allowed_types, working_filters)
    vector_fallback_used = False
    if not vector_results and vector_backend.name != "token_overlap":
        vector_results = TokenOverlapVectorBackend().search(q, q_tokens, allowed_types, working_filters)
        vector_fallback_used = True
    for item in vector_results:
        _upsert(item)
    vector_ms = int(round((time.perf_counter() - vector_started) * 1000))

    rank_started = time.perf_counter()
    ranked_initial = sorted(
        results_by_key.values(),
        key=lambda x: (x["score_total"], x["score_exact"], x["score_lex"], x["score_vec"]),
        reverse=True,
    )
    ranked = ranked_initial
    if rerank_enabled:
        rerank_slice = ranked_initial[:rerank_top_n]
        reranked_slice = []
        query_phrase = q_norm
        for item in rerank_slice:
            text = f"{item.get('title', '')} {item.get('snippet', '')}".lower()
            text_tokens = set(_tokenize(text))
            overlap = len(q_tokens.intersection(text_tokens))
            coverage = overlap / max(len(q_tokens), 1)
            phrase_bonus = 0.15 if query_phrase and query_phrase in text else 0.0
            semantic_bonus = min(0.2, float(item.get("score_vec", 0.0)) * 0.2)
            rerank_score = float(item.get("score_total", 0.0)) + (coverage * 35.0) + (phrase_bonus * 100.0) + (
                semantic_bonus * 100.0
            )
            enriched = dict(item)
            enriched["score_rerank"] = round(rerank_score, 5)
            reranked_slice.append(enriched)
        reranked_slice.sort(
            key=lambda x: (x.get("score_rerank", x.get("score_total", 0.0)), x.get("score_total", 0.0)),
            reverse=True,
        )
        ranked = reranked_slice + ranked_initial[rerank_top_n:]

    # Retrieval budgets to prevent context bloat, mainly for file_chunk evidence.
    doc_counts: Dict[str, int] = {}
    evidence_tokens = 0
    budgeted: List[Dict[str, Any]] = []
    for item in ranked:
        if item.get("entity_type") == "file_chunk":
            source_id = str(item.get("entity_id") or "")
            per_doc_used = doc_counts.get(source_id, 0)
            if per_doc_used >= per_doc_cap:
                continue
            refs = item.get("source_refs") or []
            if refs and isinstance(refs, list) and isinstance(refs[0], dict):
                token_count = refs[0].get("token_count")
            else:
                token_count = None
            if not isinstance(token_count, int):
                token_count = _estimate_token_count(str(item.get("snippet") or ""))
            if evidence_tokens + token_count > max_evidence_tokens and budgeted:
                continue
            evidence_tokens += token_count
            doc_counts[source_id] = per_doc_used + 1
        budgeted.append(item)
    out = budgeted[:limit]
    rank_ms = int(round((time.perf_counter() - rank_started) * 1000))

    if debug_timing is not None:
        debug_timing.update(
            {
                "total_ms": int(round((time.perf_counter() - total_started) * 1000)),
                "index_refresh_ms": int(index_refresh.get("refresh_ms", 0)),
                "index_refreshed": bool(index_refresh.get("refreshed", False)),
                "index_refresh_types": index_refresh.get("stale_types", []),
                "index_refresh_mode": index_refresh.get("mode", "missing"),
                "exact_ms": exact_ms,
                "lexical_ms": lexical_ms,
                "vector_ms": vector_ms,
                "rank_ms": rank_ms,
                "result_count": len(out),
                "vector_backend": vector_backend.name,
                "vector_fallback_used": vector_fallback_used,
                "rerank_enabled": rerank_enabled,
                "rerank_top_n": rerank_top_n,
                "per_doc_cap": per_doc_cap,
                "max_evidence_tokens": max_evidence_tokens,
                "evidence_tokens_used": evidence_tokens,
                "file_chunk_allowlist_size": None if file_chunk_allowlist is None else len(file_chunk_allowlist),
            }
        )
    return out


# ---------------------------------------------------------------------------
# Entity notes
# ---------------------------------------------------------------------------

def create_entity_note(*, entity_type: str, entity_id: str, content: str) -> Dict:
    """Create a note attached to an entity."""
    entity_type = str(entity_type or "").strip().lower()
    entity_id = str(entity_id or "").strip()
    content = str(content or "").strip()
    if not entity_type:
        raise ValueError("entity_type is required")
    if not entity_id:
        raise ValueError("entity_id is required")
    if not content:
        raise ValueError("content is required")

    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "INSERT INTO entity_notes (entity_type, entity_id, content) VALUES (?, ?, ?)",
            (entity_type, entity_id, content),
        )
        note_id = cursor.lastrowid
        cursor.execute("SELECT * FROM entity_notes WHERE id = ?", (note_id,))
        row = cursor.fetchone()
        return dict(row) if row else {"id": note_id, "entity_type": entity_type, "entity_id": entity_id, "content": content}


def list_entity_notes(*, entity_type: str, entity_id: str, limit: int = 50) -> List[Dict]:
    """List notes attached to an entity (newest first)."""
    entity_type = str(entity_type or "").strip().lower()
    entity_id = str(entity_id or "").strip()
    if not entity_type or not entity_id:
        return []
    limit = max(1, min(int(limit), 200))

    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT * FROM entity_notes WHERE entity_type = ? AND entity_id = ? ORDER BY created_at DESC, id DESC LIMIT ?",
            (entity_type, entity_id, limit),
        )
        rows = cursor.fetchall() or []
        return [dict(r) for r in rows]


# Initialize database when module is imported
init_database()
