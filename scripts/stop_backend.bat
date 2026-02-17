@echo off
setlocal EnableExtensions

echo Stopping backend on port 8000...
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /r /c:":8000 .*LISTENING"') do (
  echo Killing PID %%p on :8000
  taskkill /PID %%p /F >nul 2>&1
)

echo Stopping OpenClaw bridge on port 9223...
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /r /c:":9223 .*LISTENING"') do (
  echo Killing PID %%p on :9223
  taskkill /PID %%p /F >nul 2>&1
)

echo Done.
exit /b 0
