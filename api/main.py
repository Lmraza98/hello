"""
FastAPI backend for LinkedIn Scraper UI.
Run scraping directly from the browser.
"""
import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from pathlib import Path

import config
import database as db

# Import routes
from api.routes import companies, contacts, stats, pipeline, emails


# ============================================
# Scheduler setup (APScheduler)
# ============================================
scheduler = None

def _setup_scheduler():
    """Initialize the background scheduler for email automation."""
    global scheduler
    try:
        from apscheduler.schedulers.asyncio import AsyncIOScheduler
        from apscheduler.triggers.cron import CronTrigger
        from apscheduler.triggers.interval import IntervalTrigger
        
        scheduler = AsyncIOScheduler()
        
        # Prepare daily batch at 7:00 AM
        async def _prepare_batch():
            try:
                from services.email_preparer import prepare_daily_batch
                result = await prepare_daily_batch()
                print(f"[Scheduler] Daily batch: {result.get('message', '')}")
            except Exception as e:
                print(f"[Scheduler] Batch preparation error: {e}")
        
        scheduler.add_job(_prepare_batch, CronTrigger(hour=7, minute=0), id='daily_batch')
        
        # Poll Salesforce tracking every 90 minutes during business hours (8am-5pm)
        async def _poll_tracking():
            try:
                from services.salesforce_tracker import poll_salesforce_tracking
                result = await poll_salesforce_tracking()
                print(f"[Scheduler] Tracking poll: {result.get('message', '')}")
            except Exception as e:
                print(f"[Scheduler] Tracking poll error: {e}")
        
        scheduler.add_job(
            _poll_tracking,
            IntervalTrigger(minutes=90),
            id='tracking_poll'
        )
        
        scheduler.start()
        print("[Scheduler] Background scheduler started")
        
    except ImportError:
        print("[Scheduler] APScheduler not installed — background jobs disabled.")
        print("[Scheduler] Install with: pip install apscheduler")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan: start scheduler on startup, stop on shutdown."""
    _setup_scheduler()
    yield
    if scheduler:
        scheduler.shutdown(wait=False)
        print("[Scheduler] Background scheduler stopped")


app = FastAPI(title="LinkedIn Scraper API", version="1.0.0", lifespan=lifespan)

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
            salesforce_status TEXT DEFAULT 'pending',
            scraped_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(domain, name)
        )
    """)
    # Add salesforce_status column if it doesn't exist
    try:
        cursor.execute("ALTER TABLE linkedin_contacts ADD COLUMN salesforce_status TEXT DEFAULT 'pending'")
    except:
        pass  # Column already exists

# Register routes
app.include_router(companies.router)
app.include_router(contacts.router)
app.include_router(stats.router)
app.include_router(pipeline.router)
app.include_router(emails.router)

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

