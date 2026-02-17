"""Email services - sending, tracking, Salesforce automation, Outlook monitoring."""
from services.email.generator import generate_email_with_gpt4o
from services.email.preparer import prepare_daily_batch
from services.email.salesforce_sender import run_campaign_email_sender, process_approved_emails
from services.email.salesforce_automation import SalesforceSender
from services.email.salesforce_tracker import poll_salesforce_tracking
from services.email.outlook_monitor import poll_outlook_replies
from services.email.graph_auth import is_authenticated, get_auth_status, initiate_auth, logout

