"""
Salesforce Page Objects: Decouple from DOM details for reliability.
Uses role/label-based locators where possible.
"""
from typing import Optional, Dict
from playwright.async_api import Page, Locator, expect
import asyncio


class SalesforceBasePage:
    """Base page with common Salesforce Lightning functionality."""
    
    def __init__(self, page: Page):
        self.page = page
        self.timeout = 15000  # 15s default timeout
    
    async def wait_for_lightning_ready(self):
        """Wait for Lightning framework to be ready."""
        await self.page.wait_for_load_state('networkidle', timeout=self.timeout)
        # Wait for spinner to disappear
        spinner = self.page.locator('.slds-spinner_container')
        try:
            await spinner.wait_for(state='hidden', timeout=5000)
        except:
            pass  # Spinner may not appear
    
    async def get_toast_message(self) -> Optional[str]:
        """Get toast notification message if present."""
        try:
            toast = self.page.locator('.toastMessage, .slds-notify__content')
            await toast.wait_for(state='visible', timeout=5000)
            return await toast.text_content()
        except:
            return None
    
    async def wait_for_toast(self, expected_text: str = None, timeout: int = 10000) -> bool:
        """Wait for a toast notification."""
        try:
            toast = self.page.locator('.toastMessage, .slds-notify__content')
            await toast.wait_for(state='visible', timeout=timeout)
            if expected_text:
                text = await toast.text_content()
                return expected_text.lower() in text.lower()
            return True
        except:
            return False
    
    async def dismiss_toast(self):
        """Dismiss any visible toast notification."""
        try:
            close_btn = self.page.locator('.toastClose, .slds-notify__close')
            if await close_btn.is_visible():
                await close_btn.click()
        except:
            pass
    
    async def capture_screenshot(self, path: str):
        """Capture screenshot for debugging."""
        await self.page.screenshot(path=path, full_page=True)
    
    async def get_current_url(self) -> str:
        """Get current page URL."""
        return self.page.url


class GlobalSearch(SalesforceBasePage):
    """Global search functionality."""
    
    async def search(self, query: str) -> bool:
        """
        Perform global search.
        Returns True if search executed successfully.
        """
        # Click search box (multiple possible selectors for different SF versions)
        search_input = self.page.get_by_placeholder('Search...').or_(
            self.page.locator('input[type="search"]')
        ).or_(
            self.page.locator('.slds-global-header__item_search input')
        ).first
        
        await search_input.click()
        await search_input.fill(query)
        await search_input.press('Enter')
        
        await self.wait_for_lightning_ready()
        return True
    
    async def get_search_results(self) -> list:
        """Get search result items."""
        results = self.page.locator('.searchResultItem, .slds-listbox__option')
        count = await results.count()
        
        items = []
        for i in range(min(count, 10)):  # Max 10 results
            item = results.nth(i)
            text = await item.text_content()
            items.append({'index': i, 'text': text})
        
        return items
    
    async def click_result_by_text(self, text: str) -> bool:
        """Click a search result containing the given text."""
        result = self.page.locator(f'.searchResultItem:has-text("{text}")').or_(
            self.page.locator(f'.slds-listbox__option:has-text("{text}")')
        ).first
        
        try:
            await result.click()
            await self.wait_for_lightning_ready()
            return True
        except:
            return False


