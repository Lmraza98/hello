# Phone Database Module

A production-quality phone number validation and OSINT enrichment system that **prioritizes PhoneInfoga (FREE)** for name extraction, with optional Twilio support.

## 🎯 Key Features

- **PhoneInfoga Integration** - FREE OSINT tool for name extraction
- **Parallel Processing** - Optimized for multi-core CPUs (8 workers for AMD Ryzen 7 9800X3D)
- **SQLite Database** - Fast local lookups with FTS5 for name search
- **Name Extraction** - Identifies phone number owners from OSINT results
- **Twilio Support** - Optional (disabled by default to avoid costs)
- **CLI Commands** - Full command-line interface for all operations

## 📦 Installation

### PhoneInfoga (Required - FREE)

```bash
# Option 1: Download binary (recommended)
# https://github.com/sundowndev/phoneinfoga/releases

# Option 2: Using Go
go install github.com/sundowndev/phoneinfoga/v2@latest

# Option 3: Docker
docker pull sundowndev/phoneinfoga
```

### Python Dependencies

```bash
pip install aiohttp  # For async HTTP requests
pip install twilio   # Optional, for Twilio Lookup
```

## 🚀 Quick Start

### CLI Commands

```bash
# Build database for New England area codes
python -m cli.main build-phone-database --region new_england --max-per-area 1000

# Reverse lookup a phone number (find owner name)
python -m cli.main reverse-lookup 617-555-1234 --save

# Search database by name
python -m cli.main search-name "John Smith"

# Show all numbers with identified owners
python -m cli.main show-names --limit 50

# Export to CSV
python -m cli.main export-phones --only-names --output owners.csv
```

### Python API

```python
import asyncio
from services.phone_database import (
    build_phone_database_for_region,
    reverse_lookup_phone,
    validate_and_enrich_phone,
    PhoneDatabase
)

# Build database for specific area codes
async def build():
    result = await build_phone_database_for_region(
        area_codes=["617", "781", "857"],
        max_per_area=1000,
        max_workers=8,
        use_twilio=False  # PhoneInfoga only (free)
    )
    print(f"Names found: {result['names_found']}")

asyncio.run(build())

# Reverse lookup (find owner name)
async def lookup():
    result = await reverse_lookup_phone("617-555-1234")
    if result and result.get('name'):
        print(f"Owner: {result['name']}")

asyncio.run(lookup())

# Local database lookup (instant, no API call)
db = PhoneDatabase()
result = db.lookup("617-555-1234")
if result:
    print(f"Phone: {result['phone']}, Name: {result.get('name')}")

# Search by name
results = db.search_by_name("John Smith", limit=10)
for r in results:
    print(f"{r['phone']} - {r['name']}")
```

## 📋 CLI Command Reference

| Command | Description |
|---------|-------------|
| `build-phone-database` | Generate and validate phone numbers for area codes |
| `phone-database-stats` | Show comprehensive database statistics |
| `lookup-phone` | Lookup phone in local database (instant) |
| `reverse-lookup` | Reverse lookup using PhoneInfoga (find owner) |
| `batch-reverse-lookup` | Batch reverse lookup from file |
| `search-name` | Search database by owner name |
| `show-names` | Show all numbers with identified owner names |
| `export-phones` | Export database to CSV |

### Examples

```bash
# Build database for California
python -m cli.main build-phone-database --region california --max-per-area 5000

# Build for specific area codes
python -m cli.main build-phone-database --area-codes 617,781,857 --max-per-area 2000

# Reverse lookup with database save
python -m cli.main reverse-lookup 617-555-1234 --save

# Batch lookup from file
python -m cli.main batch-reverse-lookup phones.txt --workers 4 --save

# Search by name
python -m cli.main search-name "John Smith" --limit 20

# Show statistics
python -m cli.main phone-database-stats

# Export all numbers with names
python -m cli.main export-phones --only-names --output phone_owners.csv
```

## 🗺️ Supported Regions

