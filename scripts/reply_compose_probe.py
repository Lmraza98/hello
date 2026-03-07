"""
Focused probe for Salesforce EmailMessage reply compose flow.

Runs only the sequence below for one email URL:
1) Open EmailMessage URL
2) Click Reply and wait for composer
3) Maximize
4) Capture current body HTML
5) Clear body (simulate cut)
6) Insert template (Footer by default)
7) Fill generated text and append captured original content
"""

import argparse
import asyncio
import sys
from pathlib import Path
from typing import Dict, Optional

# Ensure repository root is importable when running as a script.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import database as db
from services.email.salesforce_automation import SalesforceSender
from services.email.template_linked_resolver import render_linked_template_for_contact


def _first_name(full_name: str) -> str:
    parts = [p for p in (full_name or "").strip().split() if p]
    return parts[0] if parts else ""


def _fill_basic_tokens(text: str, contact_name: str, company_name: str) -> str:
    if not text:
        return ""
    first = _first_name(contact_name)
    parts = [p for p in (contact_name or "").strip().split() if p]
    last = " ".join(parts[1:]) if len(parts) > 1 else ""
    out = text
    replacements = [
        ("{company}", company_name or ""),
        ("{Company}", company_name or ""),
        ("{name}", contact_name or ""),
        ("{Name}", contact_name or ""),
        ("{FirstName}", first),
        ("{firstName}", first),
        ("{first_name}", first),
        ("{LastName}", last),
        ("{lastName}", last),
        ("{last_name}", last),
    ]
    for old, new in replacements:
        out = out.replace(old, new)
    return out


def _load_next_step_from_email_url(email_url: str) -> Optional[Dict[str, str]]:
    url = (email_url or "").strip()
    if not url:
        return None

    with db.get_db() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT
                se.campaign_contact_id,
                se.campaign_id,
                se.contact_id,
                COALESCE(se.step_number, 0) AS sent_step,
                COALESCE(cc.current_step, 0) AS current_step,
                lc.name AS contact_name,
                lc.email_generated AS email,
                lc.title,
                lc.company_name,
                lc.domain,
                lc.location,
                t.vertical,
                ec.name AS campaign_name,
                ec.template_id,
                ec.template_mode
            FROM sent_emails se
            JOIN campaign_contacts cc ON cc.id = se.campaign_contact_id
            JOIN linkedin_contacts lc ON lc.id = se.contact_id
            JOIN email_campaigns ec ON ec.id = se.campaign_id
            LEFT JOIN targets t ON TRIM(LOWER(lc.company_name)) = TRIM(LOWER(t.company_name))
            WHERE TRIM(COALESCE(se.sf_email_url, '')) = ?
            ORDER BY se.id DESC
            LIMIT 1
            """,
            (url,),
        )
        row = cursor.fetchone()
        if not row:
            return None
        contact = dict(row)

    campaign_contact_id = int(contact.get("campaign_contact_id") or 0)
    max_sent_step = 0
    if campaign_contact_id:
        with db.get_db() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                SELECT COALESCE(MAX(COALESCE(step_number, 0)), 0) AS max_sent_step
                FROM sent_emails
                WHERE campaign_contact_id = ?
                  AND lower(COALESCE(review_status, status, '')) = 'sent'
                """,
                (campaign_contact_id,),
            )
            row2 = cursor.fetchone()
            max_sent_step = int((row2["max_sent_step"] if row2 else 0) or 0)

    sent_step = int(contact.get("sent_step") or 0)
    current_step = int(contact.get("current_step") or 0)
    next_step = max(sent_step, current_step, max_sent_step) + 1

    linked_render = render_linked_template_for_contact(contact)
    if linked_render:
        subject = linked_render.get("subject", "") or ""
        html = linked_render.get("html", "") or ""
        return {
            "subject": subject,
            "body": html,
            "step": str(next_step),
            "campaign": contact.get("campaign_name") or "",
            "contact": contact.get("contact_name") or "",
            "source": "linked",
        }

    templates = db.get_email_templates(int(contact["campaign_id"]))
    template = next((t for t in templates if int(t.get("step_number") or 0) == next_step), None)
    if not template:
        return None

    contact_name = contact.get("contact_name") or ""
    company_name = contact.get("company_name") or ""
    subject = _fill_basic_tokens(template.get("subject_template") or "", contact_name, company_name)
    body = _fill_basic_tokens(template.get("body_template") or "", contact_name, company_name)
    return {
        "subject": subject,
        "body": body,
        "step": str(next_step),
        "campaign": contact.get("campaign_name") or "",
        "contact": contact_name,
        "source": "campaign_step",
        "max_sent_step": str(max_sent_step),
    }


