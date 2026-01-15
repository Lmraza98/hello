"""
Email discovery command.
"""
import sys
from services.email_discoverer import process_linkedin_contacts_with_patterns


def cmd_discover_emails(args):
    """
    Discover email patterns and generate addresses for existing contacts.
    """
    workers = args.workers
    today_only = args.today
    
    print(f"\n=== Email Discovery ===")
    print(f"Workers: {workers}")
    print(f"Today only: {today_only}\n")
    
    try:
        result = process_linkedin_contacts_with_patterns(
            today_only=today_only,
            workers=workers
        )
        
        print(f"\n✓ Success!")
        print(f"  Contacts processed: {result['contacts']}")
        print(f"  Companies: {result['companies']}")
        print(f"  Output: {result['output_path']}")
        
        # Show pattern summary
        if result.get('patterns'):
            print("\nPatterns discovered:")
            for company, info in list(result['patterns'].items())[:5]:
                domain_mark = "✓" if info.get('domain_discovered') else "?"
                print(f"  {company}: {info['pattern']} @ {info.get('domain', 'unknown')} [{domain_mark}]")
            if len(result['patterns']) > 5:
                print(f"  ... and {len(result['patterns']) - 5} more")
                
    except Exception as e:
        print(f"Error: {e}")
        sys.exit(1)