class LeadPage(SalesforceBasePage):
    """Lead record page operations."""
    
    async def is_lead_page(self) -> bool:
        """Check if we're on a Lead record page."""
        url = self.page.url
        return '/Lead/' in url or 'Lead' in await self.page.title()
    
    async def create_new_lead(self) -> bool:
        """Navigate to new Lead creation."""
        # Go to Leads tab
        print("      [LeadPage] Navigating to Leads list...")
        await self.page.goto('/lightning/o/Lead/list', timeout=30000)
        await self.page.wait_for_load_state('domcontentloaded', timeout=20000)
        await asyncio.sleep(2)
        await self.wait_for_lightning_ready()
        
        print("      [LeadPage] Looking for New button...")
        # Click New button - try multiple selectors
        new_btn = self.page.get_by_role('button', name='New').or_(
            self.page.locator('a[title="New"]')
        ).or_(
            self.page.locator('button[name="New"]')
        ).or_(
            self.page.locator('[data-target-selection-name="sfdc:StandardButton.Lead.New"]')
        ).first
        
        try:
            await new_btn.wait_for(state='visible', timeout=10000)
            print("      [LeadPage] Found New button, clicking...")
            await new_btn.click()
        except Exception as e:
            print(f"      [LeadPage] Could not find/click New button: {e}")
            return False
        
        # Wait for modal
        print("      [LeadPage] Waiting for Lead form modal...")
        try:
            modal = self.page.locator('.modal-container, .slds-modal, [role="dialog"]')
            await modal.wait_for(state='visible', timeout=10000)
            await asyncio.sleep(1)
            print("      [LeadPage] Lead form modal visible")
            return True
        except Exception as e:
            print(f"      [LeadPage] Modal did not appear: {e}")
            return False
    
    async def fill_lead_form(
        self,
        first_name: str = None,
        last_name: str = None,
        company: str = None,
        title: str = None,
        email: str = None,
        website: str = None,
        lead_source: str = None,
        description: str = None
    ) -> bool:
        """
        Fill Lead form fields.
        Uses label-based locators for reliability.
        """
        print("      [LeadPage] Filling Lead form fields...")
        
        async def fill_field(label: str, value: str, required: bool = False):
            """Helper to fill a field with fallback selectors."""
            if not value:
                return True
            
            try:
                # Try label-based first
                field = self.page.get_by_label(label, exact=False).first
                if await field.count() > 0:
                    await field.click()
                    await field.fill(value)
                    print(f"        [LeadPage] Filled {label}: {value[:30]}...")
                    return True
                
                # Fallback to input with placeholder
                field = self.page.locator(f'input[placeholder*="{label}"]').first
                if await field.count() > 0:
                    await field.fill(value)
                    return True
                
                if required:
                    print(f"        [LeadPage] WARNING: Could not find required field: {label}")
                    return False
                return True
                
            except Exception as e:
                print(f"        [LeadPage] Error filling {label}: {e}")
                return not required  # Fail only if required
        
        try:
            # Last Name (required)
            if not await fill_field('Last Name', last_name, required=True):
                return False
            
            # First Name
            await fill_field('First Name', first_name)
            
            # Company (required)
            if not await fill_field('Company', company, required=True):
                return False
            
            # Title
            await fill_field('Title', title)
            
            # Email
            await fill_field('Email', email)
            
            # Website
            await fill_field('Website', website)
            
            # Lead Source (dropdown) - optional
            if lead_source:
                try:
                    dropdown = self.page.get_by_label('Lead Source', exact=False)
                    if await dropdown.count() > 0:
                        await dropdown.click()
                        await asyncio.sleep(0.5)
                        option = self.page.get_by_role('option', name=lead_source)
                        if await option.count() > 0:
                            await option.click()
                except:
                    pass
            
            # Description - optional
            if description:
                try:
                    field = self.page.get_by_label('Description', exact=False).or_(
                        self.page.locator('textarea')
                    ).first
                    if await field.count() > 0:
                        await field.fill(description[:5000])
                except:
                    pass
            
            print("      [LeadPage] Form filled successfully")
            return True
            
        except Exception as e:
            print(f"      [LeadPage] Error filling lead form: {e}")
            return False
    
    async def save_lead(self) -> Optional[str]:
        """
        Save the Lead and return the record URL.
        Returns None on failure.
        """
        print("      [LeadPage] Looking for Save button...")
        save_btn = self.page.get_by_role('button', name='Save').or_(
            self.page.locator('button[title="Save"]')
        ).or_(
            self.page.locator('button[name="SaveEdit"]')
        ).first
        
        try:
            await save_btn.wait_for(state='visible', timeout=5000)
            print("      [LeadPage] Clicking Save...")
            await save_btn.click()
        except Exception as e:
            print(f"      [LeadPage] Could not click Save: {e}")
            return None
        
        # Wait for save to complete
        print("      [LeadPage] Waiting for save to complete...")
        await asyncio.sleep(2)
        await self.wait_for_lightning_ready()
        
        # Check for error toast
        toast_text = await self.get_toast_message()
        if toast_text:
            print(f"      [LeadPage] Toast message: {toast_text}")
            if 'error' in toast_text.lower():
                return None
        
        # Wait for redirect to record page
        try:
            print("      [LeadPage] Waiting for redirect to Lead record...")
            await self.page.wait_for_url('**/Lead/**', timeout=15000)
            print(f"      [LeadPage] Redirected to: {self.page.url}")
            return self.page.url
        except Exception as e:
            print(f"      [LeadPage] No redirect detected: {e}")
            # Check if we're already on a Lead page
            if '/Lead/' in self.page.url:
                return self.page.url
            return None
    
    async def get_lead_id_from_url(self) -> Optional[str]:
        """Extract Lead ID from current URL."""
        url = self.page.url
        # URL format: /lightning/r/Lead/00Q.../view
        import re
        match = re.search(r'/Lead/([a-zA-Z0-9]+)', url)
        return match.group(1) if match else None


class ContactPage(SalesforceBasePage):
    """Contact record page operations (similar to Lead)."""
    
    async def is_contact_page(self) -> bool:
        """Check if we're on a Contact record page."""
        url = self.page.url
        return '/Contact/' in url


