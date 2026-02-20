@echo off
setlocal EnableExtensions

REM Start the standalone LeadPilot browser bridge server (tabs/navigate/snapshot/act).

netstat -ano | findstr :9223 | findstr LISTENING >nul
if %errorlevel%==0 (
  echo LeadPilot bridge already running on port 9223.
  exit /b 0
)

echo Starting LeadPilot Browser Bridge...
start /min "LeadPilot Browser Bridge" node --import tsx scripts\leadpilot_browser_bridge.ts

echo LeadPilot browser bridge started on http://127.0.0.1:9223
exit /b 0
