# Salesforce Outreach Automation

A complete system for sending tracked emails through Salesforce using Playwright UI automation. No API access required.

## Overview

This system automates B2B outreach by:
1. **Crawling** target company websites to find contact information
2. **Extracting** structured data using LLM (with evidence-backed extraction)
3. **Scoring & Deduplicating** leads based on fit, contact quality, and confidence
4. **Sending emails through Salesforce UI** using Playwright, ensuring emails are tracked in Salesforce

## Architecture
       
```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Crawler   │────▶│  Extractor  │────▶│   Planner   │
│ (fetch/parse)     │   (LLM)     │     │ (score/plan)│
└─────────────┘     └─────────────┘     └─────────────┘
                                               │
                                               ▼
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  Reporter   │◀────│ SalesforceBot│◀───│ Send Queue  │
│  (stats/CSV)│     │ (Playwright) │     │  (SQLite)   │
└─────────────┘     └─────────────┘     └─────────────┘
```

## Quick Start

### 1. Install Dependencies

```bash
pip install -r requirements.txt
playwright install chromium
```

### System Requirements (for 30 parallel browsers)
- **RAM**: 16GB minimum (each Chrome ~500MB)
- **CPU**: 4+ cores recommended
- **Disk**: SSD for session storage

### 2. Configure Environment

Create a `.env` file:

```env
OPENAI_API_KEY=your-openai-api-key
SALESFORCE_URL=https://your-org.lightning.force.com
SENDER_NAME=Your Name
VALUE_PROP=streamline their sales process
```

### 3. Initialize

```bash
python main.py init
```

### 4. Add Target Companies

Edit `data/seed_urls.csv`:

```csv
domain_or_url,source,notes
acme-corp.com,linkedin,Saw their recent funding
techstartup.io,conference,Met at SaaStr
```

### 5. Run Daily Pipeline

```bash
python main.py daily-run --seed-csv data/seed_urls.csv
```

## Commands

| Command | Description |
|---------|-------------|
| `python main.py init` | Initialize database and directories |
| `python main.py import-targets <csv>` | Import targets from CSV |
| `python main.py crawl --limit 50` | Crawl pending target websites |
| `python main.py crawl --parallel --workers 30` | **Parallel crawl with 30 browsers** |
| `python main.py extract --limit 50` | Extract contacts using LLM |
| `python main.py plan` | Generate today's send plan |
| `python main.py send` | **Execute sends (parallel by default)** |
| `python main.py send --review` | **REVIEW MODE: Prepare emails, you click send** |
| `python main.py send --workers 30` | Send with 30 concurrent browsers |
| `python main.py send --no-parallel` | Single-threaded sending |
| `python main.py daily-run` | Run complete pipeline (parallel) |
| `python main.py status` | Show pipeline health |
| `python main.py queue` | Show pending send queue |
| `python main.py report` | Show/export daily report |

## Configuration Options

Edit `config.py` to customize:

```python
# Volume limits
DAILY_SEND_LIMIT = 250          # Max emails per day
LLM_CALLS_PER_DAY_CAP = 200     # Budget control

# Parallel processing (the key feature!)
NUM_BROWSER_WORKERS = 30        # Number of concurrent browsers
HEADLESS_MODE = False           # Set True after initial auth

# Scoring thresholds
MIN_CONFIDENCE_TO_SEND = 0.6    # Skip low-confidence extractions
MIN_FIT_SCORE_TO_SEND = 0.5     # Skip poor-fit companies

# LLM settings
LLM_MODEL = "gpt-4o-mini"       # Cost-effective model
LLM_MAX_INPUT_TOKENS = 800      # Aggressive trimming
LLM_MAX_OUTPUT_TOKENS = 120     # Concise outputs
```

## Cost Management

The system is designed to stay under ~$100/month LLM budget:

- **One LLM call per domain** for extraction (cached 30 days)
- **Optional personalization** only for top-scored contacts
- **Hard daily cap** on LLM calls
- **Aggressive input trimming** (~600-900 tokens per call)

Track costs:
```bash
python main.py status  # Shows projected monthly cost
```

## Parallel Browser Architecture

The system runs **30 concurrent browser instances** for maximum throughput.

```
┌─────────────────────────────────────────────────────────┐
│                    Worker Pool (30)                      │
├─────────┬─────────┬─────────┬─────────┬────────────────┤
│Worker 0 │Worker 1 │Worker 2 │  ...    │   Worker 29    │
│ 🌐 SF   │ 🌐 SF   │ 🌐 SF   │         │    🌐 SF       │
└────┬────┴────┬────┴────┬────┴─────────┴───────┬────────┘
     │         │         │                       │
     ▼         ▼         ▼                       ▼
  [Send 1]  [Send 2]  [Send 3]    ...        [Send N]
```

