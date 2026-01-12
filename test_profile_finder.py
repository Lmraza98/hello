"""
Test script for LinkedIn Profile URL Finder.
Finds LinkedIn URLs for contacts that don't have real /in/ URLs.
"""
import asyncio
import database as db
from services.linkedin_scraper import LinkedInProfileFinder, update_contact_linkedin_url


async def test_profile_finder():
    """Test the profile finder on existing contacts without real LinkedIn URLs."""
    
    # Get contacts that DON'T have a proper /in/ LinkedIn URL yet
    with db.get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT id, name, company_name, title, linkedin_url
            FROM linkedin_contacts 
            WHERE linkedin_url IS NULL 
               OR linkedin_url = ''
               OR (linkedin_url NOT LIKE '%/in/%' AND linkedin_url LIKE '%/sales/%')
            LIMIT 10
        """)
        contacts = cursor.fetchall()
    
    if not contacts:
        print("No contacts found needing LinkedIn URLs!")
        return
    
    print(f"\n{'='*60}")
    print(f"  LinkedIn Profile Finder Test")
    print(f"  Contacts to process: {len(contacts)}")
    print(f"{'='*60}\n")
    
    for c in contacts:
        print(f"  - {c['name']} @ {c['company_name']}")
    
    print("")
    
    # Start the profile finder
    finder = LinkedInProfileFinder()
    
    try:
        print("Starting browser...")
        await finder.start(headless=False)
        
        if not finder.is_authenticated:
            print("\nNeed to log in to LinkedIn...")
            authenticated = await finder.wait_for_login(timeout_minutes=3)
            if not authenticated:
                print("Login failed or timed out!")
                return
        
        print("\n[OK] Authenticated! Starting profile searches...\n")
        print("-" * 60)
        
        found = 0
        for i, contact in enumerate(contacts, 1):
            contact_id = contact['id']
            name = contact['name']
            company = contact['company_name']
            
            print(f"\n[{i}/{len(contacts)}] {name} @ {company}")
            
            profile_url = await finder.find_profile_url(name, company)
            
            if profile_url:
                update_contact_linkedin_url(contact_id, profile_url)
                print(f"    --> SAVED: {profile_url}")
                found += 1
            else:
                print(f"    --> NOT FOUND")
            
            # Small delay between searches
            await asyncio.sleep(2)
        
        print("\n" + "="*60)
        print(f"  RESULTS: Found {found}/{len(contacts)} LinkedIn profiles")
        print("="*60)
        
    except Exception as e:
        print(f"\nError: {e}")
        import traceback
        traceback.print_exc()
    finally:
        await finder.stop()
        print("\nBrowser closed.")


if __name__ == "__main__":
    asyncio.run(test_profile_finder())

