@echo off
REM Stop the Hello Lead Engine backend server running on port 8000

echo Stopping backend on port 8000...

set PID=
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /r /c:":8000 .*LISTENING"') do (
  set PID=%%p
)

if "%PID%"=="" (
  echo No process is listening on port 8000.
  exit /b 0
)

echo Found PID %PID% listening on :8000
taskkill /PID %PID% /F
