"""
Hello - Lead Generation CLI

Commands:
  scrape-and-enrich   Scrape LinkedIn for contacts and generate emails (3 parallel browsers)
  discover-emails     Run email discovery on existing contacts
  discover-phones     Discover phone numbers for existing contacts
  init                Initialize database
  status              Show status
  collect             Collect companies from LinkedIn Sales Navigator
  
Phone Database Commands (PhoneInfoga OSINT - FREE):
  build-phone-database   Build phone database for area codes
  phone-database-stats   Show database statistics
  lookup-phone           Lookup phone in local database
  reverse-lookup         Reverse lookup using PhoneInfoga (find owner name)
  batch-reverse-lookup   Batch reverse lookup from file
  search-name            Search database by owner name
  show-names             Show all numbers with identified owner names
  export-phones          Export database to CSV
"""
import argparse
import sys

from cli.commands import init, scrape, emails, status, phones, collect, backfill
from cli.commands.phone_database import setup_phone_database_commands
from cli.commands.db import setup_db_commands


def main():
    parser = argparse.ArgumentParser(
        description="Hello Lead Engine CLI",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Phone Database Commands (PhoneInfoga - FREE OSINT):
  build-phone-database   Build phone database for area codes
  phone-database-stats   Show database statistics  
  lookup-phone           Lookup phone in local database
  reverse-lookup         Reverse lookup using PhoneInfoga (find owner name)
  batch-reverse-lookup   Batch reverse lookup from file
  search-name            Search database by owner name
  show-names             Show all numbers with identified owner names
  export-phones          Export database to CSV

Examples:
  hello build-phone-database --region new_england --max-per-area 1000
  hello reverse-lookup 617-555-1234 --save
  hello search-name "John Smith"
  hello show-names --limit 50
"""
    )
    subparsers = parser.add_subparsers(dest='command', help='Commands')
    
    # init
    init_parser = subparsers.add_parser('init', help='Initialize database')
    init_parser.set_defaults(func=init.cmd_init)
    
    # scrape-and-enrich
    scrape_parser = subparsers.add_parser('scrape-and-enrich', 
        help='Scrape LinkedIn for contacts and generate emails')
    scrape_parser.add_argument('--tier', '-t', help='Filter by tier (A, B, C)')
    scrape_parser.add_argument('--max-contacts', '-m', type=int, default=25,
        help='Max contacts per company (default: 25)')
    scrape_parser.add_argument('--no-profile-urls', action='store_true',
        help='Skip public LinkedIn URL extraction (faster, less error-prone)')
    scrape_parser.set_defaults(func=scrape.cmd_scrape_and_enrich)
    
    # discover-emails
    email_parser = subparsers.add_parser('discover-emails',
        help='Run email discovery on existing contacts')
    email_parser.add_argument('--workers', '-w', type=int, default=5,
        help='Number of parallel workers (default: 5)')
    email_parser.add_argument('--today', action='store_true',
        help="Only process today's contacts")
    email_parser.set_defaults(func=emails.cmd_discover_emails)
    
    # discover-phones
    phone_parser = subparsers.add_parser('discover-phones',
        help='Discover phone numbers for existing contacts')
    phone_parser.add_argument('--workers', '-w', type=int, default=10,
        help='Number of parallel workers (default: 10)')
    phone_parser.add_argument('--today', action='store_true',
        help="Only process today's contacts")
    phone_parser.set_defaults(func=phones.cmd_discover_phones)
    
    # status
    status_parser = subparsers.add_parser('status', help='Show pipeline status')
    status_parser.set_defaults(func=status.cmd_status)
    
    # collect
    collect_parser = subparsers.add_parser('collect',
        help='Automatically collect companies from LinkedIn Sales Navigator')
    collect_parser.add_argument('query', type=str,
        help='Natural language query (e.g., "Construction companies in New England")')
    collect_parser.add_argument('--max-companies', '-m', type=int, default=100,
        help='Maximum number of companies to collect (default: 100)')
    collect_parser.add_argument('--headless', action='store_true',
        help='Run browser in headless mode')
    collect_parser.add_argument('--no-save', action='store_true',
        help='Do not save companies to database')
    collect_parser.set_defaults(func=collect.cmd_collect_companies)
    
    # backfill-urls
    backfill_parser = subparsers.add_parser('backfill-urls',
        help='Backfill missing LinkedIn profile URLs for existing contacts')
    backfill_parser.add_argument('--company', '-c', type=str,
        help='Only backfill for a specific company')
    backfill_parser.add_argument('--limit', '-l', type=int, default=100,
        help='Maximum contacts to process (default: 100)')
    backfill_parser.set_defaults(func=backfill.cmd_backfill_linkedin_urls)
    
    # Setup all phone database commands
    setup_phone_database_commands(subparsers)
    
    # Setup database utility commands
    setup_db_commands(subparsers)
    
    args = parser.parse_args()
    
    if args.command is None:
        parser.print_help()
        return
    
    args.func(args)


if __name__ == "__main__":
    main()
