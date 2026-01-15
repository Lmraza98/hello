"""
Phone Database Module - Production Quality

A comprehensive system for phone number validation, OSINT enrichment, and storage.
Prioritizes PhoneInfoga (FREE) for name extraction over Twilio (paid).

Components:
- generator: Generate phone numbers for specific area codes
- validator: Validate and enrich phone numbers using PhoneInfoga/Twilio
- database: SQLite storage with fast lookups
- builder: Orchestrate bulk operations with parallel processing

Key Features:
- PhoneInfoga integration for FREE name extraction
- Parallel processing optimized for multi-core CPUs (8 workers for 8-core)
- SQLite database with FTS5 for fast name search
- Twilio support (optional, disabled by default to avoid costs)
- CLI commands for all operations

Usage:
    # Build database for area codes
    from services.phone_database import build_phone_database_for_region
    await build_phone_database_for_region(["617", "781"], max_per_area=1000)
    
    # Lookup phone number
    from services.phone_database import PhoneDatabase
    db = PhoneDatabase()
    result = db.lookup("617-555-1234")
    
    # Reverse lookup (find name)
    from services.phone_database import reverse_lookup_phone
    result = await reverse_lookup_phone("617-555-1234")
    
    # Validate and enrich
    from services.phone_database import validate_and_enrich_phone
    result = await validate_and_enrich_phone("617-555-1234")
"""

# Database
from .database import (
    PhoneDatabase,
    lookup_phone_in_database,
    search_name_in_database,
)

# Validator (PhoneInfoga prioritized)
from .validator import (
    validate_and_enrich_phone,
    enrich_phone_via_phoneinfoga,
    validate_phone_via_twilio,
    reverse_lookup_phone,
    batch_reverse_lookup,
)

# Generator
from .generator import (
    generate_phone_numbers_for_area_code,
    generate_phone_numbers_for_region,
    get_us_area_codes_by_region,
    get_all_us_area_codes,
)

# Builder
from .builder import (
    PhoneDatabaseBuilder,
    build_phone_database_for_region,
    bulk_validate_phones_parallel,
    reverse_lookup_phones,
)

__all__ = [
    # Database
    'PhoneDatabase',
    'lookup_phone_in_database',
    'search_name_in_database',
    
    # Validator
    'validate_and_enrich_phone',
    'enrich_phone_via_phoneinfoga',
    'validate_phone_via_twilio',
    'reverse_lookup_phone',
    'batch_reverse_lookup',
    
    # Generator
    'generate_phone_numbers_for_area_code',
    'generate_phone_numbers_for_region',
    'get_us_area_codes_by_region',
    'get_all_us_area_codes',
    
    # Builder
    'PhoneDatabaseBuilder',
    'build_phone_database_for_region',
    'bulk_validate_phones_parallel',
    'reverse_lookup_phones',
]
