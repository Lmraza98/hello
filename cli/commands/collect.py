"""
CLI command for automated company collection from LinkedIn Sales Navigator.
"""
import asyncio
from services.web_automation.linkedin.salesnav.flows.company_collection import collect_companies_from_query


def cmd_collect_companies(args):
    """
    Collect companies from LinkedIn Sales Navigator using a natural language query.
    
    Example:
        python -m cli.main collect "Construction companies in New England" --max-companies 100
    """
    query = args.query
    max_companies = args.max_companies
    headless = args.headless
    save_to_db = not args.no_save
    
    print(f"\n{'='*60}")
    print(f"  AUTOMATED COMPANY COLLECTION")
    print(f"{'='*60}")
    print(f"  Query: {query}")
    print(f"  Max companies: {max_companies}")
    print(f"  Headless: {headless}")
    print(f"  Save to DB: {save_to_db}")
    print(f"{'='*60}\n")
    
    try:
        result = asyncio.run(collect_companies_from_query(
            query=query,
            max_companies=max_companies,
            headless=headless,
            save_to_db=save_to_db
        ))
        
        print(f"\n{'='*60}")
        print(f"  COLLECTION COMPLETE")
        print(f"{'='*60}")
        print(f"  Status: {result.get('status')}")
        print(f"  Companies found: {len(result.get('companies', []))}")
        
        if result.get('saved_count'):
            print(f"  Companies saved: {result.get('saved_count')}")
        
        if result.get('error'):
            print(f"  Error: {result.get('error')}")
        
        if result.get('filters_applied'):
            print(f"\n  Filters applied:")
            filters = result.get('filters_applied', {})
            for key, value in filters.items():
                if value:
                    print(f"    - {key}: {value}")
        
        print(f"{'='*60}\n")
        
        # Show first few companies
        companies = result.get('companies', [])
        if companies:
            print(f"  First {min(5, len(companies))} companies:")
            for i, company in enumerate(companies[:5], 1):
                print(f"    {i}. {company.get('company_name')} - {company.get('industry', 'N/A')} ({company.get('employee_count', 'N/A')} employees)")
            if len(companies) > 5:
                print(f"    ... and {len(companies) - 5} more")
            print()
        
    except KeyboardInterrupt:
        print("\n[Interrupted] Collection cancelled by user")
    except Exception as e:
        print(f"\n[Error] Collection failed: {e}")
        import traceback
        traceback.print_exc()
