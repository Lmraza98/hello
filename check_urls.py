"""Check LinkedIn URL status for all contacts."""
import database as db

with db.get_db() as conn:
    cursor = conn.cursor()
    
    # Count total contacts
    cursor.execute("SELECT COUNT(*) FROM linkedin_contacts")
    total = cursor.fetchone()[0]
    
    # Count contacts with proper /in/ URLs
    cursor.execute("SELECT COUNT(*) FROM linkedin_contacts WHERE linkedin_url LIKE '%/in/%'")
    with_profile_urls = cursor.fetchone()[0]
    
    # Count contacts with only Sales Nav URLs
    cursor.execute("SELECT COUNT(*) FROM linkedin_contacts WHERE linkedin_url LIKE '%/sales/%' AND linkedin_url NOT LIKE '%/in/%'")
    sales_nav_only = cursor.fetchone()[0]
    
    # Count contacts with no URL
    cursor.execute("SELECT COUNT(*) FROM linkedin_contacts WHERE linkedin_url IS NULL OR linkedin_url = ''")
    no_url = cursor.fetchone()[0]
    
    print(f"\n{'='*50}")
    print(f"  LinkedIn URL Status")
    print(f"{'='*50}")
    print(f"  Total contacts:           {total}")
    print(f"  With /in/ profile URLs:   {with_profile_urls}  (GOOD)")
    print(f"  With Sales Nav URLs only: {sales_nav_only}  (need scraping)")
    print(f"  No URL at all:            {no_url}  (need scraping)")
    print(f"  NEED PROCESSING:          {sales_nav_only + no_url}")
    print(f"{'='*50}")
    
    if with_profile_urls > 0:
        print("\nRecent contacts WITH /in/ URLs:")
        cursor.execute("""
            SELECT name, company_name, linkedin_url 
            FROM linkedin_contacts 
            WHERE linkedin_url LIKE '%/in/%'
            ORDER BY id DESC
            LIMIT 5
        """)
        for row in cursor.fetchall():
            print(f"  {row['name']} @ {row['company_name']}")
            print(f"    -> {row['linkedin_url']}")

