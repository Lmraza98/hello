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

## Documentation Architecture

The repository now follows a LeadPilot-style self-documenting pattern:

- Docs config: `docs/docs.json` (Mintlify nav + redirects)
- Docs index pages: `docs/index.md`, `docs/start/docs-directory.md`, `docs/start/hubs.md`
- Page metadata via frontmatter (`summary`, `read_when`, `title`)
- Tooling scripts:
  - `python scripts/docs_list.py`
  - `python scripts/docs_link_audit.py`
  - `python scripts/export_api_docs.py`
  - `python scripts/docs_ci.py`
  - `python scripts/docs_guard.py`

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

## LeadPilot Launcher (Dev)

The developer launcher (`python launcher.py`) starts backend + bridge and exposes a production-hardened test orchestrator.

**Core behavior:**
1. Uses strict allowlisted test commands from `config/launcher_test_catalog.v1.json`.
2. Runs tests in an isolated subprocess worker (`scripts/launcher_test_worker.py`) via JSON protocol.
3. Supports deterministic run plans (dependency-aware) with preview before execution.
4. Supports cancellation of current test or entire run.
5. Persists run artifacts under `data/launcher_runs/run-*/` with rolling retention.
6. Exports JSON and JUnit for every run by default.

**Run artifacts per execution:**
- `metadata.json`
- `events.ndjson`
- `stdout.log`
- `results.json`
- `results.junit.xml`

**Prereqs for launcher orchestration:**
- Python environment with `pytest`.
- Node available (or `LEADPILOT_NODE_PATH` set) for bridge startup.
- UI dependencies installed for frontend tests (`npm --prefix ui test`).

See `docs/help/launcher-test-orchestration.md` for full operational details.

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
LLM_MODEL = "gemma3:12b"       # Local default model
LLM_MAX_INPUT_TOKENS = 800      # Aggressive trimming
LLM_MAX_OUTPUT_TOKENS = 120     # Concise outputs
```

### Chat Tool Brain (UI)

To switch the local tool-calling/intent-routing model between FunctionGemma and Devstral, set UI env vars in `ui/.env`:

```env
VITE_TOOL_BRAIN=functiongemma
# or
VITE_TOOL_BRAIN=devstral-small-2
```

Optional explicit model tag override:

```env
VITE_OLLAMA_TOOL_BRAIN_MODEL=devstral-small-2:latest
```

This model is used for API tool interaction (intent routing, tool selection, structured arguments, and multi-step tool planning).

If you run a local `llama.cpp` server (OpenAI-compatible API) instead of Ollama:

```env
VITE_OLLAMA_URL=http://127.0.0.1:8080
VITE_LOCAL_LLM_API=openai
```

Qwen2.5-Coder 32B profile for structured reasoning and extraction:

```env
VITE_TOOL_BRAIN=qwen3
VITE_PLANNER_BACKEND=qwen3
VITE_DECOMPOSE_CLASSIFIER_MODEL=gemma3:12b
VITE_OLLAMA_QWEN3_MODEL=qwen2.5:32b-instruct
VITE_OLLAMA_GEMMA_MODEL=gemma3:12b
```

Single-pass latency benchmark mode (closest to terminal-style prompt timing):

```env
VITE_CHAT_BENCHMARK_MODE=true
VITE_CHAT_BENCHMARK_MODEL=qwen2.5:32b-instruct
VITE_CHAT_BENCHMARK_NUM_PREDICT=256
```

Saved local llama.cpp profile (Qwen2.5-Coder-32B GGUF):

- Script: `scripts/run_qwen25_coder_32b_llama_cli.ps1`
- Server script (OpenAI-compatible API for UI): `scripts/run_qwen25_coder_32b_llama_server.ps1`
- Env path vars: `LLAMA_CPP_TOOL_BRAIN_DIR`, `LLAMA_CPP_TOOL_BRAIN_MODEL_PATH`, `VITE_LLAMA_CPP_TOOL_BRAIN_MODEL_PATH`

Command:

```powershell
cd C:\llm\llama
.\llama-cli.exe -m "C:\llm\models\qwen2.5-coder-32b\Qwen2.5-Coder-32B-Instruct-Q4_K_M.gguf" `
  --n-gpu-layers 999 `
  --tensor-split 0.35,0.65 `
  --main-gpu 1 `
  -c 8192 `
  -n 16 `
  -p "Reply with: OK"
