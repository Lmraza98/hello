
@echo off
setlocal EnableExtensions

REM Hello Lead Engine - Backend Startup
REM Place a shortcut in shell:startup to auto-start on Windows boot

echo Starting Hello Lead Engine Backend...
cd /d C:\Users\lmraz\Hello

REM Detect existing listeners (avoid duplicates but still ensure the bridge is up).
set "BACKEND_PID="
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /c:":8000" ^| findstr /c:"LISTENING"') do (
  set "BACKEND_PID=%%p"
)

set "BRIDGE_PID="
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /c:":9223" ^| findstr /c:"LISTENING"') do (
  set "BRIDGE_PID=%%p"
)

REM Start LeadPilot browser bridge only if NOT already running (9223)
if "%BRIDGE_PID%"=="" (
  echo Starting LeadPilot Browser Bridge...
  start /min "LeadPilot Browser Bridge" cmd /c ^
    "cd /d C:\Users\lmraz\Hello && node --import tsx scripts\leadpilot_browser_bridge.ts"
) else (
  echo LeadPilot bridge already running on port 9223. PID=%BRIDGE_PID%
)

REM If backend is already running, do not restart it.
if not "%BACKEND_PID%"=="" (
  echo Backend already running on port 8000. PID=%BACKEND_PID%
  goto :eof
)

REM Activate venv if it exists
if exist "venv\Scripts\activate.bat" (
  call "venv\Scripts\activate.bat"
)

REM Build frontend on each start so latest ui/src changes are served.
REM Set SKIP_UI_BUILD=1 to skip this step for faster backend restarts.
if /I not "%SKIP_UI_BUILD%"=="1" (
  echo Building frontend...
  pushd "ui"
  if not exist "node_modules\\NUL" (
    call npm install
  )
  call npm run build
  popd
) else (
  echo Skipping frontend build because SKIP_UI_BUILD=1
)

REM Start uvicorn in a minimized window
echo Starting backend server...
start /min "Hello Backend" cmd /c ^
  "cd /d C:\Users\lmraz\Hello && python -m uvicorn api.main:app --host 127.0.0.1 --port 8000"

echo Backend started on http://localhost:8000
goto :eof
