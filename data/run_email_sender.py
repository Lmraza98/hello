
import asyncio
import sys
sys.path.insert(0, r"C:\Users\lmraz\Hello")

from services.salesforce_email_sender import run_campaign_email_sender

print("="*60)
print("SALESFORCE EMAIL SENDER")
print("="*60)
print("Campaign ID: All")
print("Contacts to process: 1")
print("Review Mode: True")
print("="*60)

try:
    result = asyncio.run(run_campaign_email_sender(
        campaign_id=None,
        limit=1,
        headless=False,
        review_mode=True
    ))

    import json
    print("\n" + "="*60)
    print("RESULTS:", json.dumps(result, indent=2))
    print("="*60)
except Exception as e:
    import traceback
    print("\n" + "="*60)
    print("ERROR:", str(e))
    print(traceback.format_exc())
    print("="*60)

input("\nPress ENTER to close...")
