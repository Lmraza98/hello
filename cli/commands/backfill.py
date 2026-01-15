"""
Backfill missing LinkedIn profile URLs for existing contacts.
"""
import asyncio
import database as db
import config


def cmd_backfill_linkedin_urls(args):
    """
    Backfill missing LinkedIn profile URLs for contacts that were scraped
    but don't have public /in/ URLs.
    """
    limit = args.limit if hasattr(args, 'limit') else 100
    company_filter = args.company if hasattr(args, 'company') else None
    
    print(f"\n=== Backfill LinkedIn URLs ===")
    
    # Find contacts missing public URLs
    with db.get_db() as conn:
        cursor = conn.cursor()
        
        query = """
            SELECT id, name, company_name, title, linkedin_url
            FROM linkedin_contacts 
            WHERE (linkedin_url IS NULL 
                   OR linkedin_url = '' 
                   OR linkedin_url LIKE '%/sales/lead/%'
                   OR linkedin_url LIKE '%/sales/people/%')
        """
        params = []
        
        if company_filter:
            query += " AND company_name = ?"
            params.append(company_filter)
        
        query += " ORDER BY company_name, name LIMIT ?"
        params.append(limit)
        
        cursor.execute(query, params)
        contacts = [dict(row) for row in cursor.fetchall()]
    
    if not contacts:
        print("No contacts found with missing LinkedIn URLs.")
        return
    
    # Group by company
    companies = {}
    for contact in contacts:
        company = contact['company_name'] or 'Unknown'
        if company not in companies:
            companies[company] = []
        companies[company].append(contact)
    
    print(f"Found {len(contacts)} contacts across {len(companies)} companies:\n")
    for company, company_contacts in companies.items():
        print(f"  {company}: {len(company_contacts)} contacts")
    
    print(f"\nStarting backfill...\n")
    
    # Run the async backfill
    asyncio.run(_backfill_urls(companies))


async def _backfill_urls(companies: dict):
    """
    Backfill LinkedIn URLs using Sales Navigator.
    Opens each company's decision makers and extracts public URLs.
    """
    from services.linkedin.scraper import SalesNavigatorScraper
    from services.linkedin.contacts import update_contact_linkedin_url
    import random
    
    scraper = SalesNavigatorScraper()
    
    try:
        await scraper.start(headless=False)
        
        if not scraper.is_authenticated:
            print("\n" + "="*60)
            print("  LINKEDIN LOGIN REQUIRED")
            print("  1. Log in to LinkedIn in the browser window")
            print("  2. Navigate to Sales Navigator")
            print(f"  You have {config.LINKEDIN_TIMEOUT_MINUTES} minutes.")
            print("="*60 + "\n")
            
            if not await scraper.wait_for_login():
                print("Login timeout. Aborting.")
                return
        
        print("✓ Authenticated to Sales Navigator\n")
        
        total_found = 0
        total_processed = 0
        
        for company_name, contacts in companies.items():
            print(f"\n[{company_name}] Processing {len(contacts)} contacts...")
            
            # Search for the company in Sales Navigator
            company_url = await scraper.search_company(company_name)
            
            if not company_url:
                print(f"  ✗ Company not found in Sales Navigator")
                continue
            
            # Click Decision Makers to get to the people list
            if not await scraper.click_decision_makers():
                print(f"  ✗ Could not access decision makers")
                continue
            
            # Wait for results to load
            await asyncio.sleep(3)
            
            # Now we're on the search results - try to find each contact
            for contact in contacts:
                contact_name = contact['name']
                contact_id = contact['id']
                
                try:
                    # Search for this person's card on the page
                    cards = scraper.page.locator('[data-x-search-result="LEAD"]')
                    count = await cards.count()
                    
                    found_url = None
                    
                    for i in range(count):
                        card = cards.nth(i)
                        
                        # Check if this card matches the contact name
                        name_el = card.locator('[data-anonymize="person-name"]').first
                        if await name_el.count() > 0:
                            card_name = (await name_el.text_content() or '').strip()
                            
                            # Fuzzy match - check if names are similar
                            if _names_match(contact_name, card_name):
                                # Found the card - extract public URL
                                await card.scroll_into_view_if_needed()
                                await asyncio.sleep(0.5)
                                
                                public_url = await scraper.extract_public_linkedin_url(card, contact_name)
                                
                                if public_url:
                                    found_url = public_url
                                    break
                    
                    if found_url:
                        # Update database
                        update_contact_linkedin_url(contact_id, found_url)
                        print(f"  ✓ {contact_name}: {found_url}")
                        total_found += 1
                    else:
                        print(f"  ○ {contact_name}: not found on page")
                    
                    total_processed += 1
                    await asyncio.sleep(random.uniform(1, 2))
                    
                except Exception as e:
                    print(f"  ✗ {contact_name}: error - {e}")
                    continue
        
        print(f"\n=== Backfill Complete ===")
        print(f"  Processed: {total_processed}")
        print(f"  URLs found: {total_found}")
        
    finally:
        await scraper.stop()


def _names_match(name1: str, name2: str) -> bool:
    """Check if two names likely refer to the same person."""
    if not name1 or not name2:
        return False
    
    # Normalize
    n1 = name1.lower().strip()
    n2 = name2.lower().strip()
    
    # Exact match
    if n1 == n2:
        return True
    
    # Check if first and last name match
    parts1 = n1.split()
    parts2 = n2.split()
    
    if len(parts1) >= 2 and len(parts2) >= 2:
        # First name and last name match
        if parts1[0] == parts2[0] and parts1[-1] == parts2[-1]:
            return True
    
    # One name contains the other
    if n1 in n2 or n2 in n1:
        return True
    
    return False

