"""
Daily email sender script - run via Windows Task Scheduler.
Processes all pending campaign emails that are due.

This script:
1. Checks for contacts whose next_email_at timestamp has passed
2. Generates personalized emails using GPT-4o
3. Sends them through Salesforce automation
4. Updates the schedule for the next email in the sequence

Run manually: python -m services.email.daily_sender
Or schedule via Windows Task Scheduler for automatic daily execution.
"""
import asyncio
import sys
import logging
from pathlib import Path
from datetime import datetime

# Add project to path
BASE_DIR = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(BASE_DIR))

# Set up logging
log_dir = BASE_DIR / "data" / "logs"
log_dir.mkdir(exist_ok=True)
log_file = log_dir / f"email_sender_{datetime.now().strftime('%Y%m%d')}.log"

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler(log_file),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)


async def main():
    """Main entry point for daily email processing."""
    logger.info("=" * 60)
    logger.info("Daily Email Campaign Sender Starting")
    logger.info(f"Time: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    logger.info("=" * 60)
    
    try:
        # Import here to ensure path is set
        import database as db
        from services.email.salesforce_sender import run_campaign_email_sender
        
        # Check how many emails are ready to send
        pending = db.get_contacts_ready_for_email(limit=100)
        logger.info(f"Found {len(pending)} contacts ready for emails")
        
        if not pending:
            logger.info("No emails to send today. Exiting.")
            return {'processed': 0, 'sent': 0, 'message': 'No pending emails'}
        
        # Process the email queue
        result = await run_campaign_email_sender(
            campaign_id=None,  # Process all active campaigns
            limit=50,          # Max emails per run (adjust as needed)
            headless=False,    # Set True for fully background operation
            review_mode=False  # Auto-send without manual review
        )
        
        logger.info(f"Results: {result}")
        logger.info("=" * 60)
        logger.info("Daily Email Campaign Sender Complete")
        logger.info("=" * 60)
        
        return result
        
    except Exception as e:
        logger.error(f"Error running email sender: {e}", exc_info=True)
        return {'error': str(e)}


if __name__ == "__main__":
    print("\n" + "=" * 60)
    print("  DAILY EMAIL CAMPAIGN SENDER")
    print("=" * 60 + "\n")
    
    result = asyncio.run(main())
    
    print("\n" + "-" * 60)
    print(f"Final Result: {result}")
    print("-" * 60)
    
    # Keep window open if run manually
    if sys.stdin.isatty():
        input("\nPress ENTER to close...")

