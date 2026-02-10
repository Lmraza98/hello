@echo off
REM Start the Hello Lead Engine backend server
REM Place a shortcut to this file in shell:startup to auto-start on Windows boot

echo Starting Hello Lead Engine Backend...
cd /d C:\Users\lmraz\Hello

REM Prevent duplicates: if something is already listening on :8000, don't start another.
netstat -ano | findstr :8000 | findstr LISTENING >nul
if %errorlevel%==0 (
  echo Backend already running on port 8000.
  echo Open http://localhost:8000 or stop it first.
  exit /b 0
)

REM Start uvicorn in a minimized window
start /min "Hello Backend" python -m uvicorn api.main:app --port 8000

echo Backend started on http://localhost:8000
echo You can close this window.

