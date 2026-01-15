"""
Pipeline execution endpoints.
"""
import os
import sys
import subprocess
import threading
from datetime import datetime
from typing import Optional
from fastapi import APIRouter, HTTPException

import config

router = APIRouter(prefix="/api/pipeline", tags=["pipeline"])

# Pipeline state (shared across requests)
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
    
    cmd = [sys.executable, "-u", "-m", "cli.main", "scrape-and-enrich", "--max-contacts", str(max_contacts)]
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


@router.get("/status")
def get_pipeline_status():
    with output_lock:
        return {
            "running": pipeline["running"],
            "output": pipeline["output"][-50:],  # Last 50 lines
            "started_at": pipeline["started_at"]
        }


@router.post("/start")
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


@router.post("/stop")
def stop_pipeline():
    global pipeline
    if pipeline["process"]:
        pipeline["process"].terminate()
    pipeline["running"] = False
    return {"stopped": True}


@router.post("/emails")
def run_email_discovery(workers: int = 5):
    """Run only the email discovery step on existing contacts"""
    global pipeline
    
    if pipeline["running"]:
        raise HTTPException(400, "Pipeline already running")
    
    pipeline["running"] = True
    pipeline["output"] = []
    pipeline["started_at"] = datetime.now().isoformat()
    
    cmd = [sys.executable, "-u", "-m", "cli.main", "discover-emails", "--workers", str(workers)]
    
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


@router.post("/phones")
def run_phone_discovery(workers: int = 10, today_only: bool = False):
    """Run phone discovery on existing contacts"""
    global pipeline
    
    if pipeline["running"]:
        raise HTTPException(400, "Pipeline already running")
    
    pipeline["running"] = True
    pipeline["output"] = []
    pipeline["started_at"] = datetime.now().isoformat()
    
    cmd = [sys.executable, "-u", "-m", "cli.main", "discover-phones", "--workers", str(workers)]
    if today_only:
        cmd.append("--today")
    
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
