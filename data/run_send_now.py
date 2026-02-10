
import asyncio
import sys
sys.path.insert(0, r"C:\Users\lmraz\Hello")

from services.salesforce_email_sender import process_approved_emails

print("="*60)
print("SALESFORCE SEND NOW")
print("="*60)
print("Sending 1 email immediately")
print("  To: Aleksey Chuprov (Suffolk Construction)")
print("  Subject: Quick intro – Suffolk Construction")
print("="*60)

try:
    result = asyncio.run(process_approved_emails(limit=1))
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