async def run_probe(
    email_url: str,
    template: str,
    body: str,
    headless: bool,
    use_campaign_step: bool,
    hold_open: bool,
) -> int:
    sender = SalesforceSender()
    exit_code = 0
    close_requested = False
    try:
        effective_body = body or ""
        if use_campaign_step and not effective_body.strip():
            resolved = _load_next_step_from_email_url(email_url)
            if resolved and (resolved.get("body") or "").strip():
                effective_body = resolved["body"]
                print(
                    f"Resolved body from {resolved.get('source')} template: "
                    f"campaign='{resolved.get('campaign')}', contact='{resolved.get('contact')}', "
                    f"step={resolved.get('step')}"
                )
            else:
                print("No campaign-step template resolved from email URL; using fallback probe body.")
        if not effective_body.strip():
            effective_body = "Hi {{firstName}},\n\nQuick follow-up from my previous note.\n\nBest,\nLucas"

        if not await sender.start(headless=headless):
            print("Probe failed: Salesforce auth/startup failed")
            exit_code = 2
            return exit_code

        page = sender.pages[0]
        ready = await sender.open_email_message_reply(page, email_url)
        if not ready:
            print("Probe failed: could not open reply composer")
            exit_code = 3
            return exit_code

        await sender.maximize_composer(page)
        preserved_subject = await sender.capture_current_subject(page)
        print(f"Captured subject: {preserved_subject or '<empty>'}")
        original_html = await sender.capture_current_body_html(page)
        print(f"Captured original HTML length: {len(original_html)}")

        cleared = await sender.clear_current_body(page)
        print(f"Body cleared: {cleared}")
        if not cleared:
            exit_code = 4
            return exit_code

        ok_template = await sender.select_template(page, template)
        print(f"Template selected ({template}): {ok_template}")
        if not ok_template:
            exit_code = 5
            return exit_code

        ok_fill = await sender.fill_email_body_with_preserved_original(
            page=page,
            subject=preserved_subject,
            body=effective_body,
            preserved_original_html=original_html,
        )
        print(f"Fill+append completed: {ok_fill}")
        if not ok_fill:
            exit_code = 6
            return exit_code

        print("Probe success. Composer is ready for manual inspection.")
        exit_code = 0
        return exit_code
    finally:
        if hold_open and not close_requested:
            print(f"Probe exit code: {exit_code}")
            print("Probe browser will stay open for inspection.")
            print("Close it manually or press Ctrl+C in this terminal when done.")
            try:
                while True:
                    await asyncio.sleep(1)
            except KeyboardInterrupt:
                pass
        try:
            await sender.stop()
        except Exception:
            pass


def main() -> None:
    parser = argparse.ArgumentParser(description="Probe one Salesforce reply-compose flow")
    parser.add_argument("--email-url", required=True)
    parser.add_argument("--template", default="Footer")
    parser.add_argument("--body", default="")
    parser.add_argument(
        "--use-campaign-step",
        action="store_true",
        default=True,
        help="Resolve next-step body from campaign template using --email-url (default on).",
    )
    parser.add_argument(
        "--no-use-campaign-step",
        dest="use_campaign_step",
        action="store_false",
        help="Disable campaign-step body resolution and use --body/fallback.",
    )
    parser.add_argument("--headless", action="store_true")
    parser.add_argument(
        "--no-hold-open",
        dest="hold_open",
        action="store_false",
        help="Exit immediately after probe instead of keeping browser open.",
    )
    parser.set_defaults(hold_open=True)
    args = parser.parse_args()

    code = asyncio.run(
        run_probe(
            email_url=args.email_url,
            template=args.template,
            body=args.body,
            headless=args.headless,
            use_campaign_step=args.use_campaign_step,
            hold_open=args.hold_open,
        )
    )
    raise SystemExit(code)


if __name__ == "__main__":
    main()
