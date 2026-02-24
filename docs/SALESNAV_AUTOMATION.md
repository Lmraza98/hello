---
summary: "Automated company collection pipeline for LinkedIn Sales Navigator."
read_when:
  - You are working on SalesNav scraping or filters
  - You need the collection API or CLI contract
title: "Sales Navigator Automation"
---

# LinkedIn Sales Navigator Automated Company Collection

This feature allows you to automatically collect companies from LinkedIn Sales Navigator using natural language queries, powered by tool planning + browser automation.

## LeadPilot-Style Browser Workflows (Preferred)

For live Sales Navigator navigation and structured extraction, prefer the LeadPilot-style workflows implemented in:

- `services/web_automation/browser/core/workflow.py` (engine)
- `services/web_automation/browser/workflows/recipes.py` (generic recipes)
- `api/routes/browser_workflows.py` (generic workflow API)
- `api/routes/salesnav_routes/browser.py` (legacy SalesNav API boundary; response mapping)

These workflows are composed from generic `browser_nav` primitives and use markdown skills (see `skills/`) to locate UI elements.

### Endpoints

Preferred (generic, skill-driven):

- `POST /api/browser/workflows/search-and-extract`
  - `task`: skill task name (e.g. `salesnav_search_account`, `salesnav_people_search`)
  - `filters`: optional structured filters (e.g. `headquarters_location`; for people search also supports `current_company`, `current_company_urn`, `current_company_sales_nav_url`, `function`, `seniority_level`)
  - `extract_type`: optional; auto-detected from the matched skill when omitted
- `POST /api/browser/workflows/list-sub-items`
  - Used for "open an entrypoint and extract sub-items" patterns (e.g. employees from a company page).

Legacy (SalesNav-specific wrappers; maintained for compatibility):

- `POST /api/salesnav/browser/search-account`
  - Navigate to account search, type the query like a human, optionally apply HQ location, and (optionally) click a company.
- `POST /api/salesnav/browser/extract-companies`
  - Extract `/sales/company/...` rows from the currently open SalesNav results page.
- `POST /api/salesnav/browser/list-employees`
  - From a company page, open the "employees" view and extract `/sales/lead/...` rows.
  - Note: SalesNav sometimes opens employees in a new tab. The workflow will switch to the newly opened people-search tab when that happens.
- `POST /api/salesnav/browser/extract-leads`
  - Extract lead/profile rows from the currently open SalesNav people/results page.

### Human Typing

`browser_nav` supports `action="type"` with per-keystroke delays. You can tune defaults via:

- `BROWSER_HUMAN_TYPE_DELAY_MS`
- `BROWSER_HUMAN_TYPE_JITTER_MS`
- `salesnav_search_account` now applies keyword + filters via URL query builder (no sidebar filter typing/clicking required).
- `salesnav_people_search` now also uses URL query builder for filters instead of sidebar interactions.
- For people searches using `CURRENT_COMPANY`, the workflow first resolves an exact LinkedIn company identity (`name` + `urn:li:organization:<id>`), then builds the URL filter. If exact-company search yields no leads, it retries with keyword-driven people filters (without `CURRENT_COMPANY`).
- For compound lead phases (`phase_2_find_vp_ops`, `phase_3_verify_recent_ai_signal`), people search now keeps keyword input minimal:
  - planner-generated phase query defaults to empty (filter-first search),
  - if a keyworded people search returns zero rows, the workflow retries once with the same filters and no keyword before broader fallback.
- Unsupported/unmapped filter values fail fast with a structured error (`salesnav_filter_unmapped`).
- URL mapping now hydrates from:
  - `data/linkedin/salesnav-filters-ids.json` (canonical text->id mappings, including industries),
  - `data/linkedin/salesnav-filters.json` (catalog option coverage checks),
  - observed ID/text pairs in `data/debug/**/manifest.json`,
  in addition to static defaults.
- Compound workflows now propagate browser-step errors as workflow `failed` (not `completed` with empty results).
- Chat now auto-posts terminal compound workflow outcomes (completed/failed) with a concise results summary for the original request.
- The Tasks page shows failed workflow/task rows with an `Open` action to inspect error details.

### Notes on Anti-Bot / Human Verification

