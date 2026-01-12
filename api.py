"""
FastAPI backend for LinkedIn Scraper UI.
Run scraping directly from the browser.
"""
from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime
from pathlib import Path
import csv
import io
import os
import sqlite3
import re
import subprocess
import sys
import threading
import time

import database as db
import config

app = FastAPI(title="LinkedIn Scraper API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Frontend directory (routes added at end of file)
FRONTEND_DIR = config.BASE_DIR / "ui" / "dist"

# Initialize database
db.init_database()

# Add status column to targets
try:
    with db.get_db() as conn:
        conn.cursor().execute("ALTER TABLE targets ADD COLUMN status TEXT DEFAULT 'pending'")
except:
    pass

# Create linkedin_contacts table
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
            scraped_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(domain, name)
        )
    """)

# ============== Models ==============

class Company(BaseModel):
    id: Optional[int] = None
    company_name: str
    domain: Optional[str] = None
    tier: Optional[str] = None
    vertical: Optional[str] = None
    target_reason: Optional[str] = None
    wedge: Optional[str] = None
    status: Optional[str] = 'pending'

class Contact(BaseModel):
    id: Optional[int] = None
    company_name: str
    domain: Optional[str] = None
    name: str
    title: Optional[str] = None
    email: Optional[str] = None
    linkedin_url: Optional[str] = None
    scraped_at: Optional[str] = None

class Stats(BaseModel):
    total_companies: int
    total_contacts: int
    contacts_with_email: int
    contacts_today: int

# ============== Pipeline State ==============
pipeline = {
    "running": False,
    "output": [],
    "process": None,
    "started_at": None
}
output_lock = threading.Lock()

def run_pipeline_thread(tier: Optional[str], max_contacts: int):
    """Run the pipeline in a background thread."""
    global pipeline
    
    cmd = [sys.executable, "-u", "main.py", "scrape-and-enrich", "--max-contacts", str(max_contacts)]
    if tier:
        cmd.extend(["--tier", tier])
    
    try:
        # Set UTF-8 encoding, unbuffered output, and disable Rich fancy output
        env = {**os.environ, 'PYTHONIOENCODING': 'utf-8', 'PYTHONUNBUFFERED': '1', 'NO_COLOR': '1', 'TERM': 'dumb'}
        
        process = subprocess.Popen(
            cmd,
            cwd=str(config.BASE_DIR),
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=0,
            encoding='utf-8',
            errors='replace',
            env=env
        )
        pipeline["process"] = process
        
        for line in iter(process.stdout.readline, ''):
            if line:
                # Strip Unicode characters that cause encoding issues
                clean_line = line.strip()
                clean_line = clean_line.encode('ascii', 'replace').decode('ascii')
                with output_lock:
                    pipeline["output"].append({
                        "time": datetime.now().isoformat(),
                        "text": clean_line
                    })
                    # Keep last 200 lines
                    if len(pipeline["output"]) > 200:
                        pipeline["output"] = pipeline["output"][-200:]
        
        process.wait()
        
    except Exception as e:
        with output_lock:
            pipeline["output"].append({
                "time": datetime.now().isoformat(),
                "text": f"ERROR: {str(e)}"
            })
    finally:
        pipeline["running"] = False
        pipeline["process"] = None

# ============== Endpoints ==============

@app.get("/api/stats")
def get_stats():
    with db.get_db() as conn:
        cursor = conn.cursor()
        
        try:
            cursor.execute("SELECT COUNT(*) FROM targets WHERE company_name IS NOT NULL")
            total_companies = cursor.fetchone()[0]
        except:
            total_companies = 0
        
        try:
            cursor.execute("SELECT COUNT(*) FROM linkedin_contacts")
            total_contacts = cursor.fetchone()[0]
        except:
            total_contacts = 0
        
        try:
            cursor.execute("SELECT COUNT(*) FROM linkedin_contacts WHERE email_generated IS NOT NULL AND email_generated != ''")
            contacts_with_email = cursor.fetchone()[0]
        except:
            contacts_with_email = 0
        
        try:
            today = datetime.now().strftime('%Y-%m-%d')
            cursor.execute(f"SELECT COUNT(*) FROM linkedin_contacts WHERE DATE(scraped_at) = '{today}'")
            contacts_today = cursor.fetchone()[0]
        except:
            contacts_today = 0
    
    return {
        "total_companies": total_companies,
        "total_contacts": total_contacts,
        "contacts_with_email": contacts_with_email,
        "contacts_today": contacts_today
    }

@app.get("/api/companies")
def get_companies(tier: Optional[str] = None):
    with db.get_db() as conn:
        cursor = conn.cursor()
        try:
            query = "SELECT id, company_name, domain, tier, vertical, target_reason, wedge, status FROM targets WHERE company_name IS NOT NULL"
            params = []
            if tier:
                query += " AND tier = ?"
                params.append(tier)
            query += " ORDER BY tier, company_name"
            cursor.execute(query, params)
            rows = cursor.fetchall()
        except:
            rows = []
    
    return [
        {
            "id": r[0], "company_name": r[1], "domain": r[2], "tier": r[3],
            "vertical": r[4], "target_reason": r[5], "wedge": r[6],
            "status": r[7] if len(r) > 7 else "pending"
        }
        for r in rows
    ]

@app.post("/api/companies")
def add_company(company: Company):
    domain = company.domain or re.sub(r'[\W_]+', '-', company.company_name.lower()).strip('-')
    with db.get_db() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "INSERT INTO targets (domain, company_name, tier, vertical, target_reason, wedge, source, status) VALUES (?, ?, ?, ?, ?, ?, 'ui', 'pending')",
            (domain, company.company_name, company.tier, company.vertical, company.target_reason, company.wedge)
        )
        company.id = cursor.lastrowid
    return company

@app.put("/api/companies/{company_id}")
def update_company(company_id: int, company: Company):
    with db.get_db() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "UPDATE targets SET company_name=?, tier=?, vertical=?, target_reason=?, wedge=? WHERE id=?",
            (company.company_name, company.tier, company.vertical, company.target_reason, company.wedge, company_id)
        )
    return company

@app.delete("/api/companies/{company_id}")
def delete_company(company_id: int):
    with db.get_db() as conn:
        conn.cursor().execute("DELETE FROM targets WHERE id = ?", (company_id,))
    return {"deleted": True}

@app.post("/api/companies/import")
async def import_companies(file: UploadFile = File(...)):
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
            domain = re.sub(r'[\W_]+', '-', company_name.lower()).strip('-')
            cursor.execute(
                "INSERT OR REPLACE INTO targets (domain, company_name, tier, vertical, target_reason, wedge, source, status) VALUES (?, ?, ?, ?, ?, ?, 'csv', 'pending')",
                (domain, company_name, row.get('Tier', '').strip(), row.get('Vertical', '').strip(),
                 row.get('Why this is a good Zco target', '').strip(), row.get('Zco wedge', '').strip())
            )
            imported += 1
    return {"imported": imported}

@app.post("/api/companies/reset")
def reset_companies():
    """Reset all companies back to pending status."""
    with db.get_db() as conn:
        conn.cursor().execute("UPDATE targets SET status = 'pending'")
    return {"reset": True}

@app.post("/api/companies/skip-pending")
def skip_pending_companies():
    """Mark all pending companies as skipped (won't be processed in next run)."""
    with db.get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("UPDATE targets SET status = 'skipped' WHERE status = 'pending'")
        count = cursor.rowcount
    return {"skipped": count}

@app.delete("/api/companies/pending")
def clear_pending_companies():
    """Delete all pending companies from the queue."""
    with db.get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM targets WHERE status = 'pending'")
        count = cursor.rowcount
    return {"deleted": count}

@app.get("/api/companies/pending-count")
def get_pending_count():
    """Get count of pending companies."""
    with db.get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT COUNT(*) FROM targets WHERE status = 'pending'")
        count = cursor.fetchone()[0]
    return {"pending": count}

@app.get("/api/contacts")
def get_contacts(company: Optional[str] = None, has_email: Optional[bool] = None, today_only: bool = False):
    with db.get_db() as conn:
        cursor = conn.cursor()
        query = "SELECT id, company_name, domain, name, title, email_generated, linkedin_url, scraped_at FROM linkedin_contacts WHERE 1=1"
        params = []
        
        if company:
            query += " AND company_name LIKE ?"
            params.append(f"%{company}%")
        if has_email is True:
            query += " AND email_generated IS NOT NULL AND email_generated != ''"
        elif has_email is False:
            query += " AND (email_generated IS NULL OR email_generated = '')"
        if today_only:
            query += f" AND DATE(scraped_at) = '{datetime.now().strftime('%Y-%m-%d')}'"
        
        query += " ORDER BY scraped_at DESC"
        
        try:
            cursor.execute(query, params)
            rows = cursor.fetchall()
        except:
            rows = []
    
    return [
        {"id": r[0], "company_name": r[1] or '', "domain": r[2], "name": r[3],
         "title": r[4], "email": r[5], "linkedin_url": r[6], "scraped_at": str(r[7]) if r[7] else None}
        for r in rows
    ]

@app.get("/api/contacts/export")
def export_contacts(today_only: bool = False, with_email_only: bool = False):
    contacts = get_contacts(today_only=today_only, has_email=True if with_email_only else None)
    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=['Company', 'Name', 'Title', 'Email', 'LinkedIn URL'])
    writer.writeheader()
    for c in contacts:
        writer.writerow({'Company': c['company_name'], 'Name': c['name'], 'Title': c['title'], 
                        'Email': c['email'], 'LinkedIn URL': c['linkedin_url']})
    
    export_path = config.DATA_DIR / f"export_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv"
    with open(export_path, 'w', newline='', encoding='utf-8') as f:
        f.write(output.getvalue())
    return FileResponse(export_path, media_type='text/csv', filename=export_path.name)

