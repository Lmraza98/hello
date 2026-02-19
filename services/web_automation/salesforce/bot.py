"""
SalesforceBot: UI automation for sending tracked emails from Salesforce.
Uses persistent browser session to minimize re-authentication.
"""
import asyncio
import json
from datetime import datetime
from pathlib import Path
from typing import Optional, Dict, List
from playwright.async_api import async_playwright, Browser, BrowserContext, Page

import config
import database as db
from services.web_automation.salesforce.pages import (
    GlobalSearch, LeadPage, EmailComposer, ActivityTimeline
)


def _split_name(full_name: str) -> tuple[Optional[str], Optional[str]]:
    clean = " ".join((full_name or "").strip().split())
    if not clean:
        return None, None
    parts = clean.split(" ")
    first_name = parts[0]
    last_name = parts[-1] if len(parts) > 1 else None
    return first_name, last_name


class SalesforceBot:
    """
    Bot for automating Salesforce Lead creation and email sending.
    
    Design principles:
    - Single-threaded to reduce flake risk
    - Persistent session to avoid re-auth
    - Screenshot on every failure
    - Strict step assertions
    """
    
    def __init__(self):
        self.playwright = None
        self.browser: Optional[Browser] = None
        self.context: Optional[BrowserContext] = None
        self.page: Optional[Page] = None
        self.is_authenticated = False
        self.allow_manual_login = True
        self.base_url = config.SALESFORCE_URL
    
    async def start(self, headless: bool = False, allow_manual_login: bool = True):
        """
        Start browser with persistent session.
        """
        self.allow_manual_login = allow_manual_login
        self.playwright = await async_playwright().start()
        
        self.browser = await self.playwright.chromium.launch(
            headless=headless,
            slow_mo=100  # Slight slowdown for stability
        )
        
        # Load existing session if available
        storage_path = config.SALESFORCE_STORAGE_STATE
        if storage_path.exists():
            print("[SFBot] Loading existing session")
            self.context = await self.browser.new_context(
                storage_state=str(storage_path),
                viewport={'width': 1920, 'height': 1080}
            )
        else:
            print("[SFBot] Creating new session")
            self.context = await self.browser.new_context(
                viewport={'width': 1920, 'height': 1080}
            )
        
        self.page = await self.context.new_page()

        # Resolve the correct org base URL (important when config.SALESFORCE_URL is login.salesforce.com
        # but the stored session is for a MyDomain / lightning.force.com origin).
        self.base_url = self._resolve_base_url(storage_path) or config.SALESFORCE_URL
        if self.base_url != config.SALESFORCE_URL:
            print(f"[SFBot] Using resolved base URL: {self.base_url}")
        
        # Check if session is still valid
        await self._check_auth()
    
    async def stop(self):
        """Stop browser and save session."""
        if self.context:
            # Save session state for reuse
            await self.context.storage_state(path=str(config.SALESFORCE_STORAGE_STATE))
            await self.context.close()
        
        if self.browser:
            await self.browser.close()

        if self.playwright:
            try:
                await self.playwright.stop()
            except Exception:
                pass
            self.playwright = None
    
    async def _check_auth(self) -> bool:
        """Check if we're authenticated to Salesforce."""
        try:
            # Try to access Salesforce home
            await self.page.goto(f"{self.base_url}/lightning/page/home", timeout=30000)
            await self.page.wait_for_load_state('networkidle', timeout=15000)
            
            # Check if we're on login/verification page
            url = self.page.url.lower()
            auth_pages = ['login', 'secur', 'verification', 'identity', 'mfa', '2fa', 'toopher']
            
            if any(page in url for page in auth_pages):
                self.is_authenticated = False
                if not self.allow_manual_login:
                    print("[SFBot] Auth/verification required - manual login disabled.")
                    return False
                
                # Try to auto-fill credentials before waiting for manual login
                autofilled = await self._try_autofill_login()
                if autofilled:
                    print("[SFBot] Credentials auto-filled, waiting for MFA or login completion...")
                else:
                    print("[SFBot] Auth/verification required - waiting for manual login...")
                
                return await self.wait_for_manual_login()
            
            # Check for Lightning container
            lightning = self.page.locator('.slds-global-header, .oneGlobalNav')
            if await lightning.count() > 0:
                self.is_authenticated = True
                print("[SFBot] Authenticated successfully")
                return True
            
            self.is_authenticated = False
            return False
            
        except Exception as e:
            print(f"[SFBot] Auth check error: {e}")
            self.is_authenticated = False
            return False
    
    async def _try_autofill_login(self) -> bool:
        """
        Attempt to auto-fill the login form with stored credentials.
        
        Handles the Salesforce "Saved Username" (LoginHint) feature where the
        username <input> is hidden and replaced by an identity card.  In that
        case we skip straight to the password field.
        
        Returns True if credentials were filled and login button clicked.
        """
        try:
            from services.web_automation.salesforce.credentials import get_credentials
            
            creds = get_credentials()
            if not creds:
                print("[SFBot] No stored credentials for auto-fill")
                return False
            
            print(f"[SFBot] Auto-filling login for {creds['username']}")
            
            await asyncio.sleep(1.5)  # Let page settle
            
            # Try various selectors for username field (most specific first)
            username_selectors = ["#username", "input[name='username']", "input[type='email']", "#login_username"]
            # Password field: Salesforce uses id="password" and name="pw"
            password_selectors = ["input#password", "input[name='pw']", "#password", "input[type='password']", "#login_password"]
            login_button_selectors = ["#Login", "input[name='Login']", "input[type='submit']", "button[type='submit']"]
            
            # Find and fill username
            # Salesforce may hide the field when a "Saved Username" identity card
            # is showing.  The hidden <input> already has the value so we can skip.
            username_filled = False
            for selector in username_selectors:
                try:
                    field = self.page.locator(selector).first
                    if await field.count() > 0:
                        if await field.is_visible():
                            await field.click()
                            await field.fill(creds['username'])
                            username_filled = True
                            print(f"[SFBot] Username filled with selector: {selector}")
                            break
                        else:
                            # Hidden field â€” check if it already contains a value
                            current_val = await field.input_value()
                            if current_val and current_val.strip():
                                username_filled = True
                                print(f"[SFBot] Username already set via identity card: {current_val}")
                                break
                except Exception as e:
                    print(f"[SFBot] Username selector {selector} failed: {e}")
                    continue
            
            if not username_filled:
                print("[SFBot] Could not find username field")
                return False
            
            await asyncio.sleep(0.3)
            
            # Find and fill password
            password_filled = False
            for selector in password_selectors:
                try:
                    field = self.page.locator(selector).first
                    if await field.count() > 0 and await field.is_visible():
                        await field.click()
                        await field.fill(creds['password'])
                        password_filled = True
                        print(f"[SFBot] Password filled with selector: {selector}")
                        break
                except Exception as e:
                    print(f"[SFBot] Password selector {selector} failed: {e}")
                    continue
            
            if not password_filled:
                print("[SFBot] Could not find password field")
                return False
            
            await asyncio.sleep(0.5)
            
            # Click login button
            for selector in login_button_selectors:
                try:
                    button = self.page.locator(selector)
                    if await button.count() > 0:
                        await button.click()
                        print("[SFBot] Login button clicked, credentials auto-filled")
                        return True
                except Exception:
                    continue
            
            return False
            
        except Exception as e:
            print(f"[SFBot] Auto-fill error: {e}")
            return False

    @staticmethod
    def _resolve_base_url(storage_path: Path) -> Optional[str]:
        """
        Try to infer the correct Salesforce instance URL from the Playwright storage state.
        Prefers *.lightning.force.com origins; falls back to *.my.salesforce.com.
        """
        try:
            if not storage_path.exists():
                return None
            data = json.loads(storage_path.read_text(encoding="utf-8"))
            origins = data.get("origins") or []
            origin_urls = [o.get("origin") for o in origins if isinstance(o, dict) and o.get("origin")]
            # Prefer Lightning
            for o in origin_urls:
                if "lightning.force.com" in o:
                    return o
            for o in origin_urls:
                if "my.salesforce.com" in o:
                    return o
            return None
        except Exception:
            return None

    async def find_lead_url_by_name(self, full_name: str) -> Optional[str]:
        """
        Look up an existing Lead in Salesforce by name.
        Returns the Lead record URL if found, otherwise None.
        Never creates a new Lead.
        """
        name = (full_name or "").strip()
        if not name:
            return None

        if not self.is_authenticated:
            await self._check_auth()
        if not self.is_authenticated:
            return None

        search = GlobalSearch(self.page)
        search_ok = await search.search(name)
        if not search_ok:
            print(f"[SFBot] Search failed for '{name}'")
            return None
        await asyncio.sleep(2)  # Wait for results table to render

        # â”€â”€ Fast path: grab the URL directly from the results table â”€â”€
        # The search results page shows a data-table with <a> links.
        # We can read the href without clicking, which is faster and more reliable.
        url = await search.get_record_url_by_name(name)
        if url and ('/lightning/r/Lead/' in url or '/Lead/' in url):
            print(f"[SFBot] Found Lead URL from search results: {url}")
            return url

        # â”€â”€ Fallback: click through to the record â”€â”€
        clicked = await search.click_result_by_text(name)
        if not clicked:
            return None

        # Give Lightning time to settle.
        await asyncio.sleep(1)
        try:
            await self.page.wait_for_load_state('networkidle', timeout=15000)
        except Exception:
            pass

        url = self.page.url
        try:
            title = await self.page.title()
        except Exception:
            title = ""

        # Prefer Lead record URLs.
        if '/lightning/r/Lead/' in url or '/Lead/' in url:
            if name.lower() in (title or "").lower() or not title:
                return url
            return url  # URL is already a Lead record

        # If we landed elsewhere (Contact/Account), treat as not-found for this feature.
        return None
    
    async def wait_for_manual_login(self, timeout_minutes: int = 15):
        """
        Wait for manual login when MFA or initial auth is required.
        Opens browser in visible mode for user interaction.
        """
        print(f"\n[SFBot] ========================================")
        print(f"[SFBot] COMPLETE LOGIN/2FA IN THE BROWSER WINDOW")
        print(f"[SFBot] Timeout: {timeout_minutes} minutes")
        print(f"[SFBot] ========================================\n")
        
        # Poll for successful auth
        timeout = timeout_minutes * 60
        start = datetime.now()
        
        auth_pages = ['login', 'secur', 'verification', 'identity', 'mfa', '2fa', 'toopher']
        
        while (datetime.now() - start).seconds < timeout:
            await asyncio.sleep(3)
            
            url = self.page.url.lower()
            
            # Check if still on auth page
            if any(page in url for page in auth_pages):
                elapsed = (datetime.now() - start).seconds
                print(f"[SFBot] Waiting for auth... ({elapsed}s / {timeout}s)")
                continue
            
            # Check if we're on Lightning home
            if 'lightning' in url:
                print("[SFBot] Login successful!")
                
                # Verify we have the main UI
                lightning = self.page.locator('.slds-global-header, .oneGlobalNav')
                if await lightning.count() > 0:
                    self.is_authenticated = True
                    # Save session
                    await self.context.storage_state(path=str(config.SALESFORCE_STORAGE_STATE))
                    print("[SFBot] Session saved for next time")
                    return True
        
        print("[SFBot] Login timeout - try again")
        return False
    
    async def _capture_failure(self, send_id: int, step: str, error: str) -> str:
        """Capture screenshot and HTML on failure."""
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        screenshot_path = config.SCREENSHOTS_DIR / f"fail_{send_id}_{step}_{timestamp}.png"
        html_path = config.SCREENSHOTS_DIR / f"fail_{send_id}_{step}_{timestamp}.html"
        
        try:
            await self.page.screenshot(path=str(screenshot_path), full_page=True)
            html = await self.page.content()
            html_path.write_text(html, encoding='utf-8')
        except:
            pass
        
        return str(screenshot_path)
    
    async def search_for_record(self, email: str, company: str = None) -> Optional[Dict]:
        """
        Search for existing Lead/Contact by email or company.
        Returns record info if found, None otherwise.
        """
        search = GlobalSearch(self.page)
        
        # Search by email first (most reliable)
        if email:
            await search.search(email)
            await asyncio.sleep(1)
            
            results = await search.get_search_results()
            for result in results:
                text = result['text'].lower()
                if email.lower() in text:
                    # Found matching record
                    return {
                        'found': True,
                        'search_text': email,
                        'result_text': result['text']
                    }
        
        # Try company + domain search
        if company:
            await search.search(company)
            await asyncio.sleep(1)
            
            results = await search.get_search_results()
            if results:
                return {
                    'found': True,
                    'search_text': company,
                    'result_text': results[0]['text']
                }
        
        return {'found': False}
    
    async def create_or_update_lead(
        self,
        first_name: str = None,
        last_name: str = None,
        company: str = None,
        title: str = None,
        email: str = None,
        website: str = None,
        description: str = None,
        lead_source: str = "Web Research"
    ) -> Optional[str]:
        """
        Create a new Lead or update existing.
        Returns the Lead record URL or None on failure.
        """
        lead_page = LeadPage(self.page)
        
        # Search for existing record first
        print(f"    [SFBot] Searching for existing record: {email}")
        search_result = await self.search_for_record(email, company)
        
        if search_result.get('found'):
            print(f"    [SFBot] Found existing record, clicking...")
            search = GlobalSearch(self.page)
            clicked = await search.click_result_by_text(email or company)
            if clicked:
                await asyncio.sleep(2)  # Wait for page to load
                await self.page.wait_for_load_state('networkidle', timeout=15000)
                return self.page.url
        
        # Create new Lead
        print(f"    [SFBot] No existing record, creating new Lead...")
        try:
            await lead_page.create_new_lead()
        except Exception as e:
            print(f"    [SFBot] Error opening new Lead form: {e}")
            return None
        
        await asyncio.sleep(2)  # Wait for modal to fully render
        
        # Prepare name
        if not last_name:
            if first_name:
                last_name = first_name
                first_name = None
            else:
                last_name = "Unknown"
        
        # Fill form
        print(f"    [SFBot] Filling Lead form: {first_name} {last_name}, {company}")
        success = await lead_page.fill_lead_form(
            first_name=first_name,
            last_name=last_name,
            company=company or "Unknown Company",
            title=title,
            email=email,
            website=website,
            lead_source=lead_source,
            description=description
        )
        
        if not success:
            print(f"    [SFBot] Failed to fill Lead form")
            return None
        
        # Save
        print(f"    [SFBot] Saving Lead...")
        record_url = await lead_page.save_lead()
        
        if record_url:
            print(f"    [SFBot] Lead saved: {record_url}")
        else:
            print(f"    [SFBot] Failed to save Lead")
        
        return record_url
    
    async def send_email_from_record(
        self,
        subject: str,
        body: str,
        to_email: str = None,
        review_mode: bool = False
    ) -> bool:
        """
        Send an email from the current record page.
        
        Args:
            review_mode: If True, fill email but DON'T click send.
                        Leaves the composer open for manual review.
        
        Returns True if sent successfully (or ready for review if review_mode).
        """
        composer = EmailComposer(self.page)
        
        # Open composer
        print(f"    [SFBot] Opening email composer...")
        opened = await composer.open_email_composer()
        if not opened:
            print(f"    [SFBot] Failed to open email composer")
            return False
        
        print(f"    [SFBot] Email composer opened, waiting for it to load...")
        await asyncio.sleep(3)  # Wait for composer to fully load
        
        # Fill email
        print(f"    [SFBot] Filling email: To={to_email}, Subject={subject[:30]}...")
        filled = await composer.fill_email(
            to=to_email,
            subject=subject,
            body=body
        )
        
        if not filled:
            print(f"    [SFBot] Failed to fill email fields")
            await composer.cancel_email()
            return False
        
        print(f"    [SFBot] Email filled successfully")
        
        if review_mode:
            print(f"    [SFBot] Review mode - NOT clicking send")
            # Just verify send button is visible
            sent = await composer.send_email(skip_click=True)
            return sent
        
        # Send
        print(f"    [SFBot] Clicking send...")
        sent = await composer.send_email(skip_click=False)
        
        return sent
    
    async def verify_email_in_timeline(self, subject: str) -> bool:
        """Verify email appears in activity timeline."""
        await asyncio.sleep(2)  # Wait for timeline to update
        
        timeline = ActivityTimeline(self.page)
        return await timeline.verify_email_sent(subject)
    
    async def process_send_item(self, item: Dict, review_mode: bool = False) -> Dict:
        """
        Process a single send queue item.
        Returns result dict with status and details.
        """
        send_id = item['id']
        
        result = {
            'send_queue_id': send_id,
            'result': 'failed',
            'sf_record_url': None,
            'details': None,
            'screenshot_path': None
        }
        
        try:
            # Step 1: Check authentication
            if not self.is_authenticated:
                await self._check_auth()
                if not self.is_authenticated:
                    result['details'] = 'Not authenticated'
                    return result
            
            # Step 2: Create/find Lead
            email = item.get('contact_email', '')
            company = item.get('company_name', item.get('domain', 'Unknown'))
            print(f"  [SFBot] Creating/finding Lead for {email}")
            
            # Names are normalized at DB ingestion time.
            full_name = item.get('contact_name', '')
            first_name, last_name = _split_name(full_name)
            # Build description with evidence
            description = f"Source: Automated Outreach\n"
            description += f"Company Info: {item.get('company_info', 'N/A')[:500]}"
            
            record_url = await self.create_or_update_lead(
                first_name=first_name,
                last_name=last_name or "Contact",
                company=company,
                title=item.get('contact_title'),
                email=email,
                website=f"https://{item.get('domain', '')}",
                description=description
            )
            
            if not record_url:
                result['details'] = 'Failed to create/find Lead'
                result['screenshot_path'] = await self._capture_failure(send_id, 'create_lead', 'create_failed')
                return result
            
            result['sf_record_url'] = record_url
            print(f"  [SFBot] Lead URL: {record_url}")
            
            # Step 3: Navigate to record page and wait
            print(f"  [SFBot] Navigating to Lead record...")
            await self.page.goto(record_url)
            await self.page.wait_for_load_state('domcontentloaded', timeout=20000)
            await asyncio.sleep(3)  # Extra wait for Lightning to render
            await self.page.wait_for_load_state('networkidle', timeout=15000)
            
            # Verify we're on the record page
            current_url = self.page.url
            if '/Lead/' not in current_url and '/Contact/' not in current_url:
                print(f"  [SFBot] WARNING: Not on record page. URL: {current_url}")
                result['details'] = f'Navigation failed - landed on {current_url}'
                result['screenshot_path'] = await self._capture_failure(send_id, 'navigation', 'wrong_page')
                return result
            
            print(f"  [SFBot] On record page: {current_url}")
            
            # Step 4: Open email composer and fill
            if review_mode:
                print(f"  [SFBot] REVIEW MODE - Opening email composer...")
            else:
                print(f"  [SFBot] Sending email: {item.get('planned_subject', '')[:50]}...")
            
            sent = await self.send_email_from_record(
                subject=item['planned_subject'],
                body=item['planned_body'],
                to_email=email,
                review_mode=review_mode
            )
            
            if not sent:
                result['details'] = 'Failed to open/prepare email composer'
                result['screenshot_path'] = await self._capture_failure(send_id, 'send_email', 'send_failed')
                return result
            
            if review_mode:
                # Don't verify or mark as sent - leave for manual review
                result['result'] = 'ready_for_review'
                result['details'] = 'Email composer open - CLICK SEND MANUALLY'
                return result
            
            # Step 5: Verify in timeline
            verified = await self.verify_email_in_timeline(item['planned_subject'])
            
            result['result'] = 'sent'
            result['details'] = 'Email sent' + (' (verified in timeline)' if verified else ' (not verified)')
            
            return result
            
        except Exception as e:
            result['details'] = f'Exception: {str(e)}'
            result['screenshot_path'] = await self._capture_failure(send_id, 'exception', str(e))
            return result
    
    async def process_send_queue(self, limit: int = None, review_mode: bool = False) -> Dict:
        """
        Process pending items from send queue.
        Returns summary of results.
        """
        if limit is None:
            limit = config.DAILY_SEND_LIMIT
        
        # Get pending sends
        pending = db.get_pending_sends(limit=limit)
        
        if not pending:
            print("[SFBot] No pending sends")
            return {'processed': 0, 'sent': 0, 'failed': 0, 'skipped': 0}
        
        print(f"[SFBot] Processing {len(pending)} sends")
        
        summary = {'processed': 0, 'sent': 0, 'failed': 0, 'skipped': 0}
        
        for item in pending:
            # Check if we should skip
            if item.get('do_not_send'):
                db.update_send_queue_status(item['id'], 'skipped')
                db.log_send_result(
                    send_queue_id=item['id'],
                    result='skipped',
                    details=item.get('do_not_send_reason', 'do_not_send flag')
                )
                summary['skipped'] += 1
                continue
            
            # Process the item
            result = await self.process_send_item(item, review_mode=review_mode)
            
            # In review mode, don't update status to sent - keep as pending
            if not review_mode:
                db.update_send_queue_status(
                    item['id'],
                    result['result'],
                    result.get('sf_record_url')
                )
                
                db.log_send_result(
                    send_queue_id=item['id'],
                    sf_record_url=result.get('sf_record_url'),
                    result=result['result'],
                    details=result.get('details'),
                    screenshot_path=result.get('screenshot_path')
                )
            
            summary['processed'] += 1
            summary[result['result']] = summary.get(result['result'], 0) + 1
            
            if review_mode:
                # In review mode, pause and wait for user to review
                print(f"\n  [PAUSE] Email ready for review. Browser window shows the email.")
                print(f"     Review the content, then CLICK SEND in the browser.")
                input(f"     Press ENTER here when done to continue to next email...")
                print()
            else:
                # Brief pause between sends
                await asyncio.sleep(2)
        
        return summary


