@echo off
REM Deprecated: use start_leadpilot_browser_bridge.bat
REM Start the standalone LeadPilot browser bridge server (tabs/navigate/snapshot/act).

cd /d C:\Users\lmraz\Hello

REM Prevent duplicates
netstat -ano | findstr :9223 | findstr LISTENING >nul
if %errorlevel%==0 (
  echo LeadPilot bridge already running on port 9223.
  exit /b 0
)

start /min "LeadPilot Browser Bridge" node --import tsx scripts\\leadpilot_browser_bridge.ts

echo LeadPilot browser bridge started on http://127.0.0.1:9223