class EmailComposer(SalesforceBasePage):
    """Email composition from record page."""
    
    async def open_email_composer(self) -> bool:
        """
        Open the email composer from a record page.
        Clicks the Email action button.
        """
        print("      [EmailComposer] Looking for Email button...")
        
        # Try multiple selectors for Email button in Salesforce Lightning
        email_btn = self.page.get_by_role('button', name='Email').or_(
            self.page.locator('button[title="Email"]')
        ).or_(
            self.page.locator('a[title="Email"]')
        ).or_(
            self.page.locator('button[name="SendEmail"]')
        ).or_(
            self.page.locator('[data-target-selection-name*="SendEmail"]')
        ).or_(
            self.page.locator('lightning-button:has-text("Email")')
        ).or_(
            self.page.locator('runtime_sales_activitiesactivitytimelineitem >> text=Email').first
        ).first
        
        try:
            await email_btn.wait_for(state='visible', timeout=10000)
            print("      [EmailComposer] Found Email button, clicking...")
            await email_btn.click()
            await asyncio.sleep(2)
            
            # Wait for composer to open - try multiple possible containers
            print("      [EmailComposer] Waiting for composer to open...")
            composer = self.page.locator('.emailComposer').or_(
                self.page.locator('.cuf-publisherShareButton')
            ).or_(
                self.page.locator('iframe[title*="Email"]')
            ).or_(
                self.page.locator('[data-component-id="emailComposer"]')
            ).or_(
                self.page.locator('.forceChatterPublisherEmail')
            ).or_(
                self.page.locator('.draftEmail')
            )
            
            await composer.wait_for(state='visible', timeout=15000)
            print("      [EmailComposer] Composer opened")
            await asyncio.sleep(1)
            
            return True
        except Exception as e:
            print(f"      [EmailComposer] Error opening composer: {e}")
            # Take screenshot to debug
            return False
    
    async def fill_email(
        self,
        to: str = None,
        subject: str = None,
        body: str = None
    ) -> bool:
        """
        Fill email fields.
        Note: 'To' is often pre-filled from the record.
        """
        try:
            # Check if we need to handle an iframe
            iframe = self.page.locator('iframe[title*="Email"]').first
            if await iframe.count() > 0:
                frame = iframe.content_frame()
            else:
                frame = self.page
            
            # Subject
            if subject:
                subject_field = frame.get_by_label('Subject', exact=False).or_(
                    frame.locator('input[placeholder*="Subject"]')
                ).or_(
                    frame.locator('input[name="subject"]')
                ).first
                await subject_field.fill(subject)
            
            # Body (could be rich text editor)
            if body:
                # Try plain textarea first
                body_field = frame.locator('textarea.slds-textarea').or_(
                    frame.get_by_label('Body', exact=False)
                ).or_(
                    frame.locator('.ql-editor')  # Quill editor
                ).or_(
                    frame.locator('[contenteditable="true"]')
                ).first
                
                if await body_field.count() > 0:
                    tag = await body_field.evaluate('el => el.tagName')
                    if tag.lower() == 'textarea':
                        await body_field.fill(body)
                    else:
                        # Rich text editor - need to click and type
                        await body_field.click()
                        await body_field.fill(body)
            
            # To field (if not pre-filled)
            if to:
                to_field = frame.get_by_label('To', exact=False).or_(
                    frame.locator('input[placeholder*="To"]')
                ).first
                
                current_value = await to_field.input_value() if await to_field.count() > 0 else ''
                if not current_value:
                    await to_field.fill(to)
            
            return True
            
        except Exception as e:
            print(f"Error filling email: {e}")
            return False
    
    async def send_email(self, skip_click: bool = False) -> bool:
        """
        Click Send button and verify success.
        
        Args:
            skip_click: If True, DON'T click send - just verify email is ready.
                       Used for review mode where user manually clicks send.
        
        Returns True if email sent successfully (or ready to send if skip_click).
        """
        # Check for iframe
        iframe = self.page.locator('iframe[title*="Email"]').first
        if await iframe.count() > 0:
            frame = iframe.content_frame()
        else:
            frame = self.page
        
        send_btn = frame.get_by_role('button', name='Send').or_(
            frame.locator('button[title="Send"]')
        ).or_(
            frame.locator('.slds-button:has-text("Send")')
        ).first
        
        # In review mode, just verify send button is visible but don't click
        if skip_click:
            try:
                await send_btn.wait_for(state='visible', timeout=5000)
                return True  # Email is ready for manual review
            except:
                return False
        
        await send_btn.click()
        
        # Wait for confirmation
        await self.wait_for_lightning_ready()
        
        # Check for success toast
        success = await self.wait_for_toast('sent', timeout=10000)
        
        return success
    
    async def cancel_email(self):
        """Cancel the email composer."""
        cancel_btn = self.page.get_by_role('button', name='Cancel').first
        try:
            await cancel_btn.click()
        except:
            pass


class ActivityTimeline(SalesforceBasePage):
    """Activity timeline on record pages."""
    
    async def get_recent_activities(self, limit: int = 5) -> list:
        """Get recent activities from timeline."""
        activities = self.page.locator('.slds-timeline__item, .activityTimeline .timelineItem')
        count = await activities.count()
        
        items = []
        for i in range(min(count, limit)):
            item = activities.nth(i)
            text = await item.text_content()
            items.append({'index': i, 'text': text})
        
        return items
    
    async def verify_email_sent(self, subject: str) -> bool:
        """Verify that an email with the given subject appears in timeline."""
        activities = await self.get_recent_activities(10)
        
        for activity in activities:
            if subject.lower() in activity['text'].lower():
                if 'email' in activity['text'].lower() or 'sent' in activity['text'].lower():
                    return True
        
        return False