Sales Navigator (and many other sites) may present human verification or rate limits.
The browser workflow layer detects these states and returns structured errors so the operator
can intervene or retry later. Do not rely on automation to bypass human verification challenges.

## Overview

The system works in three steps:
1. **Query Parsing**: Uses GPT-4 to convert natural language queries into structured Sales Navigator filter specifications
2. **Filter Application**: Builds a deterministic SalesNav query URL and navigates directly with encoded keyword + filters
3. **Company Scraping**: Scrapes company cards from results with human-cadence scrolling and optionally saves them to the database

## Usage

### CLI Command

```bash
python -m cli.main collect "Construction companies in New England" --max-companies 100
```

Options:
- `query`: Natural language query (required)
- `--max-companies, -m`: Maximum number of companies to collect (default: 100)
- `--headless`: Run browser in headless mode
- `--no-save`: Do not save companies to database

### API Endpoint

```bash
POST /api/companies/collect
Content-Type: application/json

{
  "query": "Construction companies in New England",
  "max_companies": 100,
  "save_to_db": true
}
```

## Example Queries

- "Construction companies in New England"
- "Technology companies in California with 50-200 employees"
- "Healthcare companies in Texas"
- "Manufacturing companies in the Midwest with 100-500 employees"
- "Software companies in New York"

## How It Works

### 1. Filter Parser (`services/web_automation/linkedin/salesnav/filter_parser.py`)

The `SalesNavFilterParser` class uses GPT-4 to parse natural language queries into structured filter specifications:

```python
from services.web_automation.linkedin.salesnav.filter_parser import parse_salesnav_query

filters = parse_salesnav_query("Construction companies in New England")
# Returns:
# {
#   "industry": ["Construction"],
#   "headquarters_location": [
#     "Massachusetts, United States",
#     "New Hampshire, United States",
#     ...
#   ],
#   "company_headcount": None,
#   ...
# }
```

### 2. Sales Navigator Scraper (`services/web_automation/linkedin/scraper_core.py`)

The `SalesNavigatorScraper` class has been extended with new methods:

- `navigate_to_account_search()`: Navigates to Account search page
- `apply_filters(filters)`: Applies filter specifications to the search
- `scrape_company_results(max_companies)`: Scrapes company results from the current page
- `search_companies_with_filters(filters, max_companies)`: Full pipeline method

Internal responsibilities are now grouped under `services/web_automation/linkedin/salesnav/`:
- `core/`
  - `selectors.py`, `waits.py`, `session.py`, `nav.py`, `filters.py`, `operations.py`, `debug.py`, `models.py`
- `flows/`
  - `filter_applier.py`
  - `navigation_company_search.py`, `navigation_employee_fetch.py`, `navigation_workflows.py`
  - `filter_url_build_flow.py`, `filter_url_location_flow.py`, `filter_url_filter_id_flow.py`
  - `public_url_flow.py`, `public_url_batch.py`
- `extractors/`
  - `scrape_people.py`, `scrape_companies.py`
- `mixins/`
  - `session_mixin.py`, `navigation_mixin.py`, `filter_url_mixin.py`, `public_url_mixin.py`, `parsing_mixin.py`
- `parser/`
  - `filter_parser.py` (plus compatibility shim at `services/web_automation/linkedin/salesnav/filter_parser.py`)

`services/web_automation/linkedin/scraper_core.py` is now a facade entrypoint that composes
dedicated services/flows (session/auth lifecycle, navigation flows, filter URL
flows, public URL flow, filter applier, and extractors) without mixin
inheritance in the facade class.

### 3. Company Collection Flow (`services/web_automation/linkedin/salesnav/flows/company_collection.py`)

The `SalesNavCompanyCollectionFlow` flow ties everything together:

```python
from services.web_automation.linkedin.salesnav.flows.company_collection import collect_companies_from_query

result = await collect_companies_from_query(
    query="Construction companies in New England",
    max_companies=100,
    headless=False,
    save_to_db=True
)
```

Company extraction now prefers a SalesNav card-aware DOM pass (when local Playwright page access is available), capturing richer fields per card:

- `company_name`, `sales_nav_url`
- `industry`
- `employee_count`
- `location`
- `about`
- `strategic_priorities`
- `interaction_map` (detected clickable controls like save, overflow, employees, spotlight chip)
- optional `ai_summary` when a spotlight chip opens a panel containing `Summarized by AI`

