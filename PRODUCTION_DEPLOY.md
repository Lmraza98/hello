# Production Deployment Guide

## Prerequisites

- Python 3.10+
- Node.js 18+ and npm
- OpenAI API key
- Salesforce account with access

---

## Option 1: Production Server Deployment (Recommended)

### 1. Build the Frontend

```bash
cd ui
npm install
npm run build
```

This creates an optimized production build in `ui/dist/`.

### 2. Install Python Dependencies

```bash
# Install all dependencies including APScheduler
pip install -r requirements.txt

# Install Playwright browsers for Salesforce automation
playwright install chromium
```

### 3. Configure Environment

Create or update your `.env` file:

```env
# OpenAI (required for AI email personalization)
OPENAI_API_KEY=your_key_here

# Salesforce
SALESFORCE_URL=https://yourdomain.lightning.force.com

# Email sender info
SENDER_NAME=Your Name
VALUE_PROP=streamline their sales process

# Optional: Tavily API for web search (legacy)
TAVILY_API_KEY=your_key_here
```

### 4. Initialize the Database

The database will be auto-created on first run, but you can pre-initialize:

```bash
python -c "import database; database.init_database()"
```

### 5. Run in Production

#### Option A: Using Uvicorn directly

```bash
# Run with multiple workers (recommended)
uvicorn api.main:app --host 0.0.0.0 --port 8000 --workers 4

# Or single worker with reload (for testing)
uvicorn api.main:app --host 0.0.0.0 --port 8000
```

#### Option B: Using Gunicorn + Uvicorn workers (Linux/Mac)

```bash
# Install gunicorn first
pip install gunicorn

# Run with gunicorn
gunicorn api.main:app -w 4 -k uvicorn.workers.UvicornWorker --bind 0.0.0.0:8000
```

#### Option C: Using PM2 (Process Manager)

```bash
# Install PM2
npm install -g pm2

# Create ecosystem file
cat > ecosystem.config.js << EOF
module.exports = {
  apps: [{
    name: 'crm-backend',
    script: 'uvicorn',
    args: 'api.main:app --host 0.0.0.0 --port 8000',
    interpreter: 'python',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'production'
    }
  }]
}
EOF

# Start with PM2
pm2 start ecosystem.config.js
pm2 save
pm2 startup  # Configure to start on boot
```

### 6. Background Jobs (APScheduler)

The scheduler starts automatically with the FastAPI app and runs:
- **Daily batch preparation**: 7:00 AM (creates draft emails for review)
- **Salesforce tracking poll**: Every 90 minutes (checks for opens/replies)

To manually trigger:
```bash
# Prepare batch
curl -X POST http://localhost:8000/api/emails/prepare-batch

# Poll tracking
curl -X POST http://localhost:8000/api/emails/poll-tracking
```

### 7. Reverse Proxy (Nginx - Recommended)

Create `/etc/nginx/sites-available/crm`:

```nginx
server {
    listen 80;
    server_name your-domain.com;

    client_max_body_size 20M;

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # WebSocket support (if needed)
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

Enable and restart:
```bash
sudo ln -s /etc/nginx/sites-available/crm /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

### 8. Systemd Service (Linux)

Create `/etc/systemd/system/crm.service`:

```ini
[Unit]
Description=CRM Email Campaign System
After=network.target

[Service]
Type=simple
User=your-user
WorkingDirectory=/path/to/Hello
Environment="PATH=/path/to/venv/bin"
ExecStart=/path/to/venv/bin/uvicorn api.main:app --host 127.0.0.1 --port 8000 --workers 4
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Enable and start:
```bash
sudo systemctl daemon-reload
sudo systemctl enable crm
sudo systemctl start crm
sudo systemctl status crm
```

---

## Option 2: Desktop Application (Windows .exe)

For a standalone Windows executable:

```bash
python build.py
```

This will:
1. Build the frontend
2. Install dependencies
3. Create `dist/LinkedInScraper.exe` with PyInstaller

**Output**: `dist/LinkedInScraper.exe` (~200MB) - includes everything bundled.

---

## Option 3: Docker Deployment

Create `Dockerfile`:

```dockerfile
FROM python:3.11-slim

