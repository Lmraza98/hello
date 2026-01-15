"""
Status command - show pipeline status and statistics.
"""
import database as db


def cmd_status(args):
    """Show pipeline status and statistics."""
    with db.get_db() as conn:
        cursor = conn.cursor()
        
        # Companies
        cursor.execute("SELECT COUNT(*) FROM targets")
        total_companies = cursor.fetchone()[0]
        
        cursor.execute("SELECT COUNT(*) FROM targets WHERE status = 'pending'")
        pending = cursor.fetchone()[0]
        
        cursor.execute("SELECT COUNT(*) FROM targets WHERE status = 'scraped'")
        scraped = cursor.fetchone()[0]
        
        # Contacts
        try:
            cursor.execute("SELECT COUNT(*) FROM linkedin_contacts")
            total_contacts = cursor.fetchone()[0]
        except:
            total_contacts = 0
        
        try:
            cursor.execute("SELECT COUNT(*) FROM linkedin_contacts WHERE email_generated IS NOT NULL AND email_generated != ''")
            with_email = cursor.fetchone()[0]
        except:
            with_email = 0
    
    print("\n=== Pipeline Status ===")
    print(f"Total Companies:  {total_companies}")
    print(f"  Pending:        {pending}")
    print(f"  Scraped:        {scraped}")
    print(f"")
    print(f"Total Contacts:   {total_contacts}")
    print(f"  With Email:     {with_email}")


