"""
Salesforce Email Sender v2 - Playwright automation for sending emails through Salesforce.

Flow:
1. Open browser, authenticate with Salesforce
2. For each contact (parallelized in tabs):
   a. Navigate to Lead page (use saved URL or search)
   b. Click "Send Email" button
   c. Select email template
   d. Send email
3. Save Lead URLs for follow-up emails
"""
import asyncio
import json
from datetime import datetime
from typing import Optional, Dict, List
from urllib.parse import urljoin
from playwright.async_api import async_playwright, Browser, BrowserContext, Page

import config
import database as db
from services.web_automation.salesforce.pages import GlobalSearch, EmailComposer


class SalesforceSender:
    """
    Sends emails through Salesforce Lead records using templates.
    Supports parallelization via multiple browser tabs.
    """
    
    def __init__(self):
        self.browser: Optional[Browser] = None
        self.context: Optional[BrowserContext] = None
        self.pages: List[Page] = []
        self.is_authenticated = False
        self.max_tabs = 5  # Number of parallel tabs
        self.base_url = config.SALESFORCE_URL

    def _resolve_base_url_from_storage(self) -> str:
        """Resolve Salesforce org base URL from storage state."""
        try:
            storage_path = config.SALESFORCE_STORAGE_STATE
            if not storage_path.exists():
                return config.SALESFORCE_URL
            data = json.loads(storage_path.read_text(encoding="utf-8"))
            origins = data.get("origins") or []
            origin_urls = [o.get("origin") for o in origins if isinstance(o, dict) and o.get("origin")]
            for origin in origin_urls:
                if "lightning.force.com" in origin:
                    return origin
            for origin in origin_urls:
                if "my.salesforce.com" in origin:
                    return origin
        except Exception as e:
            print(f"[SFSender] Could not resolve org URL from storage: {e}")
        return config.SALESFORCE_URL
    
    async def start(self, headless: bool = False):
        """Start browser and authenticate with Salesforce."""
        print("[SFSender] Starting browser...")
        
        self._playwright = await async_playwright().start()
        
        # Launch browser (visible for debugging)
        self.browser = await self._playwright.chromium.launch(
            headless=headless,
            slow_mo=100  # Slow down for visibility
        )
        
        # Session storage path
        self.storage_path = config.SALESFORCE_STORAGE_STATE
        print(f"[SFSender] Session file: {self.storage_path}")
        
        # Load existing session if available
        if self.storage_path.exists():
            print("[SFSender] Loading saved Salesforce session...")
            try:
                self.context = await self.browser.new_context(
                    storage_state=str(self.storage_path),
                    viewport={'width': 1920, 'height': 1080}
                )
            except Exception as e:
                print(f"[SFSender] Failed to load session: {e}")
                print("[SFSender] Creating new session...")
                self.context = await self.browser.new_context(
                    viewport={'width': 1920, 'height': 1080}
                )
        else:
            print("[SFSender] No saved session - will need to login")
            self.context = await self.browser.new_context(
                viewport={'width': 1920, 'height': 1080}
            )

        # Resolve Salesforce org URL from stored session if available
        self.base_url = self._resolve_base_url_from_storage().rstrip('/')
        print(f"[SFSender] Base URL: {self.base_url}")
        
        # Create first page and check authentication
        page = await self.context.new_page()
        self.pages.append(page)
        
        print("[SFSender] Navigating to Salesforce Lightning...")
        await page.goto(f'{self.base_url}/lightning/page/home', timeout=60000)
        await page.wait_for_load_state('domcontentloaded')
        try:
            # Prefer a short state-based settle over fixed sleeps.
            await page.wait_for_load_state('networkidle', timeout=2500)
        except Exception:
            pass
        
        current_url = page.url
        print(f"[SFSender] Current URL: {current_url}")

        # If on login page, try auto-fill credentials first
        if 'login' in current_url.lower() or 'my.salesforce.com' in current_url:
            # Try to auto-fill credentials
            try:
                from services.web_automation.salesforce.credentials import get_credentials
                creds = get_credentials()
                if creds:
                    print("[SFSender] Auto-filling login credentials...")
                    await asyncio.sleep(1.5)

                    for sel in ['#username', "input[name='username']", "input[type='email']"]:
                        try:
                            field = page.locator(sel).first
                            if await field.count() > 0 and await field.is_visible():
                                await field.fill(creds['username'])
                                print("[SFSender] Username filled")
                                break
                        except:
                            continue

                    await asyncio.sleep(0.3)

                    for sel in ['input#password', "input[name='pw']", "input[type='password']"]:
                        try:
                            field = page.locator(sel).first
                            if await field.count() > 0 and await field.is_visible():
                                await field.fill(creds['password'])
                                print("[SFSender] Password filled")
                                break
                        except:
                            continue

                    await asyncio.sleep(0.5)

                    for sel in ['#Login', "input[name='Login']", "input[type='submit']"]:
                        try:
                            btn = page.locator(sel).first
                            if await btn.count() > 0:
                                await btn.click()
                                print("[SFSender] Login submitted, waiting for redirect...")
                                break
                        except:
                            continue
            except Exception as e:
                print(f"[SFSender] Auto-fill failed: {e}, waiting for manual login...")
        
        # Check if we need to login - wait for Lightning URL
        max_wait = 120  # 2 minutes max to login
        waited = 0
        
        while waited < max_wait:
            current_url = page.url
            
            # Check if we're on Lightning (logged in)
            if 'lightning.force.com' in current_url and '/lightning/' in current_url:
                print("[SFSender] On Lightning - authenticated!")
                break
            
            # Check if on login page
            if waited == 0 and ('login' in current_url.lower() or 'my.salesforce.com' in current_url):
                print("\n" + "=" * 60)
                print("[SFSender] LOGIN REQUIRED")
                print("=" * 60)
                print("Please log in to Salesforce in the browser window.")
                print("Take your time - the script will wait up to 2 minutes.")
                print("=" * 60 + "\n")
            
            await asyncio.sleep(5)
            waited += 5
            
            if waited % 15 == 0:
                print(f"[SFSender] Still waiting for login... ({waited}s)")
        
        if waited >= max_wait:
            print("[SFSender] Login timeout!")
            return False
        
        # Save session for next time
        print(f"[SFSender] Saving session to {self.storage_path}...")
        try:
            await self.context.storage_state(path=str(self.storage_path))
            print(f"[SFSender] Session saved successfully!")
        except Exception as e:
            print(f"[SFSender] Could not save session: {e}")
        
        self.is_authenticated = True
        print(f"[SFSender] Authenticated! URL: {page.url}")
        return True
    
    async def stop(self):
        """Clean up browser resources."""
        if self.context:
            # Save session before closing
            try:
                if hasattr(self, 'storage_path'):
                    await self.context.storage_state(path=str(self.storage_path))
                    print(f"[SFSender] Session saved to {self.storage_path}")
            except Exception as e:
                print(f"[SFSender] Could not save session on close: {e}")
            await self.context.close()
        if self.browser:
            await self.browser.close()
        if hasattr(self, '_playwright'):
            await self._playwright.stop()
        print("[SFSender] Browser closed")
    
    async def open_tabs(self, count: int):
        """Open additional tabs for parallel processing."""
        for i in range(count - len(self.pages)):
            page = await self.context.new_page()
            self.pages.append(page)
        print(f"[SFSender] Opened {len(self.pages)} tabs")
    
    async def find_lead(self, page: Page, email: str, name: str, company: str) -> Optional[str]:
        """
        Search for existing Lead by name. Returns Lead URL if found.
        """
        search_term = name
        print(f"  [SFSender] Searching for Lead: {search_term}")
        
        print(f"  [SFSender] Navigating to Salesforce Lightning...")
        await page.goto(f'{self.base_url}/lightning/page/home', timeout=60000)
        
        max_wait = 60
        waited = 0
        while waited < max_wait:
            current_url = page.url
            if 'lightning.force.com' in current_url and '/lightning/' in current_url:
                print("  [SFSender] On Lightning!")
                break
            await asyncio.sleep(3)
            waited += 3
        
        await asyncio.sleep(5)
        search = GlobalSearch(page)
        if not await search.search(search_term):
            print(f"  [SFSender] Search failed for '{search_term}'")
            return None

        await asyncio.sleep(3)
        url = await search.get_record_url_by_name(name)
        if url and ('/lightning/r/Lead/' in url or '/Lead/' in url):
            await search.click_result_by_text(name)
            await asyncio.sleep(3)
            current = page.url
            if '/Lead/' in current or '/lightning/r/' in current:
                print(f"  [SFSender] On Lead page: {current}")
                return current
            return url

        clicked = await search.click_result_by_text(name)
        if clicked:
            await asyncio.sleep(3)
            current = page.url
            if '/lightning/r/' in current or '/Lead/' in current:
                print(f"  [SFSender] On Lead page: {current}")
                return current

        if email and email != name:
            print(f"  [SFSender] Name search failed, trying email: {email}")
            try:
                if await search.search(email):
                    await asyncio.sleep(3)
                    clicked = await search.click_result_by_text(email)
                    if clicked and ('/Lead/' in page.url or '/lightning/r/' in page.url):
                        print(f"  [SFSender] Found Lead by email: {page.url}")
                        return page.url
            except Exception:
                pass

        print(f"  [SFSender] Lead not found for: {search_term}")
        return None
    
    async def navigate_to_lead(self, page: Page, lead_url: str) -> bool:
        """Navigate directly to a Lead page using saved URL."""
        print(f"  [SFSender] Navigating to Lead: {lead_url}")
        await page.goto(lead_url, timeout=30000)
        await page.wait_for_load_state('networkidle')
        await asyncio.sleep(1)
        return '/Lead/' in page.url
    
    async def click_send_email(self, page: Page) -> bool:
        """
        Click the Email button on a Lead page.
        """
        print("  [SFSender] Opening email composer...")
        await asyncio.sleep(3)
        composer = EmailComposer(page)
        return await composer.open_email_composer()

    def _normalize_sf_url(self, href: str) -> Optional[str]:
        raw = (href or "").strip()
        if not raw:
            return None
        if raw.startswith("http://") or raw.startswith("https://"):
            return raw
        return urljoin(f"{self.base_url}/", raw.lstrip("/"))

    async def get_latest_timeline_email_url(
        self,
        page: Page,
        expected_subject: str = "",
        limit: int = 25,
    ) -> Optional[str]:
        """
        Read the lead activity timeline and return newest EmailMessage URL.
        Filters out obvious task rows and optionally prefers subject matches.
        """
        expected = (expected_subject or "").strip().lower()
        task_markers = ("details for task", "follow up", "upcoming task")
        items = page.locator("li.row.Email, li.slds-timeline__item_email, .slds-timeline__item_email")
        try:
            count = await items.count()
        except Exception:
            count = 0

        best_url: Optional[str] = None
        for idx in range(min(count, max(1, limit))):
            item = items.nth(idx)
            try:
                row_text = (await item.inner_text(timeout=1000) or "").strip().lower()
            except Exception:
                row_text = ""
            if any(marker in row_text for marker in task_markers):
                continue
            link = item.locator('a.subjectLink[href*="/lightning/r/"][href*="/view"]').first
            try:
                href = await link.get_attribute("href")
            except Exception:
                href = None
            normalized = self._normalize_sf_url(href or "")
            if not normalized:
                continue
            if expected:
                try:
                    title = (await link.inner_text(timeout=1000) or "").strip().lower()
                except Exception:
                    title = ""
                if expected in title:
                    return normalized
            if best_url is None:
                best_url = normalized

        return best_url

    async def get_timeline_email_urls(self, page: Page, limit: int = 25) -> List[str]:
        """Collect EmailMessage record URLs from lead timeline (newest first)."""
        task_markers = ("details for task", "follow up", "upcoming task")
        items = page.locator("li.row.Email, li.slds-timeline__item_email, .slds-timeline__item_email")
        try:
            count = await items.count()
        except Exception:
            count = 0

        urls: List[str] = []
        seen = set()
        for idx in range(min(count, max(1, limit))):
            item = items.nth(idx)
            try:
                row_text = (await item.inner_text(timeout=1000) or "").strip().lower()
            except Exception:
                row_text = ""
            if any(marker in row_text for marker in task_markers):
                continue
            link = item.locator('a.subjectLink[href*="/lightning/r/"][href*="/view"]').first
            try:
                href = await link.get_attribute("href")
            except Exception:
                href = None
            normalized = self._normalize_sf_url(href or "")
            if not normalized or normalized in seen:
                continue
            seen.add(normalized)
            urls.append(normalized)
        return urls

    async def open_email_message_reply(self, page: Page, email_message_url: str) -> bool:
        """Open EmailMessage record and click Reply to open composer."""
        url = self._normalize_sf_url(email_message_url or "")
        if not url:
            return False
        print(f"  [SFSender] Opening previous EmailMessage: {url}")
        await page.goto(url, wait_until="domcontentloaded", timeout=30000)
        try:
            await page.wait_for_load_state("networkidle", timeout=10000)
        except Exception:
            pass
        await asyncio.sleep(1)

        reply_btn = page.get_by_role("button", name="Reply").or_(
            page.get_by_role("link", name="Reply")
        ).or_(
            page.locator("a:has-text('Reply')")
        ).or_(
            page.locator("button:has-text('Reply')")
        ).first
        try:
            await reply_btn.wait_for(state="visible", timeout=10000)
            await reply_btn.click()
            await asyncio.sleep(1.2)
        except Exception as e:
            print(f"  [SFSender] Reply button not found/clickable: {e}")
            return False

        composer = EmailComposer(page)
        return await composer.wait_for_composer_ready(timeout_ms=12000)
    
    async def select_template(self, page: Page, template_name: str) -> bool:
        """
        Select an email template in the composer.
        """
        print(f"  [SFSender] Selecting template: {template_name}")
        composer = EmailComposer(page)
        return await composer.select_template(template_name)

    async def maximize_composer(self, page: Page) -> None:
        """Maximize composer immediately after it opens for stable editor interactions."""
        composer = EmailComposer(page)
        await composer.maximize()

    async def focus_editor_body(self, page: Page) -> bool:
        """Click into email body editor/iframe so keyboard actions target message body."""
        composer = EmailComposer(page)
        return await composer.focus_editor_body()
    
    async def fill_email_body(self, page: Page, subject: str, body: str) -> bool:
        """
        Fill in the email subject and body.
        """
        print("  [SFSender] Filling email content...")
        
        try:
            composer = EmailComposer(page)

            filled = await composer.fill_email_with_keyboard(subject, body)
            if not filled:
                print("  [SFSender] Keyboard fill failed, trying label-based fill...")
                filled = await composer.fill_email(subject=subject, body=body)

            if not filled:
                print("  [SFSender] Could not fill email")
                return False

            await composer.clear_bcc()
            print(f"  [SFSender] Email content ready ({len(body or '')} chars)")
            return True
        except Exception as e:
            print(f"  [SFSender] Error filling email: {e}")
            return False

    async def fill_email_body_with_preserved_original(
        self,
        page: Page,
        subject: str,
        body: str,
        preserved_original_html: str,
    ) -> bool:
        """Fill body while appending a previously captured original reply thread."""
        print("  [SFSender] Filling email content with preserved original thread...")
        try:
            composer = EmailComposer(page)
            filled = await composer.fill_email_with_keyboard(
                subject,
                body,
                preserved_original_html=preserved_original_html or "",
            )
            if not filled:
                print("  [SFSender] Keyboard fill failed, trying label-based fill...")
                filled = await composer.fill_email(subject=subject, body=body)
            if not filled:
                print("  [SFSender] Could not fill email")
                return False
            await composer.clear_bcc()
            print(f"  [SFSender] Email content ready ({len(body or '')} chars)")
            return True
        except Exception as e:
            print(f"  [SFSender] Error filling email: {e}")
            return False

    async def capture_current_body_html(self, page: Page) -> str:
        """Capture current editor HTML before template insertion."""
        composer = EmailComposer(page)
        return await composer.capture_current_body_html()

    async def capture_current_subject(self, page: Page) -> str:
        """Capture current subject before template insertion mutates it."""
        composer = EmailComposer(page)
        return await composer.capture_current_subject()

    async def clear_current_body(self, page: Page) -> bool:
        """Clear current editor body before template insertion."""
        composer = EmailComposer(page)
        return await composer.clear_current_body()
    
    async def send_email(self, page: Page, skip_click: bool = False) -> bool:
        """Click Send (or only verify Send button visibility in manual-review mode)."""
        if skip_click:
            print("  [SFSender] Manual review mode: verifying Send button is visible...")
        else:
            print("  [SFSender] Clicking Send...")
        composer = EmailComposer(page)
        return await composer.send_email(skip_click=skip_click)
    
    async def process_contact(
        self,
        page: Page,
        contact: Dict,
        template_name: str,
        subject: str = None,
        body: str = None,
        auto_send: bool = False
    ) -> Dict:
        """
        Process a single contact: navigate to Lead, prepare email with template.
        
        Flow:
        1. Navigate to Lead page (use saved URL or search)
        2. Click "Email" button
        3. Click "Insert template" and select Footer template
        4. Fill in subject and body
        5. If auto_send=True, click Send. Otherwise leave for user to send.
        
        Args:
            auto_send: If False (default), prepares email but does NOT send.
                      User must click Send manually in the browser.
        """
        result = {
            'contact_id': contact.get('contact_id'),
            'contact_name': contact.get('contact_name', ''),
            'success': False,
            'lead_url': None,
            'ready_to_send': False,
            'error': None
        }
        
        email = contact.get('email')
        name = contact.get('contact_name', '')
        company = contact.get('company_name', '')
        
        print(f"\n{'='*50}")
        print(f"[SFSender] Processing: {name} ({email})")
        print(f"{'='*50}")
        
        if not email:
            result['error'] = 'No email address'
            return result
        
        # Step 1: Navigate to Lead page
        lead_url = contact.get('sf_lead_url')
        
        if lead_url:
            # Use saved URL
            print(f"  [SFSender] Using saved Lead URL")
            if not await self.navigate_to_lead(page, lead_url):
                # URL might be stale, try searching
                print(f"  [SFSender] Saved URL failed, searching...")
                lead_url = await self.find_lead(page, email, name, company)
        else:
            # Search for Lead
            lead_url = await self.find_lead(page, email, name, company)
        
        if not lead_url:
            result['error'] = 'Lead not found in Salesforce'
            print(f"  [SFSender] ERROR: {result['error']}")
            return result
        
        result['lead_url'] = lead_url
        
        # Save Lead URL to database for future use
        if contact.get('id'):
            try:
                db.update_campaign_contact(contact['id'], sf_lead_url=lead_url)
                print(f"  [SFSender] Lead URL saved to database")
            except Exception as e:
                print(f"  [SFSender] Could not save Lead URL: {e}")
        
        # Step 2: Click Send Email button
        if not await self.click_send_email(page):
            result['error'] = 'Could not open email composer'
            print(f"  [SFSender] ERROR: {result['error']}")
            return result
        
        # Step 3: Select Footer template (for signature)
        if not await self.select_template(page, template_name):
            # Template might be optional, continue anyway
            print(f"  [SFSender] Warning: Could not select template, continuing...")
        
        # Step 4: Fill email subject and body
        if subject or body:
            if not await self.fill_email_body(page, subject, body):
                result['error'] = 'Could not fill email content'
                print(f"  [SFSender] ERROR: {result['error']}")
                return result
        
        # Email is ready!
        result['ready_to_send'] = True
        print(f"  [SFSender] Email prepared for {name} - ready to send!")
        
        # Step 5: Only send if auto_send is True
        if auto_send:
            if await self.send_email(page):
                result['success'] = True
                print(f"  [SFSender] [OK] Email sent to {name}!")
            else:
                result['error'] = 'Send button click failed'
                print(f"  [SFSender] ERROR: {result['error']}")
        else:
            # Don't auto-send - user will click Send manually
            result['success'] = True
            print(f"  [SFSender] Email ready - YOU can click Send in the browser")
        
        return result
    
    async def process_contacts_parallel(
        self,
        contacts: List[Dict],
        template_name: str
    ) -> Dict:
        """
        Process multiple contacts in parallel using multiple tabs.
        """
        if not contacts:
            return {'processed': 0, 'sent': 0, 'failed': 0}
        
        # Open tabs for parallel processing
        num_tabs = min(self.max_tabs, len(contacts))
        await self.open_tabs(num_tabs)
        
        print(f"\n[SFSender] Processing {len(contacts)} contacts with {num_tabs} tabs")
        
        results = {'processed': 0, 'sent': 0, 'failed': 0, 'details': []}
        
        # Process in batches
        for i in range(0, len(contacts), num_tabs):
            batch = contacts[i:i + num_tabs]
            print(f"\n[SFSender] Processing batch {i // num_tabs + 1}")
            
            # Process batch in parallel
            tasks = []
            for j, contact in enumerate(batch):
                page = self.pages[j]
                task = self.process_contact(page, contact, template_name)
                tasks.append(task)
            
            batch_results = await asyncio.gather(*tasks)
            
            for r in batch_results:
                results['processed'] += 1
                if r['success']:
                    results['sent'] += 1
                else:
                    results['failed'] += 1
                results['details'].append(r)
        
        return results
