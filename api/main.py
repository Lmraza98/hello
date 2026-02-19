"""
FastAPI backend for LinkedIn Scraper UI.
Run scraping directly from the browser.
"""
import asyncio
import traceback
import time
import uuid
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from pathlib import Path

import config
import database as db
from api.observability import clear_request_context, set_request_context

# Import routes
from api.routes import (
    admin,
    browser_nav,
    browser_skills,
    browser_workflows,
    browser_stream,
    chat,
    companies,
    compound_workflow,
    contacts,
    documents,
    emails,
    google,
    notes,
    pipeline,
    research,
    search,
    salesforce,
    salesnav,
    stats,
    workflows,
)
from services.web_automation.salesforce.lookup_queue import (
    start_salesforce_lookup_worker,
    stop_salesforce_lookup_worker,
)
from services.web_automation.salesforce.auth_manager import (
    start_session_health_worker,
    stop_session_health_worker,
)


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
                from services.email.preparer import prepare_daily_batch
                result = await prepare_daily_batch()
                print(f"[Scheduler] Daily batch: {result.get('message', '')}")
            except Exception as e:
                print(f"[Scheduler] Batch preparation error: {e}")
        
        scheduler.add_job(_prepare_batch, CronTrigger(hour=7, minute=0), id='daily_batch')
        
        # Poll Salesforce tracking every 90 minutes during business hours (8am-5pm)
        async def _poll_tracking():
            try:
                from services.email.salesforce_tracker import poll_salesforce_tracking
                result = await poll_salesforce_tracking()
                print(f"[Scheduler] Tracking poll: {result.get('message', '')}")
            except Exception as e:
                print(f"[Scheduler] Tracking poll error: {e}")
        
        scheduler.add_job(
            _poll_tracking,
            IntervalTrigger(minutes=90),
            id='tracking_poll'
        )
        
        # Poll Outlook inbox for replies every 10 minutes
        async def _poll_outlook_replies():
            try:
                from services.email.graph_auth import is_authenticated
                if not is_authenticated():
                    return  # Skip silently if not authed yet
                from services.email.outlook_monitor import poll_outlook_replies
                result = await poll_outlook_replies(minutes_back=15)
                if result.get('new_replies', 0) > 0:
                    print(f"[Scheduler] Outlook replies: {result.get('message', '')}")
            except ImportError:
                pass  # MSAL not installed — skip silently
            except Exception as e:
                print(f"[Scheduler] Outlook reply poll error: {e}")
        
        scheduler.add_job(
            _poll_outlook_replies,
            IntervalTrigger(minutes=10),
            id='outlook_reply_poll'
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
    await start_salesforce_lookup_worker()
    await start_session_health_worker()
    yield
    await stop_session_health_worker()
    await stop_salesforce_lookup_worker()
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


@app.middleware("http")
async def request_observability_middleware(request: Request, call_next):
    request_id = str(uuid.uuid4())
    correlation_id = request.headers.get("x-correlation-id") or str(uuid.uuid4())
    request.state.request_id = request_id
    request.state.correlation_id = correlation_id
    set_request_context(request_id, correlation_id)

    start = time.perf_counter()
    try:
        response = await call_next(request)
    except Exception:
        duration_ms = (time.perf_counter() - start) * 1000
        db.insert_log(
            {
                "level": "error",
                "feature": "http",
                "source": "middleware",
                "message": f"{request.method} {request.url.path}",
                "correlation_id": correlation_id,
                "request_id": request_id,
                "status_code": 500,
                "duration_ms": round(duration_ms, 3),
                "meta_json": {"method": request.method, "path": request.url.path},
            }
        )
        clear_request_context()
        raise

    duration_ms = (time.perf_counter() - start) * 1000
    response.headers["x-request-id"] = request_id
    response.headers["x-correlation-id"] = correlation_id
    db.insert_log(
        {
            "level": "info" if response.status_code < 400 else "error",
            "feature": "http",
            "source": "middleware",
            "message": f"{request.method} {request.url.path}",
            "correlation_id": correlation_id,
            "request_id": request_id,
            "status_code": response.status_code,
            "duration_ms": round(duration_ms, 3),
            "meta_json": {"method": request.method, "path": request.url.path},
        }
    )
    clear_request_context()
    return response


def _error_payload(status_code: int, detail) -> dict:
    if isinstance(detail, dict):
        code = str(detail.get("code") or f"http_{status_code}")
        message = str(detail.get("message") or detail.get("detail") or "Request failed")
        details = detail.get("details")
    else:
        code = f"http_{status_code}"
        message = str(detail or "Request failed")
        details = None

    payload = {
        "success": False,
        "error": {
            "code": code,
            "message": message,
        },
        "detail": detail,
    }
    if details is not None:
        payload["error"]["details"] = details
    return payload


@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    response = JSONResponse(status_code=exc.status_code, content=_error_payload(exc.status_code, exc.detail))
    if hasattr(request.state, "request_id"):
        response.headers["x-request-id"] = request.state.request_id
    if hasattr(request.state, "correlation_id"):
        response.headers["x-correlation-id"] = request.state.correlation_id
    return response


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    traceback.print_exc()
    response = JSONResponse(
        status_code=500,
        content=_error_payload(500, {"code": "internal_error", "message": str(exc)}),
    )
    if hasattr(request.state, "request_id"):
        response.headers["x-request-id"] = request.state.request_id
    if hasattr(request.state, "correlation_id"):
        response.headers["x-correlation-id"] = request.state.correlation_id
    return response

# Frontend directory (routes added at end of file)
FRONTEND_DIR = config.BASE_DIR / "ui" / "dist"

# Initialize database
db.init_database()

# Register routes
app.include_router(companies.router)
app.include_router(contacts.router)
app.include_router(compound_workflow.router)
app.include_router(notes.router)
app.include_router(stats.router)
app.include_router(pipeline.router)
app.include_router(documents.router)
app.include_router(emails.router)
app.include_router(salesnav.router)
app.include_router(browser_stream.router)
app.include_router(browser_nav.router)
app.include_router(browser_skills.router)
app.include_router(browser_workflows.router)
app.include_router(salesforce.router)
app.include_router(research.router)
app.include_router(google.router)
app.include_router(search.router)
app.include_router(chat.router)
app.include_router(admin.router)
app.include_router(workflows.router)

# ============================================
# Frontend serving (MUST be last - catch-all)
# ============================================
if FRONTEND_DIR.exists():
    app.mount("/assets", StaticFiles(directory=FRONTEND_DIR / "assets"), name="assets")
    
    @app.get("/", response_class=HTMLResponse, include_in_schema=False)
    async def serve_frontend():
        return (FRONTEND_DIR / "index.html").read_text()
    
    @app.get("/{path:path}", include_in_schema=False)
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
