"""
Database utility commands for cleanup and reset operations.
Consolidates reset_queue.py, reset_status.py, reset_uploaded.py, clear_today.py
"""
import database as db


def cmd_reset_queue(args):
    """Clear all pending items from send queue."""
    count = db.clear_pending_send_queue()
    print(f"Cleared {count} pending items from send queue")


def cmd_reset_company_status(args):
    """Reset all company targets back to 'pending' status."""
    count = db.reset_all_target_statuses(status='pending')
    print(f"Reset {count} companies to 'pending' status")


def cmd_reset_salesforce(args):
    """Reset contacts marked as 'uploaded' back to 'pending'."""
    count = db.reset_uploaded_salesforce_contacts()
    print(f"Reset {count} contacts from 'uploaded' back to 'pending'")


def cmd_clear_contacts(args):
    """Delete all LinkedIn contacts from database."""
    count = db.count_linkedin_contacts()
    print(f"Total LinkedIn contacts in DB: {count}")
    
    if count > 0:
        if not getattr(args, 'confirm', False):
            print("Use --confirm flag to actually delete contacts")
            return
        
        deleted = db.clear_all_linkedin_contacts()
        print(f"Deleted all {deleted} contacts")
    else:
        print("Database already empty")


def cmd_db_stats(args):
    """Show database statistics."""
    contacts = db.count_linkedin_contacts()
    companies = db.count_targets()
    campaigns = db.count_email_campaigns()
    sent = db.count_sent_emails()
    
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
