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
from datetime import datetime
from typing import Optional, Dict, List
from playwright.async_api import async_playwright, Browser, BrowserContext, Page

import config
import database as db


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
        self.storage_path = config.DATA_DIR / "salesforce_session.json"
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
        
        # Create first page and check authentication
        page = await self.context.new_page()
        self.pages.append(page)
        
        print("[SFSender] Navigating to Salesforce Lightning...")
        await page.goto('https://zcocorp.lightning.force.com/lightning/page/home', timeout=60000)
        await page.wait_for_load_state('domcontentloaded')
        await asyncio.sleep(5)
        
        # Wait for page to load and check authentication
        print(f"[SFSender] Waiting for page to load...")
        await asyncio.sleep(5)
        
        current_url = page.url
        print(f"[SFSender] Current URL: {current_url}")
        
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
        
        Flow:
        1. Click the Search button to open search
        2. Type the lead's name
        3. Press Enter to search
        4. Click on the Lead result
        """
        search_term = name  # Search by name (more reliable than email in SF)
        print(f"  [SFSender] Searching for Lead: {search_term}")
        
        # First, go to Salesforce LIGHTNING home (not classic)
        print(f"  [SFSender] Navigating to Salesforce Lightning...")
        await page.goto('https://zcocorp.lightning.force.com/lightning/page/home', timeout=60000)
        
        # Wait for redirects to complete - Salesforce does multiple redirects
        print(f"  [SFSender] Waiting for page to fully load (this may take 30+ seconds)...")
        
        # Keep waiting until we're actually on Lightning (up to 60 seconds)
        max_wait = 60
        waited = 0
        while waited < max_wait:
            current_url = page.url
            print(f"  [SFSender] Checking URL ({waited}s): {current_url[:80]}...")
            
            if 'lightning.force.com' in current_url and '/lightning/' in current_url:
                print(f"  [SFSender] On Lightning!")
                break
            
            await asyncio.sleep(3)
            waited += 3
        
        # Final wait for UI to fully render
        print(f"  [SFSender] Waiting 10 seconds for UI to render...")
        await asyncio.sleep(10)
        print(f"  [SFSender] Ready! URL: {page.url}")
        
        # Step 1: Click the Search button to open search
        # Button HTML: <button type="button" class="slds-button slds-button_neutral search-button slds-truncate" aria-label="Search">
        print(f"  [SFSender] Looking for search button...")
        
        # Wait for the search button to appear (with retries)
        search_button = None
        max_attempts = 10
        for attempt in range(max_attempts):
            # Try different selectors
            for selector in ['button.search-button', 'button[aria-label="Search"]', 'button:has-text("Search")']:
                locator = page.locator(selector)
                count = await locator.count()
                if count > 0:
                    print(f"  [SFSender] Found search button with '{selector}' (attempt {attempt + 1})")
                    search_button = locator.first
                    break
            
            if search_button:
                break
            
            print(f"  [SFSender] Search button not found yet, waiting... (attempt {attempt + 1}/{max_attempts})")
            await asyncio.sleep(2)
        
        if not search_button:
            print(f"  [SFSender] No search button found after {max_attempts} attempts!")
            try:
                screenshot_path = str(config.DATA_DIR / "search_button_debug.png")
                await page.screenshot(path=screenshot_path)
                print(f"  [SFSender] Screenshot saved to: {screenshot_path}")
            except:
                pass
            return None
        
        try:
            print(f"  [SFSender] Clicking search button...")
            
            # Use force click to bypass any overlays
            await search_button.click(force=True)
            await asyncio.sleep(2)
            print(f"  [SFSender] Search button clicked!")
            
        except Exception as e:
            print(f"  [SFSender] Click failed: {e}")
            # Try JavaScript click as fallback
            try:
                print(f"  [SFSender] Trying JavaScript click...")
                result = await page.evaluate('''() => {
                    const btn = document.querySelector('button.search-button') || 
                                document.querySelector('button[aria-label="Search"]');
                    if (btn) {
                        btn.click();
                        return 'clicked';
                    }
                    return 'not found';
                }''')
                print(f"  [SFSender] JavaScript click result: {result}")
                await asyncio.sleep(2)
            except Exception as e2:
                print(f"  [SFSender] JavaScript click also failed: {e2}")
                return None
        
        # Step 2: Wait for and find the search input that appears after clicking
        print(f"  [SFSender] Looking for search input field...")
        await asyncio.sleep(2)  # Wait for search dialog to open
        
        # Try multiple selectors with retries
        search_input = None
        input_selectors = [
            'input[type="search"]',
            'input[placeholder*="Search"]',
            'input.slds-input',
            'input[role="combobox"]',
            '.search-input input',
            'input'
        ]
        
        for attempt in range(5):
            for selector in input_selectors:
                try:
                    locator = page.locator(selector)
                    count = await locator.count()
                    if count > 0:
                        # Check if it's visible
                        first = locator.first
                        if await first.is_visible():
                            print(f"  [SFSender] Found search input with '{selector}'")
                            search_input = first
                            break
                except:
                    continue
            
            if search_input:
                break
            
            print(f"  [SFSender] Search input not found yet (attempt {attempt + 1}/5)")
            await asyncio.sleep(1)
        
        if not search_input:
            print(f"  [SFSender] Could not find search input!")
            # Take screenshot for debugging
            try:
                screenshot_path = str(config.DATA_DIR / "search_input_debug.png")
                await page.screenshot(path=screenshot_path)
                print(f"  [SFSender] Screenshot saved to: {screenshot_path}")
            except:
                pass
            return None
        
        # Type the search term
        try:
            print(f"  [SFSender] Typing search term: {search_term}")
            await search_input.click()
            await asyncio.sleep(0.5)
            await search_input.fill(search_term)
            await asyncio.sleep(1)
            
            # Step 3: Press Enter to search
            print(f"  [SFSender] Pressing Enter to search...")
            await search_input.press('Enter')
            
            # Wait for results
            print(f"  [SFSender] Waiting for search results...")
            await asyncio.sleep(5)
            
            print(f"  [SFSender] Search results page: {page.url}")
            
        except Exception as e:
            print(f"  [SFSender] Search input error: {e}")
            return None
        
        # Step 4: Look for Lead in search results table
        # Wait for results table to appear
        print(f"  [SFSender] Looking for Lead '{name}' in search results...")
        await asyncio.sleep(3)  # Wait for results to load
        
        # The search results show a table with lead names as links
        # Selector: a[data-refid="recordId"][title="Name"] or a.outputLookupLink[title="Name"]
        lead_selectors = [
            # Exact match on name in title attribute
            f'a[data-refid="recordId"][title="{name}"]',
            f'a.outputLookupLink[title="{name}"]',
            # Link containing the name text
            f'a[data-refid="recordId"]:has-text("{name}")',
            f'a.forceOutputLookup:has-text("{name}")',
            # Any record link (fallback)
            'a[data-refid="recordId"]',
        ]
        
        for selector in lead_selectors:
            try:
                result = page.locator(selector).first
                count = await result.count()
                if count > 0:
                    print(f"  [SFSender] Found Lead with selector: {selector}")
                    
                    # Get the href before clicking
                    href = await result.get_attribute('href')
                    print(f"  [SFSender] Lead link href: {href}")
                    
                    # Click on the lead name
                    await result.click()
                    
                    # Wait for Lead page to load
                    print(f"  [SFSender] Waiting for Lead page to load...")
                    await asyncio.sleep(5)
                    
                    current_url = page.url
                    print(f"  [SFSender] Current URL: {current_url}")
                    
                    # Check if we're on the Lead page (URL contains record ID or /Lead/)
                    if '/lightning/r/' in current_url or '/Lead/' in current_url:
                        print(f"  [SFSender] On Lead page: {current_url}")
                        return current_url
                    
            except Exception as e:
                print(f"  [SFSender] Error with selector {selector}: {e}")
                continue
        
        # If name search didn't find a Lead, try email as backup
        if email and email != name:
            print(f"  [SFSender] Name search failed, trying email: {email}")
            try:
                # Click search button again
                search_button = page.locator('button[aria-label="Search"]').first
                await search_button.click()
                await asyncio.sleep(1)
                
                search_input = page.locator('input[type="search"]').first
                await search_input.fill(email)
                await search_input.press('Enter')
                
                await page.wait_for_load_state('networkidle', timeout=15000)
                await asyncio.sleep(3)
                
                # Try to find Lead link
                lead_link = page.locator('a[href*="/Lead/"]').first
                if await lead_link.count() > 0:
                    await lead_link.click()
                    await page.wait_for_load_state('networkidle')
                    await asyncio.sleep(2)
                    
                    if '/Lead/' in page.url:
                        print(f"  [SFSender] Found Lead by email: {page.url}")
                        return page.url
            except:
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
        Uses exact selectors from Salesforce Lightning.
        """
        print("  [SFSender] Looking for Email button...")
        
        # Wait for page to fully load
        await asyncio.sleep(3)
        
        # Exact selector from user's Salesforce org:
        # <button value="SendEmail" title="Email" aria-label="Email" class="slds-button slds-button_neutral">
        email_btn = None
        btn_selectors = [
            'button[value="SendEmail"]',
            'button[aria-label="Email"]',
            'button[title="Email"]',
            'button.slds-button_neutral:has-text("Email")',
        ]
        
        for attempt in range(5):
            for selector in btn_selectors:
                try:
                    locator = page.locator(selector)
                    count = await locator.count()
                    if count > 0:
                        # Make sure it's visible
                        first = locator.first
                        if await first.is_visible():
                            print(f"  [SFSender] Found Email button with '{selector}'")
                            email_btn = first
                            break
                except:
                    continue
            
            if email_btn:
                break
            
            print(f"  [SFSender] Email button not found yet (attempt {attempt + 1}/5)")
            await asyncio.sleep(2)
        
        if not email_btn:
            print("  [SFSender] Could not find Email button!")
            try:
                screenshot_path = str(config.DATA_DIR / "email_button_debug.png")
                await page.screenshot(path=screenshot_path)
                print(f"  [SFSender] Screenshot saved to: {screenshot_path}")
            except:
                pass
            return False
        
        try:
            print("  [SFSender] Clicking Email button...")
            await email_btn.click()
            await asyncio.sleep(3)
            
            # Wait for email composer to open
            print("  [SFSender] Waiting for email composer to open...")
            composer = page.locator('.cuf-publisherShareButton').or_(
                page.locator('.emailComposer')
            ).or_(
                page.locator('iframe[title="Email Body"]')
            ).or_(
                page.locator('.forceChatterPublisherEmail')
            )
            
            await composer.wait_for(state='visible', timeout=15000)
            print("  [SFSender] Email composer opened!")
            return True
            
        except Exception as e:
            print(f"  [SFSender] Error opening email composer: {e}")
            return False
    
    async def select_template(self, page: Page, template_name: str) -> bool:
        """
        Select an email template in the composer.
        Uses exact selectors from Salesforce Lightning.
        
        Flow:
        1. Click "Insert, create, or update template" icon
        2. Select template from dropdown menu
        """
        print(f"  [SFSender] Selecting template: {template_name}")
        
        try:
            # Step 1: Click the template insert button
            # Selector: lightning-icon[icon-name="utility:insert_template"]
            template_btn = page.locator('lightning-icon[icon-name="utility:insert_template"]').or_(
                page.locator('a.iconTrigger:has(lightning-icon[icon-name="utility:insert_template"])')
            ).or_(
                page.locator('.cuf-attachmentsItem a[role="button"]')
            ).first
            
            await template_btn.wait_for(state='visible', timeout=10000)
            print("  [SFSender] Found template button, clicking...")
            await template_btn.click()
            await asyncio.sleep(1)
            
            # Step 2: Wait for menu to appear and select template
            # Selector: a.highlightButton[title="Footer"]
            template_option = page.locator(f'a.highlightButton[title="{template_name}"]').or_(
                page.locator(f'a[role="menuitem"][title="{template_name}"]')
            ).or_(
                page.locator(f'a[role="menuitem"]:has-text("{template_name}")')
            ).first
            
            await template_option.wait_for(state='visible', timeout=5000)
            print(f"  [SFSender] Found template '{template_name}', clicking...")
            await template_option.click()
            await asyncio.sleep(1)
            
            print(f"  [SFSender] Template '{template_name}' selected")
            return True
            
        except Exception as e:
            print(f"  [SFSender] Template selection failed: {e}")
            return False
    
    async def fill_email_body(self, page: Page, subject: str, body: str, sign_off: str = "Best,") -> bool:
        """
        Fill in the email subject and body.
        Uses Tab/Shift+Tab navigation to move between fields in Salesforce email UI.
        Clears the BCC field (Salesforce auto-adds sender's email) at the end.
        """
        print("  [SFSender] Filling email content...")
        
        try:
            # Step 1: Find and click subject field
            subject_field = page.locator('input[placeholder*="Subject"]').or_(
                page.get_by_label('Subject')
            ).or_(
                page.locator('input[name="subject"]')
            ).first
            
            if await subject_field.count() == 0:
                print("  [SFSender] Subject field not found!")
                return False
            
            await subject_field.click()
            await asyncio.sleep(0.3)
            
            # Step 2: Fill subject
            if subject:
                await subject_field.fill(subject)
                print(f"  [SFSender] Subject filled: {subject[:50]}...")
            
            # Step 3: Tab to body and fill it
            if body:
                print("  [SFSender] Tab to Body field...")
                await page.keyboard.press('Tab')
                await asyncio.sleep(0.5)
                
                # Add sign-off to body
                full_body = f"{body}\n\n{sign_off}"
                
                # Type the body content
                print("  [SFSender] Typing body content...")
                await page.keyboard.type(full_body)
                print(f"  [SFSender] Body filled with sign-off ({len(full_body)} chars)")
            
            # Step 4: Now go back and clear BCC
            # Shift+Tab from body -> subject -> BCC
            print("  [SFSender] Navigating back to clear BCC...")
            await page.keyboard.press('Shift+Tab')  # Body -> Subject
            await asyncio.sleep(0.2)
            await page.keyboard.press('Shift+Tab')  # Subject -> BCC
            await asyncio.sleep(0.2)
            
            # Clear BCC by hitting backspace many times
            print("  [SFSender] Clearing BCC field (hitting backspace)...")
            for _ in range(50):  # Hit backspace 50 times to be sure
                await page.keyboard.press('Backspace')
            await asyncio.sleep(0.2)
            print("  [SFSender] BCC cleared")
            
            # Step 5: Click Maximize button to expand email composer
            print("  [SFSender] Clicking Maximize button...")
            max_btn = page.locator('button[title="Maximize"]').or_(
                page.locator('button.maxButton')
            ).first
            
            try:
                if await max_btn.count() > 0:
                    await max_btn.click()
                    await asyncio.sleep(0.5)
                    print("  [SFSender] Email composer maximized")
            except Exception as e:
                print(f"  [SFSender] Could not maximize: {e}")
            
            return True
            
        except Exception as e:
            print(f"  [SFSender] Error filling email: {e}")
            return False
    
    async def send_email(self, page: Page) -> bool:
        """Click the Send button and verify success."""
        print("  [SFSender] Clicking Send...")
        
        # Look for Send button - multiple possible selectors including the specific one from user's org
        send_btn = page.locator('button.cuf-publisherShareButton.send').or_(
            page.locator('button.slds-button--brand:has-text("Send")')
        ).or_(
            page.locator('button.slds-button:has-text("Send")')
        ).or_(
            page.get_by_role('button', name='Send')
        ).or_(
            page.locator('button[title="Send"]')
        ).or_(
            page.locator('input[value="Send"]')
        ).first
        
        try:
            await send_btn.wait_for(state='visible', timeout=10000)
            print("  [SFSender] Found Send button, clicking...")
            await send_btn.click()
            print("  [SFSender] Send button clicked!")
            await asyncio.sleep(3)
            
            # Check for success toast
            toast = page.locator('.toastMessage, .slds-notify__content')
            try:
                await toast.wait_for(state='visible', timeout=5000)
                text = await toast.text_content()
                print(f"  [SFSender] Toast: {text}")
                return 'sent' in text.lower() or 'success' in text.lower() or 'email' in text.lower()
            except:
                # No toast, might still have succeeded
                print("  [SFSender] No toast message, assuming success")
                pass
            
            return True
        except Exception as e:
            print(f"  [SFSender] Send failed: {e}")
            return False
    
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