# Install Node.js for frontend build
RUN apt-get update && apt-get install -y \
    curl \
    && curl -fsSL https://deb.nodesource.com/setup_18.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy and install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy and build frontend
COPY ui/package*.json ui/
RUN cd ui && npm ci
COPY ui/ ui/
RUN cd ui && npm run build

# Copy backend
COPY . .

# Install Playwright browsers
RUN playwright install chromium
RUN playwright install-deps chromium

# Expose port
EXPOSE 8000

# Start application
CMD ["uvicorn", "api.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

Create `docker-compose.yml`:

```yaml
version: '3.8'

services:
  crm:
    build: .
    ports:
      - "8000:8000"
    volumes:
      - ./data:/app/data
      - ./.env:/app/.env
    restart: unless-stopped
    environment:
      - PYTHONUNBUFFERED=1
```

Build and run:
```bash
docker-compose up -d
```

---

## Production Checklist

- [ ] Frontend built and optimized (`ui/dist/`)
- [ ] All Python dependencies installed including `apscheduler`
- [ ] Playwright Chromium browser installed
- [ ] `.env` configured with API keys
- [ ] Database initialized
- [ ] Scheduler running (check logs for "Background scheduler started")
- [ ] Reverse proxy configured (if using Nginx)
- [ ] SSL/TLS certificate (use Let's Encrypt)
- [ ] Firewall rules configured
- [ ] Monitoring/logging setup

---

## Daily Workflow

1. **Morning (7:00 AM)**: Scheduler auto-generates draft emails
2. **Review**: Open app → "Review" tab → approve/edit/reject drafts
3. **Sending**: Approved emails are scheduled throughout the day (8am-5pm)
4. **Tracking**: Scheduler polls Salesforce every 90 minutes for opens/replies

---

## Monitoring

### Check scheduler status:
```bash
# View logs
tail -f data/logs/email_sender_*.log

# Check if jobs are running
curl http://localhost:8000/api/emails/stats
```

### Database location:
- `data/outreach.db` — SQLite database (backup regularly!)

### Logs location:
- `data/logs/email_sender_YYYYMMDD.log`

---

## Troubleshooting

### Scheduler not running
- Check logs for "Background scheduler started"
- Ensure APScheduler is installed: `pip install apscheduler`
- Restart the app

### Salesforce automation fails
- Run `python salesforce_upload.py` manually first to authenticate
- Session stored in `data/salesforce_auth.json`
- Check browser is accessible (headless mode requires X server on Linux)

### Frontend not loading
- Verify `ui/dist/` exists and has files
- Check browser console for errors
- Ensure static file serving is enabled in FastAPI

### Database migrations
- New columns are added automatically on startup via ALTER TABLE
- Check database.py `init_database()` for migration logic

---

## Performance Tuning

### For high volume:
- Increase uvicorn workers: `--workers 8`
- Adjust daily send cap in Settings panel (default: 20)
- Increase batch size in `salesforce_email_sender.py` (default: 20 tabs)

### For lower memory usage:
- Use single worker: `--workers 1`
- Reduce batch size to 10 tabs
- Disable tracking poll (comment out scheduler job)

---

## Security Recommendations

1. **Environment variables**: Never commit `.env` to git
2. **API keys**: Use secrets manager in production
3. **Database**: Regular backups of `data/outreach.db`
4. **Firewall**: Only expose port 80/443 (use Nginx reverse proxy)
5. **SSL**: Use Let's Encrypt for HTTPS
6. **Authentication**: Consider adding auth middleware to FastAPI

---

## Backup Strategy

```bash
# Backup script
#!/bin/bash
DATE=$(date +%Y%m%d_%H%M%S)
tar -czf backups/backup_$DATE.tar.gz data/outreach.db data/salesforce_auth.json .env

# Keep only last 30 days
find backups/ -name "backup_*.tar.gz" -mtime +30 -delete
```

---

## Scaling

For enterprise deployments:
- Replace SQLite with PostgreSQL
- Add Redis for caching
- Use Celery for background jobs instead of APScheduler
- Deploy behind load balancer
- Use managed Salesforce API instead of web automation
