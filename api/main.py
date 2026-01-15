"""
FastAPI backend for LinkedIn Scraper UI.
Run scraping directly from the browser.
"""
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from pathlib import Path

import config
import database as db

# Import routes
from api.routes import companies, contacts, stats, pipeline, workflows, emails

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
app.include_router(workflows.router)
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

