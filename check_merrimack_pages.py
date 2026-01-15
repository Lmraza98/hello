import database as db

# Check what pages exist for Merrimack County Savings Bank
with db.get_db() as conn:
    cursor = conn.cursor()
    
    # Check targets table for source_url
    cursor.execute("SELECT domain, company_name, source_url FROM targets WHERE company_name LIKE '%Merrimack County Savings Bank%'")
    targets = cursor.fetchall()
    print("=== TARGETS TABLE ===")
    for row in targets:
        print(f"Domain: {row[0]}, Company: {row[1]}, Source URL: {row[2]}")
    
    # Check ALL pages - maybe company name appears in text
    print("\n=== ALL PAGES (checking for company name in text) ===")
    cursor.execute("SELECT COUNT(*) FROM pages WHERE text_path IS NOT NULL")
    total_pages = cursor.fetchone()[0]
    print(f"Total pages with text: {total_pages}")
    
    # Check if any pages mention "merrimack" in URL or domain
    cursor.execute("SELECT COUNT(*) FROM pages WHERE (url LIKE '%merrimack%' OR domain LIKE '%merrimack%') AND text_path IS NOT NULL")
    merrimack_pages = cursor.fetchone()[0]
    print(f"Pages mentioning 'merrimack': {merrimack_pages}")
    
    # Get a sample of pages to check
    cursor.execute("SELECT url, domain FROM pages WHERE text_path IS NOT NULL LIMIT 5")
    sample = cursor.fetchall()
    print("\nSample pages:")
    for row in sample:
        print(f"  {row[0]} (domain: {row[1]})")