async def run_salesforce_sender(
    campaign_id: int = None,
    template_name: str = None,
    limit: int = 10,
    headless: bool = False
) -> Dict:
    """
    Main entry point for sending campaign emails via Salesforce.
    """
    if not template_name:
        print("[SFSender] ERROR: template_name is required")
        return {'error': 'template_name is required'}
    
    sender = SalesforceSender()
    
    try:
        # Start browser and authenticate
        if not await sender.start(headless=headless):
            return {'error': 'Failed to start browser or authenticate'}
        
        # Get contacts ready for email
        contacts = db.get_contacts_ready_for_email(
            campaign_id=campaign_id,
            limit=limit
        )
        
        if not contacts:
            print("[SFSender] No contacts ready for email")
            # Keep browser open for debugging
            print("[SFSender] Browser will stay open - close manually when done")
            input("Press ENTER to close browser...")
            await sender.stop()
            return {'processed': 0, 'sent': 0, 'failed': 0}
        
        print(f"[SFSender] Found {len(contacts)} contacts ready for email")
        
        # Process contacts
        results = await sender.process_contacts_parallel(contacts, template_name)
        
        print(f"\n{'='*60}")
        print(f"[SFSender] RESULTS:")
        print(f"  Processed: {results['processed']}")
        print(f"  Sent: {results['sent']}")
        print(f"  Failed: {results['failed']}")
        print(f"{'='*60}")
        
        # Keep browser open for review
        print("\n[SFSender] Browser will stay open - close manually when done")
        input("Press ENTER to close browser...")
        
        await sender.stop()
        return results
        
    except Exception as e:
        import traceback
        print(f"[SFSender] ERROR: {e}")
        print(traceback.format_exc())
        await sender.stop()
        return {'error': str(e)}


