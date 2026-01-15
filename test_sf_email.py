"""
Test script for Salesforce email sending flow.
Run this directly: python test_sf_email.py

This script will:
1. Open a browser
2. Let you log in to Salesforce (with unlimited time)
3. Search for a Lead by email
4. Open email composer and select your Footer template
5. Fill in test content
6. Leave browser open for YOU to review and send manually
"""
import asyncio
import sys

# Add project root to path
sys.path.insert(0, '.')

import database as db
from services.salesforce_sender import SalesforceSender

async def test_with_contact():
    """Test the email flow by searching for a lead."""
    print("=" * 60)
    print("SALESFORCE EMAIL SENDER - TEST")
    print("=" * 60)
    print("\nThis will search for a Lead in Salesforce and prepare an email.")
    print("You will click Send yourself - NO auto-sending.")
    print("=" * 60)
    
    # Option to pick from database or enter manually
    print("\nOptions:")
    print("1. Pick a contact from your database")
    print("2. Enter email/name manually")
    choice = input("\nChoice (1 or 2): ").strip()
    
    if choice == "1":
        # Get recent contacts from database
        try:
            contacts = db.get_contacts_ready_for_email(limit=10)
            if not contacts:
                # Fallback: get any contacts with email
                conn = db.get_connection()
                cursor = conn.cursor()
                cursor.execute("""
                    SELECT id, name, email_generated, company_name 
                    FROM linkedin_contacts 
                    WHERE email_generated IS NOT NULL 
                    ORDER BY scraped_at DESC LIMIT 10
                """)
                rows = cursor.fetchall()
                conn.close()
                contacts = [{'contact_id': r[0], 'contact_name': r[1], 'email': r[2], 'company_name': r[3]} for r in rows]
            
            if not contacts:
                print("\nNo contacts found in database!")
                return
            
            print("\nRecent contacts:")
            for i, c in enumerate(contacts, 1):
                print(f"  {i}. {c.get('contact_name', 'Unknown')} - {c.get('email', 'No email')} ({c.get('company_name', '')})")
            
            idx = input("\nEnter number to select (or 0 to cancel): ").strip()
            if idx == "0" or not idx:
                return
            
            contact = contacts[int(idx) - 1]
            email = contact.get('email')
            name = contact.get('contact_name', '')
            company = contact.get('company_name', '')
            
        except Exception as e:
            print(f"\nError reading database: {e}")
            return
    else:
        # Manual entry
        email = input("\nEnter lead's email: ").strip()
        name = input("Enter lead's name: ").strip()
        company = input("Enter company name (optional): ").strip()
    
    if not email:
        print("Email is required!")
        return
    
    print(f"\n[INFO] Will search Salesforce for: {name} ({email})")
    
    # Start browser and run test
    sender = SalesforceSender()
    
    try:
        print("\n[Step 1] Starting browser...")
        if not await sender.start(headless=False):
            print("[FAIL] Could not start browser")
            return
        
        page = sender.pages[0]
        
        # Search for the lead
        print(f"\n[Step 2] Searching for Lead: {email}")
        lead_url = await sender.find_lead(page, email, name, company)
        
        if not lead_url:
            print("\n[WARNING] Lead not found in search results.")
            print("The browser is open - you can:")
            print("  - Search manually")
            print("  - Create a new Lead")
            print("\nOnce you're on a Lead page, press ENTER to continue...")
            input()
            lead_url = page.url
        
        print(f"[OK] On Lead page: {lead_url}")
        
        # Click Email button
        print(f"\n[Step 3] Clicking Email button...")
        if not await sender.click_send_email(page):
            print("[FAIL] Could not open email composer")
            print("Check the browser - you may need to click it manually.")
            input("\nPress ENTER when email composer is open...")
        else:
            print("[OK] Email composer opened!")
        
        # Select template
        print(f"\n[Step 4] Selecting Footer template...")
        if not await sender.select_template(page, "Footer"):
            print("[WARNING] Could not select template automatically")
            print("You can select it manually in the browser.")
        else:
            print("[OK] Template selected!")
        
        # Fill test content
        print(f"\n[Step 5] Filling test content...")
        test_subject = f"Quick question for {company}" if company else "Quick question"
        test_body = f"Hi {name.split()[0] if name else 'there'},\n\nThis is a test email.\n\n"
        
        await sender.fill_email_body(page, test_subject, test_body)
        print("[OK] Content filled!")
        
        # Done!
        print("\n" + "=" * 60)
        print("EMAIL READY FOR REVIEW")
        print("=" * 60)
        print("\nThe email is prepared. You can:")
        print("  - Review and edit the content")
        print("  - Click SEND to send it")
        print("  - Close the composer to cancel")
        print("\nPress ENTER here when done to close browser...")
        input()
        
        await sender.stop()
        
    except Exception as e:
        print(f"\nERROR: {e}")
        import traceback
        traceback.print_exc()
        try:
            await sender.stop()
        except:
            pass

async def test_browser_only():
    """Just test browser authentication."""
    from services.salesforce_sender import test_browser
    await test_browser()

if __name__ == "__main__":
    print("=" * 60)
    print("SALESFORCE EMAIL SENDER - TEST SCRIPT")
    print("=" * 60)
    print("\nOptions:")
    print("1. Test browser only (verify login works)")
    print("2. Test full email flow (search for lead, prepare email)")
    print()
    
    choice = input("Enter choice (1 or 2): ").strip()
    
    if choice == "1":
        asyncio.run(test_browser_only())
    elif choice == "2":
        asyncio.run(test_with_contact())
    else:
        print("Invalid choice")