```

### Chat Workspace Layout (UI)

The app shell is now chat-first with an on-demand manual workspace:

- Chat panel: assistant collapses to input-only when navigating via the left sidebar, and expands again when the user types.
- Top interaction sheet: contextual UI components slide down from the top during chat-driven workflows; manual sidebar routes render without the workspace header container.
- Dynamic split: when the top sheet opens, chat shrinks to keep both contexts visible.
- Sidebar routes remain separate full page routes (manual navigation still works as before).

Recent UI updates added:

- left app navigation moved into a collapsible sidebar (`230px` max width) with icon-only collapsed mode,
- desktop header actions moved into the left sidebar (quick add + settings),
- top-sheet workspace with one-click expand/collapse transitions,
- live interaction tray defaults to a compact single-row bar (collapsed), can be pinned open, and auto-collapses on completion unless pinned,
- filter/workflow interactions now show explicit state (`in progress`, `completed`, `failed`) with result labels,
- chat dock state persistence (expanded/pinned) and trace access from expanded mode,
- Contacts page now uses a right-side assistant panel on desktop and removes the bottom chat dock from that view,
- chat-triggered filter/navigation/selection actions render contextual interaction cards (filter chips, target view hints, live progress bars) instead of only a loading indicator,
- zero-result contact searches now surface an inline create-contact form prefilled from the chat query,
- full route pages can still be opened explicitly from sidebar navigation or from interaction-card "Open Full Page" actions,
- compact workflow event cards for action-required confirmations, tool findings, and next actions,
- trace drawer with an `LLM Reasoning` block summarizing route decisions, planner thoughts, and reflections from debug trace metadata,
- reduced confirmation prompt duplication by rendering confirmation as a single structured card.

Feature flag behavior:

- `VITE_CHAT_FIRST_SHELL=true` enables chat-first shell by default.
- local override key: `hello_feature_chat_first_shell` (`on` / `off`) from Settings.
- temporary fallback: add `?legacyShell=1` to force legacy split-pane shell.

### Templates Tab (UI + API)

The app now includes a standalone `Templates` tab (`/templates`) for reusable email templating.

Features:

- template CRUD (`create`, `edit`, `duplicate`, `archive`),
- subject/preheader/from header fields,

### LangGraph Runs (API)

The backend exposes long-running LangGraph workflows for multi-step operations.

Endpoints:
- `POST /api/langgraph/runs` (create)
- `POST /api/langgraph/runs/{id}/start`
- `POST /api/langgraph/runs/{id}/continue`
- `POST /api/langgraph/runs/{id}/cancel`
- `GET /api/langgraph/runs/{id}/status`
- `GET /api/langgraph/runs` (list)

### LeadPilot Launcher (Desktop)

For end users, use the LeadPilot launcher to start the backend + browser bridge:

1. Build the frontend and launcher:
   - `python build.py`
2. Run the launcher from `dist/LeadPilot/LeadPilot(.exe)`.

The launcher starts:
- FastAPI backend on `http://127.0.0.1:8000`
- LeadPilot browser bridge on `http://127.0.0.1:9223`

Note: The current LeadPilot bridge uses the OpenClaw bridge server code from `openclaw/`.
If packaging, ensure `openclaw/node_modules` is installed or vendor the bridge code.
- HTML + optional plain-text bodies,
- token rendering with fallbacks (for example `{{firstName | "there"}}`),
- reusable snippet blocks,
- revision history + revert,
- render preview + validation + test-send (dry run),
- export/import JSON.

Campaigns support:

- `copied` mode: legacy step templates per campaign,
- `linked` mode: attach a template-library `template_id` and render per contact.

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
Update selectors in `services/web_automation/salesforce/pages.py`. The page object pattern isolates these changes.

### Sales Navigator API lifecycle

SalesNav endpoints now use centralized lifecycle wrappers in `api/routes/salesnav.py` so browser state and automation events are handled consistently.

- `_automation_scope(action, payload)`:
  - emits `browser_automation_start`
  - clears active browser page on exit
  - emits `browser_automation_stop`
- `_managed_scraper(action, payload)`:
  - wraps `_automation_scope`
  - starts/stops `SalesNavigatorScraper`
  - sets active browser page when available

Event flow by endpoint:
- `POST /api/salesnav/search`
  - one start event, one stop event
- `POST /api/salesnav/search-companies`
  - one start event, one stop event (collector owns scraping internals)
- `POST /api/salesnav/scrape-leads`
  - one start event, one stop event
  - per-company progress events via `browser_automation_progress` with:
    - `action`, `message`, `company`, `index`, `total`

This keeps start/stop semantics clean and makes progress updates explicit for UI consumers.

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

"# hello" 