When the current page is a SalesNav account profile (`/sales/company/{id}`), extraction now uses a dedicated company-profile DOM pass and returns a normalized single account row with profile metadata such as:

- `website`
- `industry`
- `headquarters`
- `employee_count`
- `followers`
- `about`
- `specialties`
- `interaction_map`

Lead extraction now also uses a SalesNav card-aware DOM pass for people/lead pages (`/sales/search/people`, `/sales/lead/...`) with richer fields:

- `name`, `title`
- `sales_nav_url`
- `public_url` (when visible) and `has_public_url`
- `company_name`, `company_sales_nav_url`
- `location`, `tenure`, `about`
- `interaction_map` (detected controls like lead-name click, company click, open profile, message, save, overflow menu)

If DOM extraction is unavailable (e.g. proxy/LeadPilot mode), workflows fall back to the existing href/text skill extraction rules.

## Filter Support

Account-search filters are encoded via URL query builder with canonical mapped values.

Supported categories include:

- **Industry** (currently mapped): `Hospitals and Health Care`, `Optometrists`, `Chiropractors`
- **Headquarters Location** (currently mapped): `United States`
- **Company Headcount**: `1-10`, `11-50`, `51-200`, `201-500`, `501-1,000`, `1,001-5,000`, `5,001-10,000`, `10,001+`
- **Annual Revenue** (USD millions range): examples `0.5-1`, `2.5-20`, `10-50`, `1000+` (open-ended encoded with max sentinel `1001`)
- **Company Headcount Growth** (numeric percent range): examples `1-19%`, `10-20%`
- **Number of Followers**: `1-50`, `51-100`, `101-1000`, `1001-5000`, `5001+`
- **Fortune**: `Fortune 50`, `Fortune 51-100`, `Fortune 101-250`, `Fortune 251-500`, `Fortune 500`
- **Department Headcount**: `<Department> <min>-<max>` (example: `Marketing 1-10`)
- **Department Headcount Growth**: `<Department> <min>-<max>%` (example: `Marketing 1-19%`)
- **Job Opportunities**: `Hiring on Linkedin`
- **Recent Activities**: `Senior leadership changes in last 3 months`
- **Connection**: `1st Degree Connections`

Unmapped values fail fast with a structured error so filter intent is never silently dropped.

## Regional Expansions

The parser automatically expands regional names:

- **New England**: Massachusetts, New Hampshire, Vermont, Maine, Connecticut, Rhode Island
- **West Coast**: California, Oregon, Washington
- **East Coast**: All states from Maine to Florida
- **Midwest**: Illinois, Indiana, Michigan, Ohio, Wisconsin, Iowa, Kansas, Minnesota, Missouri, Nebraska, North Dakota, South Dakota
- **Southwest**: Arizona, New Mexico, Oklahoma, Texas
- **Southeast**: Alabama, Arkansas, Florida, Georgia, Kentucky, Louisiana, Mississippi, North Carolina, South Carolina, Tennessee, Virginia, West Virginia

## Database Integration

Collected companies are saved to the `targets` table with:
- `company_name`: Company name
- `domain`: Generated from company name
- `vertical`: Extracted from industry
- `source`: Set to 'salesnav_automated'
- `notes`: Contains the original query
- `status`: Set to 'pending'

## Notes

- The browser automation uses Playwright and requires a valid LinkedIn Sales Navigator session
- The scraper now prefers explicit wait conditions over `networkidle` for SalesNav readiness checks
- The workflow overlay guard now explicitly closes the SalesNav notifications side-sheet (`data-sn-view-name="subpage-notifications-panel"`) when it appears, because it can block result interactions.
- Debug snapshots are sampled/conditional via config (`DEBUG_SNAPSHOTS`, `DEBUG_SNAPSHOT_RATE`)
- The system respects LinkedIn's rate limits with delays between actions
- Companies are deduplicated by domain/name before saving

## Future Enhancements

- Support for more filter types (revenue, growth, etc.)
- Pagination support for large result sets
- Export to CSV functionality
- Batch processing of multiple queries
- Filter refinement based on actual LinkedIn UI structure