async def run_salesforce_bot(
    limit: int = None, 
    headless: bool = False,
    review_mode: bool = False
) -> Dict:
    """
    Run the Salesforce bot to process send queue.
    
    Args:
        limit: Max emails to process
        headless: Run browser without GUI (not compatible with review_mode)
        review_mode: Prepare emails but DON'T send - pause for manual review
    
    Returns summary dict.
    """
    # Review mode requires visible browser
    if review_mode and headless:
        print("[SFBot] Review mode requires visible browser, ignoring --headless")
        headless = False
    
    bot = SalesforceBot()
    
    try:
        await bot.start(headless=headless)
        
        # Check if login is needed
        if not bot.is_authenticated:
            print("[SFBot] Authentication required")
            if headless:
                return {
                    'error': 'Authentication required but running headless',
                    'processed': 0
                }
            
            # Wait for manual login - give user plenty of time
            timeout = config.AUTH_TIMEOUT_MINUTES
            print(f"[SFBot] Complete the login in the browser window.")
            print(f"[SFBot] You have {timeout} minutes. Press Ctrl+C if you need to abort.")
            logged_in = await bot.wait_for_manual_login(timeout_minutes=timeout)
            if not logged_in:
                return {'error': f'Login timeout ({timeout} min)', 'processed': 0}
        
        if review_mode:
            print("\n" + "="*60)
            print("  ðŸ“§ REVIEW MODE ENABLED")
            print("  Each email will be prepared but NOT sent.")
            print("  You must CLICK SEND in the browser for each email.")
            print("="*60 + "\n")
        
        # Process queue
        summary = await bot.process_send_queue(limit=limit, review_mode=review_mode)
        
        return summary
        
    finally:
        if not review_mode:
            await bot.stop()
        else:
            print("\n[SFBot] Review session complete. Browser stays open for any remaining reviews.")
            print("[SFBot] Close the browser window manually when done.")


# CLI entry point
if __name__ == "__main__":
    import sys
    
    limit = int(sys.argv[1]) if len(sys.argv) > 1 else None
    headless = '--headless' in sys.argv
    
    result = asyncio.run(run_salesforce_bot(limit=limit, headless=headless))
    print(f"\nResults: {json.dumps(result, indent=2)}")


