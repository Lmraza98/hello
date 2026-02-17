@echo off
REM Daily Email Campaign Sender - Run via Windows Task Scheduler
REM This script processes all pending campaign emails

echo ============================================================
echo   Daily Email Campaign Sender
echo   %date% %time%
echo ============================================================
echo.

cd /d C:\Users\lmraz\Hello
python -m services.email.daily_sender

echo.
echo ============================================================
echo   Script completed at %time%
echo ============================================================

REM Uncomment the line below to keep window open when run manually
REM pause

