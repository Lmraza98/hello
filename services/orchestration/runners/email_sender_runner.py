"""
Standalone runner for email sending operations.
Launched as a subprocess by the API to keep Playwright/Salesforce
automation out of the FastAPI process.

Usage:
    python -m services.orchestration.runners.email_sender_runner campaign --campaign-id 5 --limit 10 --review --no-headless
    python -m services.orchestration.runners.email_sender_runner send-now --limit 1
    python -m services.orchestration.runners.email_sender_runner process-scheduled --limit 10
"""
import argparse
import asyncio
import json
import sys
import traceback
from pathlib import Path

# Ensure project root is on sys.path.
# NOTE: parents[2] is ".../services", which shadows stdlib "email"
# via local "services/email". Use repository root (parents[3]) instead.
sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from services.email.salesforce_sender import (  # noqa: E402
    process_approved_emails,
    run_campaign_email_sender,
)


def main():
    parser = argparse.ArgumentParser(description="Email sender runner")
    sub = parser.add_subparsers(dest="command", required=True)

    # campaign
    p_campaign = sub.add_parser("campaign")
    p_campaign.add_argument("--campaign-id", type=int, default=None)
    p_campaign.add_argument("--limit", type=int, default=10)
    p_campaign.add_argument("--review", action="store_true")
    p_campaign.add_argument("--no-headless", action="store_true")

    # send-now
    p_send = sub.add_parser("send-now")
    p_send.add_argument("--limit", type=int, default=1)

    # process-scheduled
    p_sched = sub.add_parser("process-scheduled")
    p_sched.add_argument("--limit", type=int, default=10)
    p_sched.add_argument("--review", action="store_true")
    p_sched.add_argument("--no-headless", action="store_true")

    args = parser.parse_args()

    print("=" * 60)
    print(f"SALESFORCE EMAIL SENDER  [{args.command}]")
    print("=" * 60)

    try:
        if args.command == "campaign":
            print(f"Campaign ID: {args.campaign_id or 'All'}")
            print(f"Limit: {args.limit}")
            print(f"Review Mode: {args.review}")
            print("=" * 60)
            result = asyncio.run(
                run_campaign_email_sender(
                    campaign_id=args.campaign_id,
                    limit=args.limit,
                    headless=not args.no_headless,
                    review_mode=args.review,
                )
            )
        elif args.command == "send-now":
            print(f"Sending up to {args.limit} email(s) immediately")
            print("=" * 60)
            result = asyncio.run(process_approved_emails(limit=args.limit))
        elif args.command == "process-scheduled":
            print(f"Processing up to {args.limit} scheduled email(s)")
            print(f"Review Mode: {args.review}")
            print("=" * 60)
            result = asyncio.run(
                process_approved_emails(
                    limit=args.limit,
                    headless=not args.no_headless,
                    review_mode=args.review,
                )
            )
        else:
            print(f"Unknown command: {args.command}")
            sys.exit(1)

        print("\n" + "=" * 60)
        print("RESULTS:", json.dumps(result, indent=2))
        print("=" * 60)
    except Exception:
        print("\n" + "=" * 60)
        print("ERROR:")
        traceback.print_exc()
        print("=" * 60)

    input("\nPress ENTER to close...")


if __name__ == "__main__":
    main()