| Region | Area Codes |
|--------|------------|
| `new_england` | 617, 781, 857, 339, 508, 774, 978, 351, 603, 207, 802, 401, 203, 860, 959 |
| `california` | 209, 213, 310, 323, 408, 415, 510, 530, 559, 562, 619, 626, 650, 661, 707, 714, 760, 805, 818, 831, 858, 909, 916, 925, 949, 951 |
| `new_york` | 212, 315, 347, 516, 518, 585, 607, 631, 646, 716, 718, 845, 914, 917, 929 |
| `texas` | 210, 214, 254, 281, 325, 361, 409, 430, 432, 469, 512, 713, 726, 737, 806, 817, 830, 832, 903, 915, 936, 940, 956, 972, 979 |
| `florida` | 239, 305, 321, 352, 386, 407, 561, 689, 727, 754, 772, 786, 813, 850, 863, 904, 941, 954 |

## 🏗️ Architecture

```
services/phone_database/
├── __init__.py      # Module exports
├── generator.py     # Phone number generation
├── validator.py     # PhoneInfoga + Twilio validation
├── database.py      # SQLite operations
├── builder.py       # Bulk processing orchestration
└── README.md        # This file

cli/commands/
└── phone_database.py  # CLI commands
```

## 📊 Database Schema

```sql
CREATE TABLE phone_numbers (
    phone TEXT PRIMARY KEY,           -- Format: XXX-XXX-XXXX
    area_code TEXT NOT NULL,
    exchange TEXT NOT NULL,
    subscriber TEXT NOT NULL,
    carrier TEXT,                     -- e.g., "Verizon Wireless"
    line_type TEXT,                   -- mobile, landline, voip
    country TEXT DEFAULT 'US',
    valid INTEGER DEFAULT 0,
    validated_at TIMESTAMP,
    source TEXT,                      -- phoneinfoga, twilio, web_directory
    confidence REAL DEFAULT 0.0,      -- 0.0 to 1.0
    name TEXT,                        -- Owner name (if found)
    name_normalized TEXT,             -- For search
    name_match INTEGER DEFAULT 0,     -- If name matched target
    name_match_score REAL DEFAULT 0.0,
    location TEXT,
    raw_data TEXT                     -- JSON of full response
);
```

## 💰 Cost Analysis

| Method | Cost | Name Extraction |
|--------|------|-----------------|
| **PhoneInfoga** | **FREE** | ✅ Yes |
| Twilio Lookup | ~$0.005/lookup | ❌ No (carrier only) |
| NumVerify | $0.01/lookup | ❌ No |

**Recommendation**: Use PhoneInfoga exclusively. Twilio is disabled by default.

## ⚡ Performance

On AMD Ryzen 7 9800X3D (8-core):

| Operation | Rate | Notes |
|-----------|------|-------|
| Phone generation | ~100K/sec | Memory efficient generator |
| PhoneInfoga validation | ~10-50/sec | Depends on target availability |
| Database lookup | ~10K/sec | Local SQLite, instant |
| Name search | ~5K/sec | FTS5 full-text search |

## 🔒 Privacy & Legal

- PhoneInfoga uses **publicly available** OSINT sources
- Only collects data that is already public
- Respects rate limits and robots.txt
- No unauthorized access to private systems

## 🐛 Troubleshooting

### PhoneInfoga not found

```bash
# Verify installation
phoneinfoga --version

# If using Docker
docker run sundowndev/phoneinfoga --version
```

### No names found

- Not all phone numbers have public owner information
- Try business landlines (more likely to have public records)
- Mobile numbers are often unlisted/private

### Rate limiting

- Reduce `--workers` to 2-4
- Add delays between batches
- Use `--max-per-area` to limit scope

## 📝 Example Output

```
╔══════════════════════════════════════════════════════════════╗
║  REVERSE LOOKUP RESULT                                       ║
╠══════════════════════════════════════════════════════════════╣
║  Phone:     617-555-1234                                     ║
║  ──────────────────────────────────────────────────────────  ║
║  NAME:                          John Smith                   ║
║  ──────────────────────────────────────────────────────────  ║
║  Carrier:                       Verizon Wireless             ║
║  Line Type:           mobile                                 ║
║  Location:            Boston, MA                             ║
║  Confidence:            0.85                                 ║
║  Source:          phoneinfoga                                ║
╚══════════════════════════════════════════════════════════════╝
```
