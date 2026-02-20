@echo off
setlocal EnableExtensions

REM Stop the LeadPilot browser bridge server running on port 9223

echo Stopping LeadPilot bridge on port 9223...
set "PID="
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /r /c:":9223 .*LISTENING"') do (
  set "PID=%%p"
)

if "%PID%"=="" (
  echo No process is listening on port 9223.
  exit /b 0
)

echo Found PID %PID% listening on :9223
Taskkill /PID %PID% /F >nul 2>&1
if %errorlevel%==0 (
  echo LeadPilot bridge stopped.
) else (
  echo Failed to stop LeadPilot bridge.
)
exit /b 0