### First-Time Setup (Authentication)
1. Run `python main.py send` (without --headless)
2. **30 browser windows** will open
3. Log in to Salesforce in each window (they share the same login page)
4. Sessions are saved per-worker for reuse

### Session Management
- Each worker has its own session file (`sf_sessions/worker_N.json`)
- Sessions persist across runs
- Re-authentication only needed when sessions expire

### Performance
- **30x throughput** compared to single-threaded
- 250 emails in ~10 minutes (vs ~5 hours single-threaded)
- Each worker handles ~8-10 emails per run

## Review Mode (Manual Send)

For safety, you can prepare emails without sending - then manually review and click send:

```bash
# Single browser - review one at a time
python main.py send --no-parallel --review

# 30 browsers - all emails prepared, you click send in each
python main.py send --review --workers 30
```

### How Review Mode Works

1. System creates/finds Lead in Salesforce
2. Opens email composer
3. Fills in subject and body
4. **STOPS before clicking Send**
5. You review the email in the browser
6. **You click Send manually**
7. Press Enter in terminal to continue to next

### Parallel Review Mode

With `--review --workers 30`:
- All 30 browsers prepare their emails simultaneously
- All email composers are left open
- You go through each browser window and click Send
- When done, press Enter in terminal to close browsers

### Reliability Features
- **Page Objects**: Decoupled from DOM structure
- **Label-based locators**: `get_by_role`, `get_by_label`
- **Async work queue**: Automatic load balancing
- **Per-worker stats**: Track success rates per browser
- **Graceful degradation**: Continues with authenticated workers only

## Data Schema

### SQLite Tables

- `targets`: Input seed URLs and processing status
- `pages`: Fetched HTML/text content
- `candidates`: Extracted company/contact data with scores
- `send_queue`: Planned sends with email content
- `send_log`: Actual send results and errors
- `llm_usage`: API call tracking for budget

### Output Files

```
data/
├── outreach.db              # SQLite database
├── salesforce_auth.json     # Browser session
├── pages/                   # Cached page content
│   └── {domain}/
│       ├── {hash}.html
│       ├── {hash}.txt
│       └── {hash}.json
├── screenshots/             # Failure screenshots
└── reports/
    ├── daily_report_YYYY-MM-DD.csv
    └── failures_YYYY-MM-DD/
```

## Guardrails

The system automatically skips:
- ❌ Contacts without direct email
- ❌ Generic inbox emails (info@, contact@)
- ❌ Irrelevant roles (interns, students)
- ❌ Low confidence extractions (< 0.6)
- ❌ Salesforce "Email Opt Out" contacts
- ❌ Previously contacted emails (deduped)

## Troubleshooting

### "Not authenticated" error
Run without `--headless` to complete manual login:
```bash
python main.py send
```

### High failure rate
Check `data/screenshots/` for failure screenshots and HTML dumps.

### LLM costs exceeding budget
1. Check `python main.py status` for projections
2. Reduce `LLM_CALLS_PER_DAY_CAP` in config
3. Skip personalization: modify `planner.py` to set `personalize_top_n=0`

### Salesforce UI changes
Update selectors in `services/salesforce_pages.py`. The page object pattern isolates these changes.

### System running slow with 30 browsers
Reduce workers: `python main.py send --workers 10`

### Some workers keep failing
Check per-worker stats in output. Remove problematic session files:
```bash
rm data/sf_sessions/worker_N.json
```

## Daily Schedule (Recommended)

### Fully Automated (after initial auth)
```bash
# Run at 6 AM daily via cron/Task Scheduler
python main.py daily-run \
  --seed-csv data/seed_urls.csv \
  --crawl-limit 100 \
  --extract-limit 50 \
  --workers 30 \
  --headless
```

### Manual Supervision (first few runs)
```bash
# Morning: prep (parallel crawling)
python main.py import-targets new_leads.csv
python main.py crawl --parallel --workers 30 --limit 100
python main.py extract --limit 50
python main.py plan

# Afternoon: send with 30 browsers (watch first time)
python main.py send --workers 30

# Evening: report
python main.py report --export-csv
```

### Expected Timing (30 workers)
| Step | Single-Thread | 30 Parallel |
|------|--------------|-------------|
| Crawl 100 domains | ~30 min | ~2 min |
| Extract 50 | ~5 min | ~5 min (LLM bound) |
| Send 250 emails | ~5 hours | ~15 min |

## License

MIT

