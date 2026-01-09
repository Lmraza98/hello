"""
FastAPI backend for LinkedIn Scraper UI.
Provides REST endpoints for the React frontend.
"""
from fastapi import FastAPI, HTTPException, UploadFile, File, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime
import asyncio
import csv
import io
import sqlite3

import database as db
import config

app = FastAPI(title="LinkedIn Scraper API", version="1.0.0")

# CORS for React dev server
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:5174", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize database tables
db.init_database()

# Initialize LinkedIn contacts table
def init_linkedin_table():
    """Initialize LinkedIn contacts table."""
    with db.get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS linkedin_contacts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                domain TEXT,
                company_name TEXT,
                name TEXT NOT NULL,
                title TEXT,
                linkedin_url TEXT,
                email_generated TEXT,
                email_pattern TEXT,
                email_confidence INTEGER DEFAULT 0,
                email_verified INTEGER DEFAULT 0,
                scraped_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(domain, name)
            )
        """)
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_linkedin_domain ON linkedin_contacts(domain)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_linkedin_company ON linkedin_contacts(company_name)")

init_linkedin_table()

# ============== Models ==============

class Company(BaseModel):
    id: Optional[int] = None
    company_name: str
    domain: Optional[str] = None
    tier: Optional[str] = None
    vertical: Optional[str] = None
    target_reason: Optional[str] = None
    wedge: Optional[str] = None

class Contact(BaseModel):
    id: Optional[int] = None
    company_name: str
    domain: Optional[str] = None
    name: str
    title: Optional[str] = None
    email: Optional[str] = None
    email_pattern: Optional[str] = None
    linkedin_url: Optional[str] = None
    scraped_at: Optional[str] = None

class Stats(BaseModel):
    total_companies: int
    total_contacts: int
    contacts_with_email: int
    contacts_today: int

class ScrapeRequest(BaseModel):
    tier: Optional[str] = None
    max_contacts: int = 25
    workers: int = 3

# ============== Background task state ==============
scrape_status = {
    "running": False,
    "progress": 0,
    "total": 0,
    "current_company": None,
    "results": {"success": 0, "failed": 0, "contacts": 0}
}

# ============== Endpoints ==============

@app.get("/api/stats", response_model=Stats)
def get_stats():
    """Get dashboard statistics."""
    with db.get_db() as conn:
        cursor = conn.cursor()
        
        # Count companies
        try:
            cursor.execute("SELECT COUNT(*) FROM targets WHERE company_name IS NOT NULL")
            total_companies = cursor.fetchone()[0]
        except sqlite3.OperationalError:
            total_companies = 0
        
        # Count contacts
        try:
            cursor.execute("SELECT COUNT(*) FROM linkedin_contacts")
            total_contacts = cursor.fetchone()[0]
        except sqlite3.OperationalError:
            total_contacts = 0
        
        # Count contacts with email (use email_generated column)
        try:
            cursor.execute("SELECT COUNT(*) FROM linkedin_contacts WHERE email_generated IS NOT NULL AND email_generated != ''")
            contacts_with_email = cursor.fetchone()[0]
        except sqlite3.OperationalError:
            contacts_with_email = 0
        
        # Count today's contacts
        try:
            today = datetime.now().strftime('%Y-%m-%d')
            cursor.execute(f"SELECT COUNT(*) FROM linkedin_contacts WHERE DATE(scraped_at) = '{today}'")
            contacts_today = cursor.fetchone()[0]
        except sqlite3.OperationalError:
            contacts_today = 0
        
    return Stats(
        total_companies=total_companies,
        total_contacts=total_contacts,
        contacts_with_email=contacts_with_email,
        contacts_today=contacts_today
    )


@app.get("/api/companies", response_model=List[Company])
def get_companies(tier: Optional[str] = None):
    """Get all target companies."""
    with db.get_db() as conn:
        cursor = conn.cursor()
        
        try:
            if tier:
                cursor.execute("""
                    SELECT id, company_name, domain, tier, vertical, target_reason, wedge 
                    FROM targets 
                    WHERE company_name IS NOT NULL AND tier = ?
                    ORDER BY tier, company_name
                """, (tier,))
            else:
                cursor.execute("""
                    SELECT id, company_name, domain, tier, vertical, target_reason, wedge 
                    FROM targets 
                    WHERE company_name IS NOT NULL
                    ORDER BY tier, company_name
                """)
            
            rows = cursor.fetchall()
        except sqlite3.OperationalError:
            rows = []
        
    return [
        Company(
            id=row[0],
            company_name=row[1],
            domain=row[2],
            tier=row[3],
            vertical=row[4],
            target_reason=row[5],
            wedge=row[6]
        )
        for row in rows
    ]


@app.post("/api/companies/import")
async def import_companies(file: UploadFile = File(...)):
    """Import companies from CSV."""
    content = await file.read()
    text = content.decode('utf-8')
    
    reader = csv.DictReader(io.StringIO(text))
    imported = 0
    
    with db.get_db() as conn:
        cursor = conn.cursor()
        
        for row in reader:
            company_name = row.get('Company', '').strip()
            if not company_name:
                continue
                
            tier = row.get('Tier', '').strip()
            vertical = row.get('Vertical', '').strip()
            target_reason = row.get('Why this is a good Zco target', row.get('Target_Reason', '')).strip()
            wedge = row.get('Zco wedge', row.get('Wedge', '')).strip()
            
            # Generate domain slug from company name
            import re
            domain = re.sub(r'[^\w\s-]', '', company_name.lower())
            domain = re.sub(r'[\s_]+', '-', domain).strip('-')
            
            cursor.execute("""
                INSERT OR REPLACE INTO targets (domain, company_name, tier, vertical, target_reason, wedge, source)
                VALUES (?, ?, ?, ?, ?, ?, 'csv_import')
            """, (domain, company_name, tier, vertical, target_reason, wedge))
            imported += 1
    
    return {"imported": imported}


@app.get("/api/contacts", response_model=List[Contact])
def get_contacts(
    company: Optional[str] = None,
    has_email: Optional[bool] = None,
    today_only: bool = False
):
    """Get LinkedIn contacts."""
    with db.get_db() as conn:
        cursor = conn.cursor()
        
        # Use email_generated instead of email
        query = "SELECT id, company_name, domain, name, title, email_generated, email_pattern, linkedin_url, scraped_at FROM linkedin_contacts WHERE 1=1"
        params = []
        
        if company:
            query += " AND company_name LIKE ?"
            params.append(f"%{company}%")
        
        if has_email is True:
            query += " AND email_generated IS NOT NULL AND email_generated != ''"
        elif has_email is False:
            query += " AND (email_generated IS NULL OR email_generated = '')"
        
        if today_only:
            today = datetime.now().strftime('%Y-%m-%d')
            query += f" AND DATE(scraped_at) = '{today}'"
        
        query += " ORDER BY scraped_at DESC, company_name"
        
        try:
            cursor.execute(query, params)
            rows = cursor.fetchall()
        except sqlite3.OperationalError:
            rows = []
    
    return [
        Contact(
            id=row[0],
            company_name=row[1] or '',
            domain=row[2],
            name=row[3],
            title=row[4],
            email=row[5],  # Maps from email_generated
            email_pattern=row[6],
            linkedin_url=row[7],
            scraped_at=str(row[8]) if row[8] else None
        )
        for row in rows
    ]


@app.get("/api/contacts/export")
def export_contacts(today_only: bool = False):
    """Export contacts to CSV."""
    contacts = get_contacts(today_only=today_only, has_email=True)
    
    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=['Company', 'Name', 'Title', 'Email', 'LinkedIn URL'])
    writer.writeheader()
    
    for c in contacts:
        writer.writerow({
            'Company': c.company_name,
            'Name': c.name,
            'Title': c.title,
            'Email': c.email,
            'LinkedIn URL': c.linkedin_url
        })
    
    # Save to file
    export_path = config.DATA_DIR / f"contacts_export_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv"
    with open(export_path, 'w', newline='', encoding='utf-8') as f:
        f.write(output.getvalue())
    
    return FileResponse(
        export_path,
        media_type='text/csv',
        filename=export_path.name
    )


@app.get("/api/scrape/status")
def get_scrape_status():
    """Get current scrape status."""
    return scrape_status


@app.post("/api/scrape/start")
async def start_scrape(request: ScrapeRequest, background_tasks: BackgroundTasks):
    """Start LinkedIn scraping in background."""
    if scrape_status["running"]:
        raise HTTPException(400, "Scrape already running")
    
    # This would trigger the actual scraping - for now just return status
    # In production, you'd use Celery or similar for background tasks
    return {"message": "Scrape started", "status": "Note: Run 'python main.py scrape-and-enrich' from terminal"}


@app.post("/api/emails/discover")
async def discover_emails(background_tasks: BackgroundTasks):
    """Trigger email discovery for contacts without emails."""
    return {"message": "Run 'python main.py discover-emails' from terminal"}


@app.delete("/api/contacts")
def clear_contacts(today_only: bool = False):
    """Clear contacts from database."""
    with db.get_db() as conn:
        cursor = conn.cursor()
        
        try:
            if today_only:
                today = datetime.now().strftime('%Y-%m-%d')
                cursor.execute(f"DELETE FROM linkedin_contacts WHERE DATE(scraped_at) = '{today}'")
            else:
                cursor.execute("DELETE FROM linkedin_contacts")
            
            deleted = cursor.rowcount
        except sqlite3.OperationalError:
            deleted = 0
    
    return {"deleted": deleted}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
