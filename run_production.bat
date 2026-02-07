@echo off
REM Production startup script for Windows

echo ====================================
echo  CRM Email Campaign System
echo  Starting in production mode...
echo ====================================

REM Check if virtual environment exists
if not exist "venv\" (
    echo Creating virtual environment...
    python -m venv venv
)

REM Activate virtual environment
call venv\Scripts\activate.bat

REM Check if frontend is built
if not exist "ui\dist\" (
    echo Building frontend...
    cd ui
    call npm install
    call npm run build
    cd ..
)

REM Install/update dependencies
echo Installing dependencies...
pip install -r requirements.txt

REM Install Playwright browsers
echo Installing Playwright browsers...
playwright install chromium

REM Check if .env exists
if not exist ".env" (
    echo WARNING: .env file not found!
    echo Please create .env with your API keys
    echo See PRODUCTION_DEPLOY.md for details
    pause
    exit /b 1
)

REM Initialize database
echo Initializing database...
python -c "import database; database.init_database()"

echo.
echo ====================================
echo  Starting server on http://localhost:8000
echo  Press Ctrl+C to stop
echo ====================================
echo.

REM Start the server
uvicorn api.main:app --host 0.0.0.0 --port 8000 --reload
