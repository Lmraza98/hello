"""
Database utility commands for cleanup and reset operations.
Consolidates reset_queue.py, reset_status.py, reset_uploaded.py, clear_today.py
"""
import database as db


def cmd_reset_queue(args):
    """Clear all pending items from send queue."""
    conn = db.get_connection()
    c = conn.cursor()
    c.execute("DELETE FROM send_queue WHERE status='pending'")
    conn.commit()
    count = c.rowcount
    conn.close()
    print(f"Cleared {count} pending items from send queue")


def cmd_reset_company_status(args):
    """Reset all company targets back to 'pending' status."""
    with db.get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("UPDATE targets SET status = 'pending'")
        count = cursor.rowcount
    print(f"Reset {count} companies to 'pending' status")


def cmd_reset_salesforce(args):
    """Reset contacts marked as 'uploaded' back to 'pending'."""
    conn = db.get_connection()
    cursor = conn.cursor()
    cursor.execute("""
        UPDATE linkedin_contacts 
        SET salesforce_status = 'pending', 
            salesforce_uploaded_at = NULL, 
            salesforce_upload_batch = NULL 
        WHERE salesforce_status = 'uploaded'
    """)
    count = cursor.rowcount
    conn.commit()
    conn.close()
    print(f"Reset {count} contacts from 'uploaded' back to 'pending'")


def cmd_clear_contacts(args):
    """Delete all LinkedIn contacts from database."""
    conn = db.get_connection()
    cursor = conn.cursor()
    
    cursor.execute("SELECT COUNT(*) as cnt FROM linkedin_contacts")
    count = cursor.fetchone()['cnt']
    print(f"Total LinkedIn contacts in DB: {count}")
    
    if count > 0:
        if not getattr(args, 'confirm', False):
            print("Use --confirm flag to actually delete contacts")
            conn.close()
            return
        
        cursor.execute("DELETE FROM linkedin_contacts")
        conn.commit()
        print(f"Deleted all {count} contacts")
    else:
        print("Database already empty")
    
    conn.close()


def cmd_db_stats(args):
    """Show database statistics."""
    conn = db.get_connection()
    cursor = conn.cursor()
    
    # Contacts
    cursor.execute("SELECT COUNT(*) FROM linkedin_contacts")
    contacts = cursor.fetchone()[0]
    
    # Companies
    cursor.execute("SELECT COUNT(*) FROM targets")
    companies = cursor.fetchone()[0]
    
    # Campaigns
    try:
        cursor.execute("SELECT COUNT(*) FROM email_campaigns")
        campaigns = cursor.fetchone()[0]
    except:
        campaigns = 0
    
    # Sent emails
    try:
        cursor.execute("SELECT COUNT(*) FROM sent_emails")
        sent = cursor.fetchone()[0]
    except:
        sent = 0
    
    conn.close()
    
    print(f"\nDatabase Statistics:")
    print(f"  Contacts: {contacts}")
    print(f"  Companies: {companies}")
    print(f"  Email Campaigns: {campaigns}")
    print(f"  Sent Emails: {sent}")


def setup_db_commands(subparsers):
    """Add database commands to CLI parser."""
    
    # reset-queue
    p = subparsers.add_parser('reset-queue', help='Clear pending items from send queue')
    p.set_defaults(func=cmd_reset_queue)
    
    # reset-companies
    p = subparsers.add_parser('reset-companies', help='Reset company targets to pending')
    p.set_defaults(func=cmd_reset_company_status)
    
    # reset-salesforce
    p = subparsers.add_parser('reset-salesforce', help='Reset salesforce upload status')
    p.set_defaults(func=cmd_reset_salesforce)
    
    # clear-contacts
    p = subparsers.add_parser('clear-contacts', help='Delete all contacts (requires --confirm)')
    p.add_argument('--confirm', action='store_true', help='Confirm deletion')
    p.set_defaults(func=cmd_clear_contacts)
    
    # db-stats
    p = subparsers.add_parser('db-stats', help='Show database statistics')
    p.set_defaults(func=cmd_db_stats)
