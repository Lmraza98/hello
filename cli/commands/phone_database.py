"""
CLI commands for Phone Number Database.

Commands:
- build-phone-database: Generate and validate phone numbers for area codes
- phone-database-stats: Show database statistics
- lookup-phone: Lookup a phone number in the database
- reverse-lookup: Find owner name for a phone number using PhoneInfoga
- search-name: Search database by owner name
- export-phones: Export database to CSV
"""
import asyncio
import sys
import re
from services.phone_database import (
    build_phone_database_for_region,
    reverse_lookup_phones,
    PhoneDatabase
)
from services.phone_database.generator import get_us_area_codes_by_region
from services.phone_database.validator import reverse_lookup_phone, validate_and_enrich_phone


def cmd_build_phone_database(args):
    """Build phone number database for specified area codes using PhoneInfoga Docker."""
    
    # Parse area codes
    area_codes = []
    
    if args.region:
        # Use predefined region
        regions = get_us_area_codes_by_region()
        if args.region.lower() in regions:
            area_codes = regions[args.region.lower()]
            print(f"[PhoneDB] Using region '{args.region}' with {len(area_codes)} area codes")
            print(f"[PhoneDB] Area codes: {', '.join(area_codes)}")
        else:
            print(f"[PhoneDB] Error: Unknown region '{args.region}'")
            print(f"[PhoneDB] Available regions: {', '.join(regions.keys())}")
            sys.exit(1)
    elif args.area_codes:
        # Use provided area codes
        area_codes = args.area_codes.split(',')
        area_codes = [ac.strip() for ac in area_codes]
        print(f"[PhoneDB] Using {len(area_codes)} area codes: {', '.join(area_codes)}")
    else:
        print("[PhoneDB] Error: Must specify --region or --area-codes")
        print("[PhoneDB] Example: --region new_england")
        print("[PhoneDB] Example: --area-codes 617,781,857")
        sys.exit(1)
    
    # Validate area codes
    valid_area_codes = []
    for ac in area_codes:
        if re.match(r'^\d{3}$', ac):
            valid_area_codes.append(ac)
        else:
            print(f"[PhoneDB] Warning: Invalid area code format '{ac}', skipping")
    
    if not valid_area_codes:
        print("[PhoneDB] Error: No valid area codes provided")
        sys.exit(1)
    
    area_codes = valid_area_codes
    
    # Calculate estimates
    total_numbers = len(area_codes) * args.max_per_area
    est_time = (total_numbers * args.delay) / 3600
    
    print(f"")
    print(f"[PhoneDB] ===================================================")
    print(f"[PhoneDB] Building phone database via PhoneInfoga Docker...")
    print(f"[PhoneDB] ")
    print(f"[PhoneDB]   Area codes:       {len(area_codes)}")
    print(f"[PhoneDB]   Max per area:     {args.max_per_area:,}")
    print(f"[PhoneDB]   Total numbers:    {total_numbers:,}")
    print(f"[PhoneDB]   Parallel workers: {args.workers}")
    print(f"[PhoneDB]   Request delay:    {args.delay}s (rate limiting)")
    print(f"[PhoneDB]   Est. time:        {est_time:.1f} hours")
    print(f"[PhoneDB]   PhoneInfoga:      ENABLED via Docker (free)")
    print(f"[PhoneDB]   Twilio:           {'ENABLED' if args.use_twilio else 'DISABLED'}")
    if args.resume > 0:
        print(f"[PhoneDB]   Resuming from:   {args.resume:,}")
    print(f"[PhoneDB] ===================================================")
    print(f"")
    
    try:
        from services.phone_database.builder import PhoneDatabaseBuilder
        
        builder = PhoneDatabaseBuilder(
            db_path=args.output,
            max_workers=args.workers,
            use_twilio=args.use_twilio,
            twilio_limit=args.twilio_limit,
            request_delay=args.delay
        )
        
        results = asyncio.run(builder.build_for_area_codes(
            area_codes=area_codes,
            max_per_area=args.max_per_area,
            start_offset=args.resume
        ))
        
        print(f"")
        print(f"[PhoneDB] [OK] Database build complete!")
        print(f"[PhoneDB]   Database: {results['database_path']}")
        print(f"[PhoneDB]   Valid numbers: {results.get('valid_count', 0):,}")
        print(f"[PhoneDB]   Names found: {results.get('names_found', 0):,}")
        
    except KeyboardInterrupt:
        print(f"\n[PhoneDB] Build interrupted!")
        print(f"[PhoneDB] To resume, use: --resume {args.resume + builder.total_processed if 'builder' in dir() else args.resume}")
        sys.exit(1)
    except Exception as e:
        print(f"[PhoneDB] Error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


def cmd_phone_database_stats(args):
    """Show comprehensive phone database statistics."""
    db = PhoneDatabase(args.database)
    stats = db.get_stats()
    
    print(f"")
    print(f"================================================================")
    print(f"  PHONE DATABASE STATISTICS")
    print(f"================================================================")
    print(f"  Database: {stats['database_path']}")
    print(f"")
    print(f"  COUNTS:")
    print(f"    Total numbers:       {stats['total_numbers']:>10,}")
    print(f"    Valid numbers:       {stats['valid_numbers']:>10,}")
    print(f"    Numbers with names:  {stats['numbers_with_names']:>10,}")
    print(f"    Confirmed matches:   {stats['confirmed_name_matches']:>10,}")
    print(f"")
    print(f"  COVERAGE:")
    print(f"    Area codes:          {stats['area_codes_covered']:>10,}")
    print(f"    Unique carriers:     {stats['unique_carriers']:>10,}")
    print(f"")
    print(f"  QUALITY:")
    print(f"    Avg confidence:      {stats['average_confidence']:>10.3f}")
    print(f"    High confidence:     {stats['high_confidence_count']:>10,}")
    print(f"================================================================")
    
    # Line type breakdown
    if stats.get('line_type_breakdown'):
        print(f"")
        print(f"  Line Types:")
        for line_type, count in stats['line_type_breakdown'].items():
            print(f"    {line_type:15} {count:>8,}")
    
    # Top area codes
    if stats.get('top_area_codes'):
        print(f"")
        print(f"  Top Area Codes:")
        for area_code, count in list(stats['top_area_codes'].items())[:5]:
            print(f"    {area_code:15} {count:>8,}")
    
    # Top carriers
    if stats.get('top_carriers'):
        print(f"")
        print(f"  Top Carriers:")
        for carrier, count in list(stats['top_carriers'].items())[:5]:
            print(f"    {carrier[:20]:20} {count:>8,}")
    
    print(f"")


def cmd_lookup_phone(args):
    """Lookup a phone number in the local database."""
    db = PhoneDatabase(args.database)
    result = db.lookup(args.phone)
    
    if result:
        print(f"")
        print(f"  PHONE LOOKUP RESULT")
        print(f"  -------------------")
        print(f"  Phone:      {result['phone']}")
        print(f"  Name:       {result.get('name') or 'Not found'}")
        print(f"  Carrier:    {result.get('carrier') or 'Unknown'}")
        print(f"  Line Type:  {result.get('line_type') or 'Unknown'}")
        print(f"  Location:   {result.get('location') or 'Unknown'}")
        print(f"  Valid:      {'Yes' if result.get('valid') else 'No'}")
        print(f"  Confidence: {result.get('confidence', 0):.2f}")
        print(f"  Source:     {result.get('source') or 'Unknown'}")
    else:
        print(f"[PhoneDB] Phone number '{args.phone}' not found in local database")
        print(f"[PhoneDB] Try: reverse-lookup {args.phone} (uses PhoneInfoga OSINT)")


def cmd_reverse_lookup(args):
    """Reverse lookup a phone number using PhoneInfoga (OSINT)."""
    print(f"[PhoneDB] Reverse lookup for: {args.phone}")
    print(f"[PhoneDB] Using PhoneInfoga (free OSINT)...")
    print(f"")
    
    try:
        result = asyncio.run(reverse_lookup_phone(args.phone))
        
        if result and result.get('name'):
            print(f"  REVERSE LOOKUP RESULT")
            print(f"  ---------------------")
            print(f"  Phone:      {args.phone}")
            print(f"  ")
            print(f"  >>> NAME:   {result.get('name', 'Unknown')}")
            print(f"  ")
            print(f"  Carrier:    {result.get('carrier') or 'Unknown'}")
            print(f"  Line Type:  {result.get('line_type') or 'Unknown'}")
            print(f"  Location:   {result.get('location') or 'Unknown'}")
            print(f"  Confidence: {result.get('confidence', 0):.2f}")
            print(f"  Source:     {result.get('source', 'phoneinfoga')}")
            
            # Save to database if requested
            if args.save:
                db = PhoneDatabase(args.database)
                db.insert(result)
                print(f"[PhoneDB] [OK] Saved to database")
        else:
            print(f"[PhoneDB] [X] No owner information found for {args.phone}")
            print(f"[PhoneDB]   The number may be:")
            print(f"[PhoneDB]   - Unlisted/private")
            print(f"[PhoneDB]   - Not in public records")
            print(f"[PhoneDB]   - A business line")
            
            # Still show whatever we found
            if result:
                print(f"")
                print(f"[PhoneDB] Partial information found:")
                if result.get('carrier'):
                    print(f"[PhoneDB]   Carrier: {result['carrier']}")
                if result.get('line_type'):
                    print(f"[PhoneDB]   Line type: {result['line_type']}")
                if result.get('location'):
                    print(f"[PhoneDB]   Location: {result['location']}")
    
    except Exception as e:
        print(f"[PhoneDB] Error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


def cmd_search_name(args):
    """Search database by owner name."""
    db = PhoneDatabase(args.database)
    results = db.search_by_name(args.name, limit=args.limit)
    
    if results:
        print(f"")
        print(f"[PhoneDB] Found {len(results)} results for '{args.name}':")
        print(f"")
        print(f"  {'Phone':<15} {'Name':<25} {'Carrier':<20} {'Conf':>6}")
        print(f"  {'-'*15} {'-'*25} {'-'*20} {'-'*6}")
        
        for r in results:
            name = (r.get('name') or 'Unknown')[:24]
            carrier = (r.get('carrier') or 'Unknown')[:19]
            conf = r.get('confidence', 0)
            print(f"  {r['phone']:<15} {name:<25} {carrier:<20} {conf:>6.2f}")
        
        print(f"")
    else:
        print(f"[PhoneDB] No results found for '{args.name}'")


def cmd_export_phones(args):
    """Export phone database to CSV."""
    db = PhoneDatabase(args.database)
    
    output_path = args.output or 'phone_export.csv'
    
    print(f"[PhoneDB] Exporting to {output_path}...")
    count = db.export_csv(output_path, include_only_names=args.only_names)
    
    if count > 0:
        print(f"[PhoneDB] [OK] Exported {count:,} records to {output_path}")
    else:
        print(f"[PhoneDB] No records to export")


def cmd_batch_reverse_lookup(args):
    """Batch reverse lookup from file."""
    # Read phone numbers from file
    try:
        with open(args.file, 'r') as f:
            phones = [line.strip() for line in f if line.strip()]
    except FileNotFoundError:
        print(f"[PhoneDB] Error: File not found: {args.file}")
        sys.exit(1)
    
    if not phones:
        print(f"[PhoneDB] No phone numbers found in {args.file}")
        sys.exit(1)
    
    print(f"[PhoneDB] Loaded {len(phones)} phone numbers from {args.file}")
    print(f"[PhoneDB] Starting batch reverse lookup...")
    print(f"")
    
    try:
        results = asyncio.run(reverse_lookup_phones(
            phones,
            db_path=args.database,
            max_workers=args.workers,
            save_to_db=args.save
        ))
        
        names_found = sum(1 for r in results if r.get('name'))
        
        print(f"")
        print(f"[PhoneDB] ===================================================")
        print(f"[PhoneDB] Batch lookup complete!")
        print(f"[PhoneDB]   Total numbers:  {len(phones)}")
        print(f"[PhoneDB]   Names found:    {names_found}")
        print(f"[PhoneDB]   Success rate:   {(names_found/len(phones)*100):.1f}%")
        print(f"[PhoneDB] ===================================================")
        
    except Exception as e:
        print(f"[PhoneDB] Error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


def cmd_show_names(args):
    """Show all phone numbers with identified owner names."""
    db = PhoneDatabase(args.database)
    results = db.get_numbers_with_names(limit=args.limit, min_confidence=args.min_confidence)
    
    if results:
        print(f"")
        print(f"[PhoneDB] Phone numbers with identified owners:")
        print(f"")
        print(f"  {'Phone':<15} {'Name':<30} {'Carrier':<15} {'Conf':>6}")
        print(f"  {'-'*15} {'-'*30} {'-'*15} {'-'*6}")
        
        for r in results:
            name = (r.get('name') or 'Unknown')[:29]
            carrier = (r.get('carrier') or 'Unknown')[:14]
            conf = r.get('confidence', 0)
            print(f"  {r['phone']:<15} {name:<30} {carrier:<15} {conf:>6.2f}")
        
        print(f"")
        print(f"[PhoneDB] Total: {len(results)} numbers with names")
    else:
        print(f"[PhoneDB] No phone numbers with owner names found")
        print(f"[PhoneDB] Try running: build-phone-database --region new_england")


def setup_phone_database_commands(subparsers):
    """Setup all phone database CLI commands."""
    
    # build-phone-database
    build_parser = subparsers.add_parser(
        'build-phone-database',
        help='Build phone number database with PhoneInfoga Docker (free OSINT)'
    )
    build_parser.add_argument('--region', type=str,
        help='Region name (new_england, california, new_york, texas, florida)')
    build_parser.add_argument('--area-codes', type=str,
        help='Comma-separated area codes (e.g., 617,781,857)')
    build_parser.add_argument('--max-per-area', type=int, default=1000,
        help='Max numbers per area code (default: 1000)')
    build_parser.add_argument('--workers', type=int, default=4,
        help='Parallel Docker containers (default: 4)')
    build_parser.add_argument('--delay', type=float, default=0.5,
        help='Delay between requests in seconds (default: 0.5 for rate limiting)')
    build_parser.add_argument('--resume', type=int, default=0,
        help='Resume from this number offset (for continuing interrupted builds)')
    build_parser.add_argument('--use-twilio', action='store_true',
        help='Enable Twilio (costs money, disabled by default)')
    build_parser.add_argument('--twilio-limit', type=int, default=900,
        help='Twilio lookup limit (default: 900)')
    build_parser.add_argument('--output', type=str,
        help='Database output path')
    build_parser.set_defaults(func=cmd_build_phone_database)
    
    # phone-database-stats
    stats_parser = subparsers.add_parser(
        'phone-database-stats',
        help='Show phone database statistics'
    )
    stats_parser.add_argument('--database', type=str,
        help='Database path')
    stats_parser.set_defaults(func=cmd_phone_database_stats)
    
    # lookup-phone
    lookup_parser = subparsers.add_parser(
        'lookup-phone',
        help='Lookup phone in local database'
    )
    lookup_parser.add_argument('phone', type=str,
        help='Phone number to lookup')
    lookup_parser.add_argument('--database', type=str,
        help='Database path')
    lookup_parser.set_defaults(func=cmd_lookup_phone)
    
    # reverse-lookup
    reverse_parser = subparsers.add_parser(
        'reverse-lookup',
        help='Reverse lookup using PhoneInfoga (free OSINT)'
    )
    reverse_parser.add_argument('phone', type=str,
        help='Phone number to lookup')
    reverse_parser.add_argument('--save', action='store_true',
        help='Save result to database')
    reverse_parser.add_argument('--database', type=str,
        help='Database path')
    reverse_parser.set_defaults(func=cmd_reverse_lookup)
    
    # batch-reverse-lookup
    batch_parser = subparsers.add_parser(
        'batch-reverse-lookup',
        help='Batch reverse lookup from file'
    )
    batch_parser.add_argument('file', type=str,
        help='File with phone numbers (one per line)')
    batch_parser.add_argument('--workers', type=int, default=4,
        help='Parallel workers (default: 4 to avoid rate limits)')
    batch_parser.add_argument('--save', action='store_true', default=True,
        help='Save results to database (default: true)')
    batch_parser.add_argument('--database', type=str,
        help='Database path')
    batch_parser.set_defaults(func=cmd_batch_reverse_lookup)
    
    # search-name
    search_parser = subparsers.add_parser(
        'search-name',
        help='Search database by owner name'
    )
    search_parser.add_argument('name', type=str,
        help='Name to search for')
    search_parser.add_argument('--limit', type=int, default=10,
        help='Max results (default: 10)')
    search_parser.add_argument('--database', type=str,
        help='Database path')
    search_parser.set_defaults(func=cmd_search_name)
    
    # show-names
    names_parser = subparsers.add_parser(
        'show-names',
        help='Show all numbers with identified owner names'
    )
    names_parser.add_argument('--limit', type=int, default=50,
        help='Max results (default: 50)')
    names_parser.add_argument('--min-confidence', type=float, default=0.5,
        help='Minimum confidence (default: 0.5)')
    names_parser.add_argument('--database', type=str,
        help='Database path')
    names_parser.set_defaults(func=cmd_show_names)
    
    # export-phones
    export_parser = subparsers.add_parser(
        'export-phones',
        help='Export phone database to CSV'
    )
    export_parser.add_argument('--output', type=str,
        help='Output file path (default: phone_export.csv)')
    export_parser.add_argument('--only-names', action='store_true',
        help='Only export records with owner names')
    export_parser.add_argument('--database', type=str,
        help='Database path')
    export_parser.set_defaults(func=cmd_export_phones)
