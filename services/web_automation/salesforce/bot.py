"""
SalesforceBot: UI automation for sending tracked emails from Salesforce.
Uses persistent browser session to minimize re-authentication.
"""
import asyncio
import base64
import json
import re
from datetime import datetime
from pathlib import Path
from typing import Optional, Dict, List
from urllib.parse import parse_qs, quote, unquote, urlparse
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
        if self._looks_like_lead_url(url):
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

    async def find_first_lead_url_by_query(
        self,
        query: str,
        *,
        preferred_name: Optional[str] = None,
        strict_preferred: bool = False,
    ) -> Optional[str]:
        """
        Search Salesforce and return a Lead record URL from the results grid.
        If preferred_name is provided, prefer matching titles before fallback.
        """
        term = (query or "").strip()
        if not term:
            return None
        if not self.is_authenticated:
            await self._check_auth()
        if not self.is_authenticated:
            return None

        search = GlobalSearch(self.page)
        if not await search.search(term):
            return None
        await asyncio.sleep(1.5)
        return await self._pick_lead_url_from_results(
            preferred_name=preferred_name,
            allow_first_fallback=not (strict_preferred and (preferred_name or "").strip()),
        )
    
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
    
    @staticmethod
    def _parse_default_field_values(raw: str) -> dict[str, str]:
        out: dict[str, str] = {}
        text = (raw or "").strip()
        if not text:
            return out
        for chunk in text.split(";"):
            part = chunk.strip()
            if not part or "=" not in part:
                continue
            key, val = part.split("=", 1)
            k = key.strip()
            v = val.strip()
            if k and v:
                out[k] = v
        return out

    async def create_or_update_lead(
        self,
        first_name: str = None,
        last_name: str = None,
        company: str = None,
        title: str = None,
        email: str = None,
        phone: str = None,
        website: str = None,
        description: str = None,
        lead_source: str = "Web Research"
    ) -> Optional[str]:
        """
        Create a new Lead or update existing.
        Returns the Lead record URL or None on failure.
        """
        lead_page = LeadPage(self.page)
        direct_url_mode = bool(config.SALESFORCE_NEW_LEAD_URL)

        if not direct_url_mode:
            # Search for existing record first (legacy flow).
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
        else:
            print("    [SFBot] Direct URL mode enabled; skipping global search duplicate check")
        
        # Create new Lead
        print(f"    [SFBot] No existing record, creating new Lead...")
        try:
            if direct_url_mode:
                extra_defaults = self._parse_default_field_values(config.SALESFORCE_DEFAULT_FIELD_VALUES)
                await lead_page.open_new_lead_via_url(
                    base_url=config.SALESFORCE_NEW_LEAD_URL,
                    first_name=first_name,
                    last_name=last_name,
                    company=company,
                    title=title,
                    email=email,
                    phone=phone,
                    website=website,
                    lead_source=lead_source,
                    description=description,
                    extra_field_values=extra_defaults,
                )
            else:
                await lead_page.create_new_lead()
        except Exception as e:
            print(f"    [SFBot] Error opening new Lead form: {e}")
            return None
        
        await asyncio.sleep(0.4 if direct_url_mode else 2.0)  # Direct URL mode needs less settle time
        
        # Prepare name
        if not last_name:
            if first_name:
                last_name = first_name
                first_name = None
            else:
                last_name = "Unknown"
        
        # Fill form only when not using direct URL prefill mode.
        if not direct_url_mode:
            print(f"    [SFBot] Filling Lead form: {first_name} {last_name}, {company}")
            success = await lead_page.fill_lead_form(
                first_name=first_name,
                last_name=last_name,
                company=company or "Unknown Company",
                title=title,
                email=email,
                phone=phone,
                website=website,
                lead_source=lead_source,
                description=description
            )
            if not success:
                print(f"    [SFBot] Failed to fill Lead form")
                return None
        else:
            print("    [SFBot] Direct URL prefill mode enabled; skipping DOM field typing")
        
        # Save
        print(f"    [SFBot] Saving Lead...")
        record_url = await lead_page.save_lead()
        if record_url == "duplicate://detected":
            print("    [SFBot] Duplicate lead warning detected; skipping create")
            return "duplicate://detected"
        if not self._looks_like_lead_url(record_url):
            # Salesforce can sometimes create successfully but keep us on a list/overlay.
            # Recover record URL via URL-driven search context in direct URL mode.
            if direct_url_mode:
                full_name = " ".join(
                    [part for part in [(first_name or "").strip(), (last_name or "").strip()] if part]
                ).strip()
                recovered = await self.resolve_lead_url_from_search_context(
                    candidate_url=record_url,
                    preferred_name=full_name or None,
                    fallback_queries=[(email or "").strip(), full_name, (company or "").strip()],
                )
            else:
                # Legacy fallback may interact with global search.
                recovered = await self._recover_created_lead_url(email=email, company=company, candidate_url=record_url)
            if recovered:
                record_url = recovered

        normalized = self._normalize_lead_record_url(record_url)
        if self._looks_like_lead_url(normalized):
            print(f"    [SFBot] Lead saved: {normalized}")
            return normalized

        print(f"    [SFBot] Failed to resolve Lead URL after save")
        return None

    @staticmethod
    def _extract_lead_id(value: str) -> Optional[str]:
        text = (value or "").strip()
        if not text:
            return None
        # Salesforce Lead IDs start with 00Q and are 15 or 18 chars total.
        match = re.search(r"(00Q[a-zA-Z0-9]{12}(?:[a-zA-Z0-9]{3})?)", text)
        return match.group(1) if match else None

    @staticmethod
    def _looks_like_lead_url(url: Optional[str]) -> bool:
        value = (url or "").strip()
        if not value:
            return False
        # Exclude object/list/pipeline pages that are not actual lead records.
        if "/lightning/o/Lead/" in value:
            return False
        if "/lightning/r/Lead/" in value:
            return True
        # Lightning result tables commonly link as /lightning/r/00Q.../view
        if re.search(r"/lightning/r/00Q[a-zA-Z0-9]{12,18}/view", value):
            return True
        # Classic patterns can still include explicit Lead + ID.
        if re.search(r"/Lead/00Q[a-zA-Z0-9]{12,18}", value):
            return True
        # Fallback: only treat as record URL if a 00Q id appears on a record-ish path.
        lead_id = SalesforceBot._extract_lead_id(value)
        if lead_id and ("/lightning/r/" in value or "/Lead/" in value):
            return True
        return False

    @staticmethod
    def _normalize_lead_record_url(url: Optional[str]) -> Optional[str]:
        value = (url or "").strip()
        if not value:
            return None
        if SalesforceBot._looks_like_lead_url(value):
            return value
        # Normalize direct-id Lightning URLs: /lightning/r/00Q.../view
        if re.search(r"/lightning/r/00Q[a-zA-Z0-9]{12,18}/view", value):
            return value
        try:
            parsed = urlparse(value)
            if "/lightning/o/Lead/new" not in parsed.path:
                return value
            background = (parse_qs(parsed.query).get("backgroundContext") or [None])[0]
            if not background:
                return value
            decoded = unquote(str(background))
            decoded_url = f"{parsed.scheme}://{parsed.netloc}{decoded}" if decoded.startswith("/") else decoded
            if SalesforceBot._looks_like_lead_url(decoded_url):
                return decoded_url
            return value
        except Exception:
            return value

    def resolve_lead_record_url(self, candidate_url: Optional[str] = None) -> Optional[str]:
        """
        Resolve the best Lead record URL from a candidate and current page state.
        """
        normalized = self._normalize_lead_record_url(candidate_url)
        if self._looks_like_lead_url(normalized):
            return normalized
        try:
            current = (self.page.url or "").strip() if self.page is not None else ""
        except Exception:
            current = ""
        normalized_current = self._normalize_lead_record_url(current)
        if self._looks_like_lead_url(normalized_current):
            return normalized_current
        return None

    async def _recover_created_lead_url(
        self,
        *,
        email: Optional[str],
        company: Optional[str],
        candidate_url: Optional[str] = None,
    ) -> Optional[str]:
        # 1) Check candidate returned by save call.
        if self._looks_like_lead_url(candidate_url):
            return candidate_url

        # 2) Check current URL after save transitions.
        try:
            current_url = (self.page.url or "").strip()
            if self._looks_like_lead_url(current_url):
                return current_url
        except Exception:
            pass

        # 3) Re-search and click matching record as a fallback resolver.
        try:
            query = (email or "").strip() or (company or "").strip()
            if not query:
                return None
            direct_result = await self.find_first_lead_url_by_query(query)
            if self._looks_like_lead_url(direct_result):
                print(f"    [SFBot] Recovered Lead URL via query results: {direct_result}")
                return direct_result
            search = GlobalSearch(self.page)
            if await search.search(query):
                await asyncio.sleep(1.5)
                if await search.click_result_by_text(query):
                    await asyncio.sleep(1.5)
                    resolved = (self.page.url or "").strip()
                    if self._looks_like_lead_url(resolved):
                        print(f"    [SFBot] Recovered Lead URL after save via search: {resolved}")
                        return resolved
        except Exception as e:
            print(f"    [SFBot] Lead URL recovery fallback failed: {e}")

        return None

    @staticmethod
    def _extract_one_app_search_terms(url: Optional[str]) -> list[str]:
        """
        Decode Salesforce one.app hash state and extract candidate search terms.
        """
        value = (url or "").strip()
        if not value:
            return []
        try:
            parsed = urlparse(value)
            if "/one/one.app" not in parsed.path:
                return []
            fragment = (parsed.fragment or "").strip()
            if not fragment:
                return []
            payload = unquote(fragment)
            padded = payload + ("=" * (-len(payload) % 4))
            decoded = base64.b64decode(padded).decode("utf-8", errors="ignore")
            data = json.loads(decoded)
            attrs = data.get("attributes") if isinstance(data, dict) else None
            if not isinstance(attrs, dict):
                return []
            scope_map = attrs.get("scopeMap") or {}
            scope_name = str((scope_map.get("name") if isinstance(scope_map, dict) else "") or "").strip().lower()
            term = str(attrs.get("term") or "").strip()
            if not term:
                return []
            # Only trust lead-scoped search state for URL recovery.
            if scope_name and scope_name != "lead":
                return []
            return [term]
        except Exception:
            return []

    @staticmethod
    def _decode_one_app_state(url: Optional[str]) -> tuple[Optional[str], Optional[dict]]:
        """
        Decode one.app hash state into (base_url, payload_json).
        """
        value = (url or "").strip()
        if not value:
            return None, None
        try:
            parsed = urlparse(value)
            if "/one/one.app" not in parsed.path:
                return None, None
            base_url = f"{parsed.scheme}://{parsed.netloc}{parsed.path}"
            fragment = (parsed.fragment or "").strip()
            if not fragment:
                return base_url, None
            payload = unquote(fragment)
            padded = payload + ("=" * (-len(payload) % 4))
            decoded = base64.b64decode(padded).decode("utf-8", errors="ignore")
            data = json.loads(decoded)
            if not isinstance(data, dict):
                return base_url, None
            return base_url, data
        except Exception:
            return None, None

    @staticmethod
    def reconstruct_one_app_search_url(candidate_url: Optional[str], term: str) -> Optional[str]:
        """
        Rebuild a valid Salesforce one.app search URL using existing payload shape
        and a new search term.
        """
        search_term = (term or "").strip()
        if not search_term:
            return None
        base_url, payload = SalesforceBot._decode_one_app_state(candidate_url)
        if not base_url or not isinstance(payload, dict):
            return None
        attrs = payload.get("attributes")
        if not isinstance(attrs, dict):
            attrs = {}
            payload["attributes"] = attrs
        attrs["term"] = search_term
        if not attrs.get("scopeMap"):
            attrs["scopeMap"] = {"name": "Lead", "label": "Lead", "id": "Lead"}
        encoded = base64.b64encode(
            json.dumps(payload, separators=(",", ":"), ensure_ascii=True).encode("utf-8")
        ).decode("ascii")
        return f"{base_url}#{quote(encoded, safe='')}"

    def build_one_app_lead_search_url(self, term: str) -> Optional[str]:
        """
        Build a direct Salesforce one.app lead-search URL from a term, without
        relying on captured hash payloads.
        """
        query = (term or "").strip()
        if not query:
            return None
        origin = ""
        try:
            current = (self.page.url or "").strip() if self.page is not None else ""
            parsed_current = urlparse(current)
            if parsed_current.scheme and parsed_current.netloc:
                origin = f"{parsed_current.scheme}://{parsed_current.netloc}"
        except Exception:
            origin = ""
        if not origin:
            try:
                parsed_base = urlparse((self.base_url or "").strip())
                if parsed_base.scheme and parsed_base.netloc:
                    origin = f"{parsed_base.scheme}://{parsed_base.netloc}"
            except Exception:
                origin = ""
        if not origin:
            return None
        payload = {
            "componentDef": "forceSearch:searchPageDesktop",
            "attributes": {
                "term": query,
                "scopeMap": {
                    "name": "Lead",
                    "id": "Lead",
                    "label": "Lead",
                    "keyPrefix": "00Q",
                },
                "context": {
                    "FILTERS": {},
                    "searchSource": "ASSISTANT_DIALOG",
                    "disableIntentQuery": True,
                    "disableSpellCorrection": False,
                },
                "groupId": "DEFAULT",
            },
            "state": {},
        }
        encoded = base64.b64encode(
            json.dumps(payload, separators=(",", ":"), ensure_ascii=True).encode("utf-8")
        ).decode("ascii")
        return f"{origin}/one/one.app#{quote(encoded, safe='')}"

    async def _pick_lead_url_from_results(
        self,
        *,
        preferred_name: Optional[str] = None,
        allow_first_fallback: bool = True,
    ) -> Optional[str]:
        links = self.page.locator('table[role="grid"] a[data-refid="recordId"]')
        count = await links.count()
        if count <= 0:
            return None

        preferred = " ".join((preferred_name or "").strip().lower().split())
        preferred_parts = [p for p in preferred.split(" ") if p]
        first_pref = preferred_parts[0] if preferred_parts else ""
        last_pref = preferred_parts[-1] if len(preferred_parts) > 1 else ""
        best_match_url: Optional[str] = None
        first_lead_url: Optional[str] = None

        for i in range(min(count, 25)):
            link = links.nth(i)
            href = ((await link.get_attribute("href")) or "").strip()
            title = ((await link.get_attribute("title")) or "").strip()
            if not href:
                continue
            if href.startswith("/"):
                parsed = urlparse(self.page.url)
                href = f"{parsed.scheme}://{parsed.netloc}{href}"
            normalized = self._normalize_lead_record_url(href)
            if not self._looks_like_lead_url(normalized):
                continue
            if not first_lead_url:
                first_lead_url = normalized
            if preferred:
                t = " ".join(title.lower().split())
                has_full = preferred in t
                has_last = bool(last_pref and last_pref in t)
                has_first = bool(first_pref and first_pref in t)
                if has_full or (has_first and has_last):
                    best_match_url = normalized
                    break
        if best_match_url:
            return best_match_url
        if preferred and not allow_first_fallback:
            return None
        return first_lead_url

    async def resolve_lead_url_from_search_context(
        self,
        *,
        candidate_url: Optional[str],
        preferred_name: Optional[str] = None,
        fallback_queries: Optional[list[str]] = None,
    ) -> Optional[str]:
        """
        Resolve a Lead URL from Salesforce encoded one.app search context, then
        optional fallback queries.
        """
        queries: list[str] = []
        seen: set[str] = set()
        for q in self._extract_one_app_search_terms(candidate_url):
            token = q.strip()
            key = token.lower()
            if token and key not in seen:
                seen.add(key)
                queries.append(token)
        for q in fallback_queries or []:
            token = (q or "").strip()
            key = token.lower()
            if token and key not in seen:
                seen.add(key)
                queries.append(token)

        for q in queries:
            try:
                direct_search_url = self.build_one_app_lead_search_url(q)
                if direct_search_url:
                    await self.page.goto(direct_search_url, timeout=20_000)
                    try:
                        await self.page.wait_for_load_state("networkidle", timeout=8_000)
                    except Exception:
                        pass
                    await asyncio.sleep(0.8)
                    # Identity-sensitive resolution: when we have a preferred
                    # name, do not fall back to the first arbitrary search row.
                    from_reconstructed = await self._pick_lead_url_from_results(
                        preferred_name=preferred_name,
                        allow_first_fallback=not bool((preferred_name or "").strip()),
                    )
                    if self._looks_like_lead_url(from_reconstructed):
                        print(f"    [SFBot] Resolved Lead URL from direct one.app search URL for '{q}'")
                        return from_reconstructed
            except Exception as exc:
                print(f"    [SFBot] Search-context URL recovery failed for '{q}': {exc}")
                continue
        return None
    
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


