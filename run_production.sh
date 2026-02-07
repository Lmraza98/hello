#!/bin/bash
# Production startup script for Linux/Mac

set -e

echo "===================================="
echo " CRM Email Campaign System"
echo " Starting in production mode..."
echo "===================================="

# Check if virtual environment exists
if [ ! -d "venv" ]; then
    echo "Creating virtual environment..."
    python3 -m venv venv
fi

# Activate virtual environment
source venv/bin/activate

# Check if frontend is built
if [ ! -d "ui/dist" ]; then
    echo "Building frontend..."
    cd ui
    npm install
    npm run build
    cd ..
fi

# Install/update dependencies
echo "Installing dependencies..."
pip install -r requirements.txt

# Install Playwright browsers
echo "Installing Playwright browsers..."
playwright install chromium

# Check if .env exists
if [ ! -f ".env" ]; then
    echo "WARNING: .env file not found!"
    echo "Please create .env with your API keys"
    echo "See PRODUCTION_DEPLOY.md for details"
    exit 1
fi

# Initialize database
echo "Initializing database..."
python -c "import database; database.init_database()"

echo ""
echo "===================================="
echo " Starting server on http://localhost:8000"
echo " Press Ctrl+C to stop"
echo "===================================="
echo ""

# Start the server with multiple workers for production
uvicorn api.main:app --host 0.0.0.0 --port 8000 --workers 4
