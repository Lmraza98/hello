@echo off
REM Deprecated: use stop_leadpilot_browser_bridge.bat
REM Stop the LeadPilot browser bridge server running on port 9223

echo Stopping LeadPilot browser bridge on port 9223...

set PID=
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /r /c:":9223 .*LISTENING"') do (
  set PID=%%p
)

if "%PID%"=="" (
  echo No process is listening on port 9223.
  exit /b 0
)

echo Found PID %PID% listening on :9223
taskkill /PID %PID% /F
