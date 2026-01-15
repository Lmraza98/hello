# LinkedIn Sales Navigator Automated Company Collection

This feature allows you to automatically collect companies from LinkedIn Sales Navigator using natural language queries, powered by GPT-4 and web automation.

## Overview

The system works in three steps:
1. **Query Parsing**: Uses GPT-4 to convert natural language queries into structured Sales Navigator filter specifications
2. **Filter Application**: Automatically navigates to Sales Navigator Account search and applies the filters
3. **Company Scraping**: Scrapes company results and optionally saves them to the database

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

### 1. Filter Parser (`services/salesnav_filter_parser.py`)

The `SalesNavFilterParser` class uses GPT-4 to parse natural language queries into structured filter specifications:

```python
from services.salesnav_filter_parser import parse_salesnav_query

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

### 2. Sales Navigator Scraper (`services/linkedin/scraper.py`)

The `SalesNavigatorScraper` class has been extended with new methods:

- `navigate_to_account_search()`: Navigates to Account search page
- `apply_filters(filters)`: Applies filter specifications to the search
- `scrape_company_results(max_companies)`: Scrapes company results from the current page
- `search_companies_with_filters(filters, max_companies)`: Full pipeline method

### 3. Company Collector (`services/company_collector.py`)

The `CompanyCollector` class ties everything together:

```python
from services.company_collector import collect_companies_from_query

result = await collect_companies_from_query(
    query="Construction companies in New England",
    max_companies=100,
    headless=False,
    save_to_db=True
)
```

## Filter Support

The system supports the following filter categories:

- **Industry**: Standard LinkedIn industry names
- **Headquarters Location**: States, cities, or regions (with automatic expansion for regions like "New England", "West Coast", etc.)
- **Company Headcount**: Ranges like "1-10", "11-50", "51-200", etc.
- **Annual Revenue**: Ranges like "0-1M", "1M-10M", "10M-50M", etc.
- **Company Headcount Growth**: "Growing", "Stable", "Declining"
- **Number of Followers**: Ranges like "0-100", "101-1000", etc.

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
- Filter application may need refinement based on LinkedIn's actual UI structure
- The system respects LinkedIn's rate limits with delays between actions
- Companies are deduplicated by domain/name before saving

## Future Enhancements

- Support for more filter types (revenue, growth, etc.)
- Pagination support for large result sets
- Export to CSV functionality
- Batch processing of multiple queries
- Filter refinement based on actual LinkedIn UI structure