@app.delete("/api/contacts")
def clear_contacts(today_only: bool = False):
    with db.get_db() as conn:
        cursor = conn.cursor()
        if today_only:
            cursor.execute(f"DELETE FROM linkedin_contacts WHERE DATE(scraped_at) = '{datetime.now().strftime('%Y-%m-%d')}'")
        else:
            cursor.execute("DELETE FROM linkedin_contacts")
        return {"deleted": cursor.rowcount}

# ============== Pipeline Endpoints ==============

@app.get("/api/pipeline/status")
def get_pipeline_status():
    with output_lock:
        return {
            "running": pipeline["running"],
            "output": pipeline["output"][-50:],  # Last 50 lines
            "started_at": pipeline["started_at"]
        }

@app.post("/api/pipeline/start")
def start_pipeline(tier: Optional[str] = None, max_contacts: int = 25):
    global pipeline
    
    if pipeline["running"]:
        raise HTTPException(400, "Pipeline already running")
    
    # Clear previous output
    with output_lock:
        pipeline["output"] = []
        pipeline["running"] = True
        pipeline["started_at"] = datetime.now().isoformat()
        pipeline["output"].append({
            "time": datetime.now().isoformat(),
            "text": f"Starting pipeline... (tier={tier or 'all'}, max_contacts={max_contacts})"
        })
    
    # Start in background thread
    thread = threading.Thread(target=run_pipeline_thread, args=(tier, max_contacts), daemon=True)
    thread.start()
    
    return {"started": True}

