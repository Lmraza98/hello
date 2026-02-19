"""
Phone discovery command.
"""
import sys
import asyncio
from services.enrichment.phone.discoverer import process_linkedin_contacts_for_phones


def cmd_discover_phones(args):
    """
    Discover phone numbers for existing contacts using parallel social engineering methods.
    """
    workers = args.workers
    today_only = args.today
    
    print(f"\n=== Phone Discovery ===")
    print(f"Workers: {workers}")
    print(f"Today only: {today_only}")
    print(f"Methods: Crawled pages, Email association, Conference pages, Press releases,")
    print(f"         Industry directories, Web search, Social proof, LLM analysis\n")
    
    try:
        result = asyncio.run(process_linkedin_contacts_for_phones(
            today_only=today_only,
            max_workers=workers
        ))
        
        print("\n[OK] Success!")
        print(f"  Contacts processed: {result['total']}")
        print(f"  Phones found: {result['found']}")
        print(f"  Database updated: {result['updated']}")
        
        if result['found'] > 0:
            success_rate = (result['found'] / result['total']) * 100
            print(f"  Success rate: {success_rate:.1f}%")
                
    except Exception as e:
        print(f"Error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


