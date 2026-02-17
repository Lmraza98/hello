"""
Status command - show pipeline status and statistics.
"""
import database as db


def cmd_status(args):
    """Show pipeline status and statistics."""
    total_companies = db.count_targets()
    pending = db.count_targets(status='pending')
    scraped = db.count_targets(status='scraped')
    total_contacts = db.count_linkedin_contacts()
    with_email = db.count_linkedin_contacts(with_generated_email=True)
    
    print("\n=== Pipeline Status ===")
    print(f"Total Companies:  {total_companies}")
    print(f"  Pending:        {pending}")
    print(f"  Scraped:        {scraped}")
    print(f"")
    print(f"Total Contacts:   {total_contacts}")
    print(f"  With Email:     {with_email}")