# Test function - just opens browser and authenticates
async def test_browser():
    """Simple test to verify browser opens and can authenticate."""
    print("=" * 60)
    print("SALESFORCE SENDER - BROWSER TEST")
    print("=" * 60)
    
    sender = SalesforceSender()
    
    try:
        success = await sender.start(headless=False)
        
        if success:
            print("\n[OK] Browser opened and authenticated successfully!")
            print("\nThe browser is now open. You can:")
            print("1. Navigate around Salesforce to verify the session works")
            print("2. Inspect the Lead page to find the Email button selectors")
            print("3. Look at the email composer to understand template selection")
            print("\nWhen done, press ENTER to close the browser.")
            input()
        else:
            print("\n[FAIL] Failed to authenticate")
        
        await sender.stop()
        
    except Exception as e:
        print(f"\nERROR: {e}")
        import traceback
        traceback.print_exc()


async def test_email_flow(lead_url: str = None):
    """
    Test the email sending flow on a single Lead.
    Opens browser, navigates to Lead, prepares email, but does NOT send.
    Leaves browser open for user to review and send manually.
    
    Args:
        lead_url: Direct URL to a Lead page (optional)
    """
    print("=" * 60)
    print("SALESFORCE SENDER - EMAIL FLOW TEST")
    print("=" * 60)
    print("\nThis will:")
    print("1. Open browser and authenticate")
    print("2. Navigate to the Lead page")
    print("3. Click Email button")
    print("4. Select Footer template")
    print("5. Fill in test subject/body")
    print("6. Leave browser open for YOU to review and send")
    print("=" * 60)
    
    sender = SalesforceSender()
    
    try:
        # Step 1: Start browser and authenticate
        print("\n[Step 1] Starting browser...")
        if not await sender.start(headless=False):
            print("[FAIL] Could not authenticate")
            return
        
        page = sender.pages[0]
        
        # Step 2: Navigate to Lead
        if lead_url:
            print(f"\n[Step 2] Navigating to Lead: {lead_url}")
            await page.goto(lead_url, timeout=60000)
            await page.wait_for_load_state('networkidle')
            await asyncio.sleep(3)
            print(f"Current URL: {page.url}")
        else:
            print("\n[Step 2] No Lead URL provided.")
            print("Please navigate to a Lead page manually in the browser.")
            input("Press ENTER when you're on a Lead page...")
        
        # Step 3: Test Email button
        print("\n[Step 3] Clicking Email button...")
        if await sender.click_send_email(page):
            print("[OK] Email composer opened!")
        else:
            print("[FAIL] Could not open email composer")
            print("The browser is still open - check what happened.")
            input("\nPress ENTER to close browser...")
            await sender.stop()
            return
        
        # Step 4: Test template selection
        print("\n[Step 4] Selecting Footer template...")
        if await sender.select_template(page, "Footer"):
            print("[OK] Template selected!")
        else:
            print("[WARNING] Could not select template - continuing anyway")
        
        # Step 5: Fill email body with test content
        print("\n[Step 5] Filling email content...")
        test_subject = "Test Email - Please Delete"
        test_body = "This is a test email from the automation script.\n\nDO NOT SEND - just testing the flow."
        
        if await sender.fill_email_body(page, test_subject, test_body):
            print("[OK] Email content filled!")
        else:
            print("[WARNING] Could not fill email content")
        
        # Done - leave browser open
        print("\n" + "=" * 60)
        print("TEST COMPLETE - EMAIL READY TO REVIEW")
        print("=" * 60)
        print("\nThe browser is open with the email composer.")
        print("You can:")
        print("  - Review the email")
        print("  - Edit the content if needed")
        print("  - Click SEND to send (or close without sending)")
        print("\nWhen done, press ENTER here to close the browser.")
        input()
        
        await sender.stop()
        
    except Exception as e:
        print(f"\nERROR: {e}")
        import traceback
        traceback.print_exc()
        try:
            await sender.stop()
        except:
            pass


if __name__ == "__main__":
    import sys
    
    if len(sys.argv) > 1 and sys.argv[1] == "test-email":
        # Test email flow with optional Lead URL
        lead_url = sys.argv[2] if len(sys.argv) > 2 else None
        asyncio.run(test_email_flow(lead_url))
    else:
        # Default: just test browser
        asyncio.run(test_browser())

