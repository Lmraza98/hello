@echo off
REM Start the standalone OpenClaw browser bridge server (tabs/navigate/snapshot/act).

cd /d C:\Users\lmraz\Hello

REM Prevent duplicates
netstat -ano | findstr :9223 | findstr LISTENING >nul
if %errorlevel%==0 (
  echo OpenClaw bridge already running on port 9223.
  exit /b 0
)

REM Run using OpenClaw's tsx loader.
cd openclaw
start /min "OpenClaw Browser Bridge" node --import tsx ..\scripts\openclaw_browser_bridge.ts

echo OpenClaw browser bridge started on http://127.0.0.1:9223

