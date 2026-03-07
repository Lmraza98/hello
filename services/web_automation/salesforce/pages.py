"""
Salesforce Page Objects: Decouple from DOM details for reliability.
Uses role/label-based locators where possible.
"""
from typing import Optional, Dict
from playwright.async_api import Page, Locator, expect
import asyncio
import re
from urllib.parse import quote


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
        
        Salesforce Lightning has a two-step search:
        1. Click the search bar/button to ACTIVATE/EXPAND the search input
        2. Only then is the actual text input visible and typeable
        """
        # ── Step 1: Activate the search bar ──
        # The search input is hidden behind a button until clicked.
        activate_selectors = [
            "button.search-button",                                 # Main search button ("Search...")
            "button.slds-button_neutral.search-button",             # Neutral variant
            ".forceSearchAssistant button",                         # Search assistant wrapper
            "button[aria-label='Search']",                          # Aria-labelled search button
            ".slds-global-header__item_search button",              # Header search button
            ".slds-global-header__item--search button",             # Alt header class
            "[role='search'] button",                               # Search role
        ]
        
        activated = False
        for sel in activate_selectors:
            try:
                btn = self.page.locator(sel).first
                if await btn.count() > 0 and await btn.is_visible():
                    await btn.click()
                    activated = True
                    print(f"[GlobalSearch] Activated search via: {sel}")
                    break
            except Exception:
                continue
        
        if not activated:
            # Fallback: maybe the input is already visible (older SF versions)
            print("[GlobalSearch] No activation button found, trying input directly")
        
        # Brief wait for the search input to expand/appear
        await asyncio.sleep(0.8)
        
        # ── Step 2: Find and fill the now-visible input ──
        input_selectors = [
            "input.slds-input[type='search']",
            "input[placeholder='Search...']",
            "input[placeholder='Search Salesforce']",
            "input[role='combobox']",
            ".slds-global-header__item_search input[type='search']",
            "input.search-input",
            "input[type='search']",
        ]
        
        search_input = None
        for sel in input_selectors:
            try:
                field = self.page.locator(sel).first
                if await field.count() > 0 and await field.is_visible():
                    search_input = field
                    print(f"[GlobalSearch] Found input via: {sel}")
                    break
            except Exception:
                continue
        
        if not search_input:
            print("[GlobalSearch] Could not find visible search input after activation")
            # Debug: take screenshot
            try:
                import config
                await self.page.screenshot(
                    path=str(config.SCREENSHOTS_DIR / "debug_search_state.png"),
                    full_page=True,
                )
                print("[GlobalSearch] Debug screenshot saved")
            except Exception:
                pass
            return False
        
        # ── Step 3: Type query and submit ──
        await search_input.click()
        await search_input.fill(query)
        await asyncio.sleep(0.5)
        await search_input.press("Enter")
        
        await self.wait_for_lightning_ready()
        return True
    
    async def get_search_results(self) -> list:
        """Get search result items."""
        # Try the data-table results first (search results page)
        results = self.page.locator(
            'table[role="grid"] a[data-refid="recordId"]'
        ).or_(
            self.page.locator('.searchResultItem')
        ).or_(
            self.page.locator('.slds-listbox__option')
        )
        count = await results.count()
        
        items = []
        for i in range(min(count, 10)):
            item = results.nth(i)
            text = (await item.get_attribute('title')) or (await item.text_content()) or ''
            href = await item.get_attribute('href')
            items.append({'index': i, 'text': text, 'href': href})
        
        return items
    
    async def get_record_url_by_name(self, name: str) -> str | None:
        """
        Find a record link in the search results table by name and return its URL.
        
        Salesforce search results render as a data-table with <a> links containing
        `data-refid="recordId"` and `title="Name"`.  This method grabs the href
        directly without needing to click through.
        """
        # Normalise the target name for comparison
        target = name.strip().lower()
        
        # Look for links in the search results grid
        links = self.page.locator('table[role="grid"] a[data-refid="recordId"]')
        count = await links.count()
        print(f"[GlobalSearch] Found {count} record links in results table")
        
        for i in range(count):
            link = links.nth(i)
            title = (await link.get_attribute('title') or '').strip().lower()
            if target in title or title in target:
                href = await link.get_attribute('href')
                if href:
                    # href may be relative (e.g. /lightning/r/00Qa.../view)
                    if href.startswith('/'):
                        # Build absolute URL from current page origin
                        from urllib.parse import urlparse
                        parsed = urlparse(self.page.url)
                        href = f"{parsed.scheme}://{parsed.netloc}{href}"
                    print(f"[GlobalSearch] Matched '{title}' → {href}")
                    return href
        
        print(f"[GlobalSearch] No record link matched '{name}'")
        return None
    
    async def click_result_by_text(self, text: str) -> bool:
        """Click a search result containing the given text."""
        # First try the data-table links on the search results page
        target = text.strip().lower()
        links = self.page.locator('table[role="grid"] a[data-refid="recordId"]')
        count = await links.count()
        
        for i in range(count):
            link = links.nth(i)
            title = (await link.get_attribute('title') or '').strip().lower()
            if target in title or title in target:
                try:
                    await link.click()
                    await self.wait_for_lightning_ready()
                    return True
                except Exception:
                    pass
        
        # Fallback: older-style selectors
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
    
    @staticmethod
    def _encode_default_field_values(values: dict[str, str]) -> str:
        pairs: list[str] = []
        for key, raw in values.items():
            if not raw:
                continue
            safe_key = str(key).strip()
            safe_val = str(raw).strip()
            if not safe_key or not safe_val:
                continue
            pairs.append(f"{safe_key}={safe_val}")
        return quote(",".join(pairs), safe="")

    async def open_new_lead_via_url(
        self,
        *,
        base_url: str,
        first_name: str | None = None,
        last_name: str | None = None,
        company: str | None = None,
        title: str | None = None,
        email: str | None = None,
        website: str | None = None,
        phone: str | None = None,
        lead_source: str | None = None,
        description: str | None = None,
        extra_field_values: dict[str, str] | None = None,
    ) -> bool:
        """
        Open Salesforce New Lead page directly via URL and prefill fields.
        """
        values = {
            "FirstName": first_name or "",
            "LastName": last_name or "",
            "Company": company or "",
            "Title": title or "",
            "Email": email or "",
            "Phone": phone or "",
            "Website": website or "",
            "LeadSource": lead_source or "",
            "Description": description or "",
        }
        if extra_field_values:
            for key, val in extra_field_values.items():
                if key and val is not None:
                    values[str(key)] = str(val)
        encoded = self._encode_default_field_values(values)
        target = base_url.strip()
        if encoded:
            delim = "&" if "?" in target else "?"
            target = f"{target}{delim}defaultFieldValues={encoded}"

        print("      [LeadPage] Opening New Lead via direct URL...")
        await self.page.goto(target, timeout=30000)
        await self.page.wait_for_load_state("domcontentloaded", timeout=20000)
        await asyncio.sleep(0.4)
        try:
            await self.page.wait_for_load_state("networkidle", timeout=4000)
        except Exception:
            pass
        return True

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
        phone: str = None,
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

            # Phone
            await fill_field('Phone', phone)
            
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
        if await self._has_duplicate_warning():
            print("      [LeadPage] Duplicate warning detected before save; skipping create")
            return "duplicate://detected"

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

        # Lightning duplicate checks can render immediately after save click.
        if await self._has_duplicate_warning():
            print("      [LeadPage] Duplicate warning detected after save click; skipping create")
            return "duplicate://detected"
        
        # Wait for save to complete
        print("      [LeadPage] Waiting for save to complete...")
        await asyncio.sleep(0.6)
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
            # Give Salesforce a brief chance to mutate URL state before manual close.
            candidate = await self._wait_for_recordish_url(timeout_ms=2500)
            if candidate:
                return candidate
            await self._close_modal_after_save_if_present()
            candidate = await self._wait_for_recordish_url(timeout_ms=4000)
            if candidate:
                return candidate
            return None

    async def _has_duplicate_warning(self) -> bool:
        """
        Detect Salesforce duplicate warning panel shown on Lead create.
        """
        selectors = [
            "force-dedupe-content",
            "div.panel-content.scrollable:has(force-dedupe-content)",
            "div.panel-content.scrollable:has-text('View Duplicates')",
            "div:has-text('This record looks like an existing record')",
        ]
        for sel in selectors:
            try:
                node = self.page.locator(sel).first
                if await node.count() > 0 and await node.is_visible():
                    return True
            except Exception:
                continue
        return False

    async def _wait_for_recordish_url(self, timeout_ms: int = 3000) -> Optional[str]:
        """
        Poll URL briefly for lead-record signals (00Q record routes or /Lead/ records).
        """
        deadline = asyncio.get_event_loop().time() + max(0.1, timeout_ms / 1000.0)
        while asyncio.get_event_loop().time() < deadline:
            try:
                current = (self.page.url or "").strip()
            except Exception:
                current = ""
            if current:
                if "/lightning/r/00Q" in current or "/lightning/r/Lead/" in current:
                    return current
                if "/Lead/00Q" in current:
                    return current
                if "backgroundContext=" in current and "00Q" in current:
                    return current
            await asyncio.sleep(0.15)
        return None

    async def _close_modal_after_save_if_present(self) -> None:
        """
        Some org layouts keep the user in a modal/new context after save until
        the top-right close button is clicked. Close it if present so URL state
        reflects the created lead context.
        """
        close_selectors = [
            "button[title='Cancel and close']",
            "button.slds-modal__close[title='Cancel and close']",
            "button.slds-modal__close",
            "button:has-text('Cancel and close')",
        ]
        for sel in close_selectors:
            try:
                btn = self.page.locator(sel).first
                if await btn.count() > 0 and await btn.is_visible():
                    await btn.click()
                    print(f"      [LeadPage] Clicked modal close button ({sel})")
                    return
            except Exception:
                continue
    
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

    @staticmethod
    def _plain_text_to_html(text: str) -> str:
        safe = (
            (text or "")
            .replace("&", "&amp;")
            .replace("<", "&lt;")
            .replace(">", "&gt;")
        )
        lines = [ln for ln in safe.splitlines()]
        if not lines:
            return ""
        return "<br>".join(lines)

    @staticmethod
    def _trim_leading_html_breaks(html: str) -> str:
        if not html:
            return ""
        out = (html or "").strip()
        pattern = re.compile(
            r"^(?:\s|&nbsp;|<br\s*/?>|<div>(?:\s|&nbsp;|<br\s*/?>)*</div>|<p>(?:\s|&nbsp;|<br\s*/?>)*</p>)+",
            flags=re.IGNORECASE,
        )
        # Strip only explicitly blank leading wrappers/breaks; do not touch content blocks.
        for _ in range(8):
            nxt = pattern.sub("", out, count=1).strip()
            if nxt == out:
                break
            out = nxt
        return out

    @staticmethod
    def _trim_trailing_html_breaks(html: str) -> str:
        if not html:
            return ""
        return re.sub(
            r"(?:(?:\s|&nbsp;|<br\s*/?>)+|<div>(?:\s|&nbsp;|<br\s*/?>)*</div>|<p>(?:\s|&nbsp;|<br\s*/?>)*</p>)+$",
            "",
            html,
            flags=re.IGNORECASE,
        ).strip()

    async def capture_current_body_html(self) -> str:
        """Capture current reply body before inserting template."""
        # Give Salesforce a short window to attach the live reply body frame after maximize.
        for _ in range(8):
            await self.focus_editor_body()
            frame, html = await self._find_editor_frame_and_html()
            _ = frame
            if html:
                return html
            await asyncio.sleep(0.2)
        return ""

    async def focus_editor_body(self) -> bool:
        """Explicitly click into the email body iframe/editor so keyboard actions target it."""
        cke_selector = "iframe.cke_wysiwyg_frame, iframe[title='Email Body'], iframe[title*='Email Body']"
        # Direct top-level CKEditor iframe: click iframe element, then click body inside content frame.
        try:
            iframes = self.page.locator(cke_selector)
            count = await iframes.count()
            for i in range(min(count, 5)):
                iframe = iframes.nth(i)
                try:
                    if not await iframe.is_visible():
                        continue
                except Exception:
                    continue
                try:
                    await iframe.scroll_into_view_if_needed()
                except Exception:
                    pass
                try:
                    await iframe.click(timeout=1500, force=True)
                except Exception:
                    continue
                handle = await iframe.element_handle()
                if not handle:
                    continue
                frame = await handle.content_frame()
                if not frame:
                    continue
                try:
                    await frame.wait_for_selector("body", state="visible", timeout=2000)
                    await frame.click("body", force=True)
                    return True
                except Exception:
                    try:
                        await frame.focus("body")
                        await frame.click("body", force=True)
                        return True
                    except Exception:
                        continue
        except Exception:
            pass

        # Fallback to detected editor frame body
        frame, _ = await self._find_editor_frame_and_html()
        if frame:
            try:
                await frame.click("body")
                return True
            except Exception:
                try:
                    await frame.focus("body")
                    return True
                except Exception:
                    pass

        # Final fallback: visible rich editor on page
        try:
            rich = self.page.locator(".ql-editor, [contenteditable='true'], div[role='textbox']").first
            if await rich.count() > 0 and await rich.is_visible():
                await rich.click()
                return True
        except Exception:
            pass
        return False

    async def clear_current_body(self) -> bool:
        """Clear current body content (simulate select-all + cut) before template insertion."""
        focused = await self.focus_editor_body()
        if not focused:
            return False
        frame, _ = await self._find_editor_frame_and_html()
        if not frame:
            return False
        try:
            # Select-all/cut inside the editor frame only.
            try:
                await self.page.keyboard.press("Control+a")
                await asyncio.sleep(0.05)
                await self.page.keyboard.press("Backspace")
            except Exception:
                pass
            await frame.evaluate(
                """
                () => {
                  const b = document.body;
                  if (!b) return false;
                  b.focus();
                  const sel = window.getSelection();
                  if (sel) {
                    const range = document.createRange();
                    range.selectNodeContents(b);
                    sel.removeAllRanges();
                    sel.addRange(range);
                  }
                  try { document.execCommand('delete'); } catch (_) {}
                  if ((b.innerHTML || '').trim()) b.innerHTML = '';
                  b.dispatchEvent(new Event('input', { bubbles: true }));
                  b.dispatchEvent(new Event('change', { bubbles: true }));
                  return true;
                }
                """
            )
            return True
        except Exception:
            return False

    async def capture_current_subject(self) -> str:
        """Capture current subject text from composer (top-level or iframe)."""
        selectors = [
            "input[placeholder*='Subject']",
            "input[name='subject']",
        ]
        frame = self.page.frame_locator("iframe[title*='Email']")
        for sel in selectors:
            try:
                loc = self.page.locator(sel).first
                if await loc.count() > 0 and await loc.is_visible():
                    value = (await loc.input_value()) or ""
                    if value.strip():
                        return value.strip()
            except Exception:
                pass
            try:
                loc = frame.locator(sel).first
                if await loc.count() > 0:
                    value = (await loc.input_value()) or ""
                    if value.strip():
                        return value.strip()
            except Exception:
                pass
        try:
            loc = self.page.get_by_label("Subject").first
            if await loc.count() > 0 and await loc.is_visible():
                value = (await loc.input_value()) or ""
                return value.strip()
        except Exception:
            pass
        try:
            loc = frame.get_by_label("Subject").first
            if await loc.count() > 0:
                value = (await loc.input_value()) or ""
                return value.strip()
        except Exception:
            pass
        return ""

    async def _find_editor_frame_and_html(self):
        """
        Find the frame that actually contains the reply editor body.
        Returns (frame, body_html). Prefer non-empty frames and CKEditor-like bodies.
        """
        # First, explicitly look for CKEditor iframe instances in all known frame contexts.
        cke_selector = "iframe.cke_wysiwyg_frame, iframe[title='Email Body'], iframe[title*='Email Body']"
        contexts = []
        try:
            contexts.append(self.page.main_frame)
        except Exception:
            pass
        try:
            contexts.extend(self.page.frames)
        except Exception:
            pass
        seen = set()
        best_child_frame = None
        best_child_html = ""
        best_child_score = -1
        for ctx in contexts:
            try:
                cid = id(ctx)
                if cid in seen:
                    continue
                seen.add(cid)
                loc = ctx.locator(cke_selector)
                count = await loc.count()
                for i in range(min(count, 4)):
                    iframe_loc = loc.nth(i)
                    handle = await iframe_loc.element_handle()
                    if not handle:
                        continue
                    child = await handle.content_frame()
                    if not child:
                        continue
                    try:
                        html = await child.evaluate(
                            "() => (document.body && document.body.innerHTML ? document.body.innerHTML : '')"
                        )
                    except Exception:
                        html = ""
                    try:
                        visible = await iframe_loc.is_visible()
                    except Exception:
                        visible = False
                    html = (html or "").strip()
                    score = 0
                    if visible:
                        score += 5
                    if html:
                        score += 20
                    try:
                        is_ck = await child.evaluate(
                            "() => !!document.querySelector('.cke_editable, [contenteditable=\"true\"]')"
                        )
                        if is_ck:
                            score += 5
                    except Exception:
                        pass
                    if score > best_child_score:
                        best_child_score = score
                        best_child_frame = child
                        best_child_html = html
            except Exception:
                continue
        if best_child_frame:
            return best_child_frame, best_child_html

        best_frame = None
        best_html = ""
        best_score = -1
        for frame in self.page.frames:
            try:
                info = await frame.evaluate(
                    """
                    () => {
                      const b = document.body;
                      if (!b) return { hasEditor: false, html: '', score: 0 };
                      const html = (b.innerHTML || '').trim();
                      const cls = (b.className || '').toLowerCase();
                      const hasCke = cls.includes('cke') || !!document.querySelector('iframe.cke_wysiwyg_frame');
                      const hasRich = !!document.querySelector('.ql-editor,[contenteditable=\"true\"],div[role=\"textbox\"]');
                      const hasEditor = hasCke || hasRich || b.isContentEditable || cls.includes('cke_editable');
                      let score = 0;
                      if (hasEditor) score += 10;
                      if (hasCke) score += 5;
                      if (html.length > 0) score += 3;
                      return { hasEditor, html, score };
                    }
                    """
                )
            except Exception:
                continue
            if not info or not info.get("hasEditor"):
                continue
            score = int(info.get("score") or 0)
            html = str(info.get("html") or "")
            if score > best_score:
                best_score = score
                best_frame = frame
                best_html = html
        return best_frame, (best_html or "").strip()

    @staticmethod
    def _looks_like_reply_thread(text: str) -> bool:
        lowered = (text or "").lower()
        markers = (
            "original message",
            "from:",
            "sent:",
            "subject:",
            "to:",
            "-----original message-----",
        )
        return any(marker in lowered for marker in markers)

    async def _composer_visible(self) -> bool:
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
        ).or_(
            self.page.locator('input[placeholder*="Subject"]')
        )
        try:
            await composer.first.wait_for(state='visible', timeout=2000)
            return True
        except Exception:
            return False

    async def wait_for_composer_ready(self, timeout_ms: int = 12000) -> bool:
        """Wait until composer UI is visible and interactive."""
        deadline = asyncio.get_event_loop().time() + max(0.5, timeout_ms / 1000.0)
        while asyncio.get_event_loop().time() < deadline:
            if await self._composer_visible():
                return True
            await asyncio.sleep(0.25)
        return False
    
    async def open_email_composer(self) -> bool:
        """
        Open the email composer from a record page.
        Clicks the Email action button.
        """
        print("      [EmailComposer] Looking for Email button...")

        if await self._composer_visible():
            print("      [EmailComposer] Composer already visible")
            return True

        direct_selectors = [
            self.page.get_by_role('button', name='Email').first,
            self.page.locator('button[title="Email"]').first,
            self.page.locator('a[title="Email"]').first,
            self.page.locator('button[value="SendEmail"]').first,
            self.page.locator('button[name="SendEmail"]').first,
            self.page.locator('[data-target-selection-name*="SendEmail"]').first,
            self.page.locator('lightning-button:has-text("Email")').first,
            self.page.locator('a:has-text("Email")').first,
        ]

        try:
            for idx, btn in enumerate(direct_selectors):
                try:
                    await btn.wait_for(state='visible', timeout=2500 if idx else 5000)
                    await btn.scroll_into_view_if_needed()
                    await btn.click()
                    await asyncio.sleep(1.2)
                    if await self._composer_visible():
                        print("      [EmailComposer] Composer opened via direct Email action")
                        return True
                except Exception:
                    continue

            print("      [EmailComposer] Direct Email action not visible; trying overflow menu...")
            overflow_btn = self.page.locator(
                'a.rowActionsPlaceHolder, button[title*="Show more actions"], button:has-text("Show more actions"), a[aria-haspopup="true"]'
            ).first
            try:
                await overflow_btn.wait_for(state='visible', timeout=4000)
                await overflow_btn.click()
                await asyncio.sleep(0.5)
            except Exception:
                pass

            overflow_email = self.page.get_by_role('menuitem', name='Email').first.or_(
                self.page.get_by_role('button', name='Email').first
            ).or_(
                self.page.locator('a:has-text("Email")').first
            ).or_(
                self.page.locator('button:has-text("Email")').first
            )
            try:
                await overflow_email.wait_for(state='visible', timeout=4000)
                await overflow_email.click()
                await asyncio.sleep(1.2)
                if await self._composer_visible():
                    print("      [EmailComposer] Composer opened via overflow action")
                    return True
            except Exception:
                pass

            print("      [EmailComposer] Trying timeline item action...")
            timeline_email = self.page.locator(
                '.slds-timeline__item a:has-text("Email"), .slds-timeline__item button:has-text("Email")'
            ).first
            try:
                await timeline_email.wait_for(state='visible', timeout=3000)
                await timeline_email.click()
                await asyncio.sleep(1.2)
                if await self._composer_visible():
                    print("      [EmailComposer] Composer opened via timeline action")
                    return True
            except Exception:
                pass

            print("      [EmailComposer] Could not find usable Email action on page")
            return False
        except Exception as e:
            print(f"      [EmailComposer] Error opening composer: {e}")
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
            frame = self.page.frame_locator('iframe[title*="Email"]')
            
            # Subject
            if subject:
                subject_field = self.page.get_by_label('Subject', exact=False).or_(
                    self.page.locator('input[placeholder*="Subject"]')
                ).or_(
                    self.page.locator('input[name="subject"]')
                ).or_(
                    frame.get_by_label('Subject', exact=False)
                ).or_(
                    frame.locator('input[placeholder*="Subject"]')
                ).or_(
                    frame.locator('input[name="subject"]')
                ).first
                await subject_field.fill(subject)
            
            # Body (could be rich text editor)
            if body:
                # Try plain textarea first
                body_field = self.page.locator('textarea.slds-textarea').or_(
                    self.page.get_by_label('Body', exact=False)
                ).or_(
                    self.page.locator('.ql-editor')  # Quill editor
                ).or_(
                    self.page.locator('[contenteditable="true"]')
                ).or_(
                    frame.locator('textarea.slds-textarea')
                ).or_(
                    frame.get_by_label('Body', exact=False)
                ).or_(
                    frame.locator('.ql-editor')
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
                to_field = self.page.get_by_label('To', exact=False).or_(
                    self.page.locator('input[placeholder*="To"]')
                ).or_(
                    frame.get_by_label('To', exact=False)
                ).or_(
                    frame.locator('input[placeholder*="To"]')
                ).first
                
                current_value = await to_field.input_value() if await to_field.count() > 0 else ''
                if not current_value:
                    await to_field.fill(to)
            
            return True
            
        except Exception as e:
            print(f"Error filling email: {e}")
            return False

    async def select_template(self, template_name: str) -> bool:
        """Select an email template in the composer."""
        async def _confirm_overwrite_modal() -> bool:
            try:
                modal = self.page.locator(
                    "div.modal-container.slds-modal__container:has-text('Inserting this template will overwrite the current email')"
                ).first
                try:
                    await modal.wait_for(state="visible", timeout=3500)
                except Exception:
                    return False

                insert_btn = modal.locator(
                    "div.modalContainer.emailuiWarningModal div.buttonContainer button.slds-button_brand"
                ).or_(
                    modal.locator("button.slds-button_brand:has-text('Insert')")
                ).or_(
                    modal.get_by_role("button", name="Insert")
                ).first
                await insert_btn.wait_for(state="visible", timeout=2500)
                clicked = False
                try:
                    await insert_btn.click(timeout=1500)
                    clicked = True
                except Exception:
                    pass
                if not clicked:
                    try:
                        await insert_btn.click(timeout=1500, force=True)
                        clicked = True
                    except Exception:
                        pass
                if not clicked:
                    try:
                        await insert_btn.evaluate("el => el.click()")
                        clicked = True
                    except Exception:
                        pass
                if not clicked:
                    try:
                        await self.page.keyboard.press("Enter")
                        clicked = True
                    except Exception:
                        pass

                if clicked:
                    await asyncio.sleep(0.35)
                    print("[EmailComposer] Overwrite warning confirmed (Insert clicked)")
                    return True
                print("[EmailComposer] Overwrite warning detected but Insert click failed")
                return False
            except Exception:
                return False

        async def _editor_has_content(timeout_ms: int = 4000) -> bool:
            deadline = asyncio.get_event_loop().time() + max(0.5, timeout_ms / 1000.0)
            while asyncio.get_event_loop().time() < deadline:
                try:
                    _frame, html = await self._find_editor_frame_and_html()
                    if (html or "").strip():
                        return True
                except Exception:
                    pass
                await asyncio.sleep(0.2)
            return False

        async def _click_template_option() -> None:
            template_option = self.page.locator(
                f'a.highlightButton[title="{template_name}"]'
            ).or_(
                self.page.locator(f'a[role="menuitem"][title="{template_name}"]')
            ).or_(
                self.page.locator(f'a[role="menuitem"]:has-text("{template_name}")')
            ).first
            await template_option.wait_for(state='visible', timeout=5000)
            await template_option.click()

        try:
            # Brief settle delay after maximize/body prep to avoid racing Lightning toolbar hydration.
            await asyncio.sleep(0.35)
            template_btn = self.page.locator(
                'lightning-icon[icon-name="utility:insert_template"]'
            ).or_(
                self.page.locator('a.iconTrigger:has(lightning-icon[icon-name="utility:insert_template"])')
            ).or_(
                self.page.locator('.cuf-attachmentsItem a[role="button"]')
            ).first

            await template_btn.wait_for(state='visible', timeout=10000)
            await template_btn.click()
            await asyncio.sleep(1)
            await _click_template_option()
            # If Salesforce warns that template insertion overwrites current email,
            # we intentionally confirm because original content was already captured.
            await _confirm_overwrite_modal()
            # Ensure the template actually rendered into the editor; retry once if not.
            if not await _editor_has_content(timeout_ms=3500):
                try:
                    await template_btn.click()
                    await asyncio.sleep(0.7)
                    await _click_template_option()
                except Exception:
                    pass
                await _confirm_overwrite_modal()
            await _editor_has_content(timeout_ms=4000)
            print(f"[EmailComposer] Template '{template_name}' selected")
            return True
        except Exception as e:
            print(f"[EmailComposer] Template selection failed: {e}")
            return False

    async def fill_email_with_keyboard(
        self,
        subject: str,
        body: str,
        preserved_original_html: str = "",
    ) -> bool:
        """Fill subject/body via keyboard navigation for inline composer."""
        try:
            subject_field = self.page.locator('input[placeholder*="Subject"]').or_(
                self.page.get_by_label('Subject')
            ).or_(
                self.page.locator('input[name="subject"]')
            ).first

            subject_needed = bool((subject or "").strip())
            if subject_needed:
                if await subject_field.count() == 0 or not await subject_field.is_visible():
                    print("[EmailComposer] Subject field not found")
                    return False
                await subject_field.click()
                await asyncio.sleep(0.3)
                await subject_field.fill(subject)
                print(f"[EmailComposer] Subject filled: {subject[:50]}...")

            # Salesforce reply composer often uses CKEditor iframe for body.
            # Preserve original thread by appending it after the generated body.
            if body:
                try:
                    frame, existing_html = await self._find_editor_frame_and_html()
                    if frame:
                        raw_footer_html = (existing_html or "").strip()
                        raw_original_html = (preserved_original_html or "").strip()
                        raw_template_html = self._trim_trailing_html_breaks(
                            self._plain_text_to_html(body.strip())
                        )

                        normalized = await frame.evaluate(
                            """
                            ({ templateHtml, footerHtml, originalHtml }) => {
                              const isBlankNode = (node) => {
                                if (!node) return true;
                                if (node.nodeType === Node.TEXT_NODE) {
                                  return (node.textContent || '').replace(/\\u00a0/g, '').trim() === '';
                                }
                                if (node.nodeType !== Node.ELEMENT_NODE) return true;
                                const el = node;
                                if (el.tagName === 'BR') return true;
                                const text = (el.textContent || '').replace(/\\u00a0/g, '').trim();
                                if (text.length > 0) return false;
                                if (el.querySelector('img,table,hr,iframe,video,svg,canvas,a')) return false;
                                return true;
                              };
                              const normalizeFrag = (html, trimStart, trimEnd) => {
                                const c = document.createElement('div');
                                c.innerHTML = html || '';
                                if (trimStart) {
                                  while (c.firstChild && isBlankNode(c.firstChild)) c.firstChild.remove();
                                }
                                if (trimEnd) {
                                  while (c.lastChild && isBlankNode(c.lastChild)) c.lastChild.remove();
                                }
                                return c.innerHTML.trim();
                              };
                              return {
                                template: normalizeFrag(templateHtml, true, true),
                                footer: normalizeFrag(footerHtml, true, false),
                                original: normalizeFrag(originalHtml, true, false),
                              };
                            }
                            """,
                            {
                                "templateHtml": raw_template_html,
                                "footerHtml": raw_footer_html,
                                "originalHtml": raw_original_html,
                            },
                        )
                        template_html = (normalized or {}).get("template", "") or ""
                        footer_html = (normalized or {}).get("footer", "") or ""
                        original_html = (normalized or {}).get("original", "") or ""

                        parts = [p for p in [template_html, footer_html] if (p or "").strip()]
                        if original_html and original_html not in (footer_html or ""):
                            parts.append(original_html)
                        merged_html = "<br>".join(parts)
                        await frame.evaluate(
                            """
                            (html) => {
                              const b = document.body;
                              if (!b) return false;
                              b.focus();
                              b.innerHTML = html;
                              b.dispatchEvent(new Event('input', { bubbles: true }));
                              b.dispatchEvent(new Event('change', { bubbles: true }));
                              return true;
                            }
                            """,
                            merged_html,
                        )
                        print(
                            f"[EmailComposer] CKEditor body updated "
                            f"(template={len(body)} chars, footer_html={len(footer_html)} chars, "
                            f"original_html={len(original_html)} chars)"
                        )
                        return True
                except Exception:
                    pass

            if body:
                reply_editor = self.page.locator(".ql-editor, [contenteditable='true'], div[role='textbox']").first
                try:
                    if await reply_editor.count() > 0 and await reply_editor.is_visible():
                        existing_text = (await reply_editor.inner_text(timeout=1000) or "").strip()
                        if self._looks_like_reply_thread(existing_text):
                            merged = f"{body.strip()}\n\n{existing_text}".strip()
                            await reply_editor.click()
                            await reply_editor.evaluate(
                                "(el, text) => { el.textContent = text; }",
                                merged,
                            )
                            print(
                                f"[EmailComposer] Body merged with original thread at bottom "
                                f"({len(body)} + {len(existing_text)} chars)"
                            )
                            return True
                except Exception:
                    pass

                await self.page.keyboard.press('Tab')
                await asyncio.sleep(0.5)
                await self.page.keyboard.type(body)
                print(f"[EmailComposer] Body filled ({len(body)} chars)")

            return True
        except Exception as e:
            print(f"[EmailComposer] Keyboard fill error: {e}")
            return False

    async def clear_bcc(self):
        """Clear the BCC field by keyboard navigation and backspace."""
        try:
            await self.page.keyboard.press('Shift+Tab')
            await asyncio.sleep(0.2)
            await self.page.keyboard.press('Shift+Tab')
            await asyncio.sleep(0.2)
            for _ in range(50):
                await self.page.keyboard.press('Backspace')
            await asyncio.sleep(0.2)
            print("[EmailComposer] BCC cleared")
        except Exception as e:
            print(f"[EmailComposer] Could not clear BCC: {e}")

    async def maximize(self):
        """Click maximize in email composer when available."""
        try:
            max_btn = self.page.locator('button[title="Maximize"]').or_(
                self.page.locator('button.maxButton')
            ).first
            if await max_btn.count() > 0:
                await max_btn.click()
                await asyncio.sleep(0.5)
                print("[EmailComposer] Composer maximized")
        except Exception as e:
            print(f"[EmailComposer] Could not maximize: {e}")
    
    async def send_email(self, skip_click: bool = False) -> bool:
        """
        Click Send button and verify success.
        
        Args:
            skip_click: If True, DON'T click send - just verify email is ready.
                       Used for review mode where user manually clicks send.
        
        Returns True if email sent successfully (or ready to send if skip_click).
        """
        frame = self.page.frame_locator('iframe[title*="Email"]')
        send_btn = self.page.get_by_role('button', name='Send').or_(
            self.page.locator('button[title="Send"]')
        ).or_(
            self.page.locator('button.cuf-publisherShareButton.send')
        ).or_(
            self.page.locator('.slds-button:has-text("Send")')
        ).or_(
            frame.get_by_role('button', name='Send')
        ).or_(
            frame.locator('button[title="Send"]')
        ).or_(
            frame.locator('button.cuf-publisherShareButton.send')
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