@app.post("/api/pipeline/stop")
def stop_pipeline():
    global pipeline
    if pipeline["process"]:
        pipeline["process"].terminate()
    pipeline["running"] = False
    return {"stopped": True}

@app.post("/api/pipeline/emails")
def run_email_discovery(workers: int = 5):
    """Run only the email discovery step on existing contacts"""
    global pipeline
    
    if pipeline["running"]:
        raise HTTPException(400, "Pipeline already running")
    
    pipeline["running"] = True
    pipeline["output"] = []
    pipeline["started_at"] = datetime.now().isoformat()
    
    cmd = [sys.executable, "-u", str(config.BASE_DIR / "main.py"), "discover-emails", "--workers", str(workers)]
    
    def run():
        global pipeline
        try:
            env = os.environ.copy()
            env["PYTHONIOENCODING"] = "utf-8"
            env["PYTHONUNBUFFERED"] = "1"
            process = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                encoding='utf-8',
                errors='replace',
                bufsize=0,
                env=env
            )
            pipeline["process"] = process
            
            for line in iter(process.stdout.readline, ''):
                if line:
                    clean_line = line.strip()
                    clean_line = clean_line.encode('ascii', 'replace').decode('ascii')
                    with output_lock:
                        pipeline["output"].append({
                            "time": datetime.now().isoformat(),
                            "text": clean_line
                        })
                        if len(pipeline["output"]) > 200:
                            pipeline["output"] = pipeline["output"][-200:]
            
            process.wait()
        except Exception as e:
            with output_lock:
                pipeline["output"].append({"time": datetime.now().isoformat(), "text": f"Error: {e}"})
        finally:
            pipeline["running"] = False
            pipeline["process"] = None
    
    thread = threading.Thread(target=run, daemon=True)
    thread.start()
    
    return {"started": True}

# ============================================
# Frontend serving (MUST be last - catch-all)
# ============================================
if FRONTEND_DIR.exists():
    app.mount("/assets", StaticFiles(directory=FRONTEND_DIR / "assets"), name="assets")
    
    @app.get("/", response_class=HTMLResponse)
    async def serve_frontend():
        return (FRONTEND_DIR / "index.html").read_text()
    
    @app.get("/{path:path}")
    async def serve_spa(path: str):
        # Don't catch API routes
        if path.startswith("api"):
            raise HTTPException(404)
        file_path = FRONTEND_DIR / path
        if file_path.exists() and file_path.is_file():
            return FileResponse(file_path)
        return HTMLResponse((FRONTEND_DIR / "index.html").read_text())

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
