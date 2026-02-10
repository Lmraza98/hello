"""
LinkedIn Sales Navigator Scraper: Extract employee names and titles from target companies.
Uses Playwright to navigate Sales Nav UI.
"""
import asyncio
import json
import re
from typing import List, Dict, Optional
from pathlib import Path
from urllib.parse import quote
from playwright.async_api import async_playwright, Browser, BrowserContext, Page

import config


# Storage for LinkedIn session
LINKEDIN_STORAGE_STATE = config.DATA_DIR / "linkedin_auth.json"


class SalesNavigatorScraper:
    """
    Scrape employee data from LinkedIn Sales Navigator.
    """
    
    def __init__(self):
        self.playwright = None
        self.browser: Optional[Browser] = None
        self.context: Optional[BrowserContext] = None
        self.page: Optional[Page] = None
        self.is_authenticated = False
    
    async def start(self, headless: bool = False):
        """Start browser with persistent LinkedIn session and stealth settings."""
        self.playwright = await async_playwright().start()
        
        self.browser = await self.playwright.chromium.launch(
            headless=headless,
            slow_mo=100,
            args=[
                '--disable-blink-features=AutomationControlled',
                '--disable-dev-shm-usage',
                '--no-sandbox',
            ]
        )
        
        # Context options with realistic fingerprint
        context_options = {
            'viewport': {'width': 1920, 'height': 1080},
            'user_agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
            'locale': 'en-US',
            'timezone_id': 'America/New_York',
        }
        
        # Load existing session if available
        if LINKEDIN_STORAGE_STATE.exists():
            print("[LinkedIn] Loading existing session")
            context_options['storage_state'] = str(LINKEDIN_STORAGE_STATE)
        else:
            print("[LinkedIn] Creating new session")
        
        self.context = await self.browser.new_context(**context_options)
        
        # Hide webdriver flag and add stealth scripts
        await self.context.add_init_script("""
            Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
            Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
            Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
            
            // Suppress chrome-extension probe errors
            const originalFetch = window.fetch;
            window.fetch = function(...args) {
                if (args[0] && args[0].toString().includes('chrome-extension://')) {
                    return Promise.reject(new Error('blocked'));
                }
                return originalFetch.apply(this, args);
            };
        """)
        
        self.page = await self.context.new_page()
        await self._check_auth()
    
    async def stop(self):
        """Stop browser and save session."""
        try:
            if self.context and self.is_authenticated:
                try:
                    await self.context.storage_state(path=str(LINKEDIN_STORAGE_STATE))
                except Exception:
                    pass  # Session save failed, continue cleanup
            if self.context:
                try:
                    await self.context.close()
                except Exception:
                    pass  # Already closed
            if self.browser:
                try:
                    await self.browser.close()
                except Exception:
                    pass  # Already closed
            if self.playwright:
                try:
                    await self.playwright.stop()
                except Exception:
                    pass  # Already stopped
        except Exception:
            pass  # Cleanup errors are not critical
    
    async def _check_auth(self) -> bool:
        """Check if we're logged into LinkedIn Sales Navigator."""
        try:
            # Go directly to Sales Navigator (skip regular LinkedIn)
            print("[LinkedIn] Checking session...")
            await self.page.goto("https://www.linkedin.com/sales/home", timeout=30000)
            await self.page.wait_for_load_state('domcontentloaded', timeout=15000)
            await asyncio.sleep(2)
            
            url = self.page.url
            
            # If redirected to login, we're not authenticated
            if 'login' in url or 'checkpoint' in url or 'authwall' in url:
                self.is_authenticated = False
                print("[LinkedIn] Session expired - login required")
                return False
            
            # If we're on Sales Nav, we're authenticated
            if '/sales/' in url:
                self.is_authenticated = True
                print("[LinkedIn] Session valid - already authenticated")
                return True
            
            self.is_authenticated = False
            return False
            
        except Exception as e:
            print(f"[LinkedIn] Auth check error: {e}")
            self.is_authenticated = False
            return False
    
    async def wait_for_login(self, timeout_minutes: int = None) -> bool:
        if timeout_minutes is None:
            timeout_minutes = config.LINKEDIN_TIMEOUT_MINUTES
        """Wait for user to manually log in."""
        print(f"\n{'='*60}")
        print(f"  LINKEDIN LOGIN REQUIRED")
        print(f"  ")
        print(f"  1. Log in to LinkedIn in the browser window")
        print(f"  2. Then navigate to Sales Navigator")
        print(f"  3. URL: https://www.linkedin.com/sales/home")
        print(f"  ")
        print(f"  You have {timeout_minutes} minutes. Take your time!")
        print(f"{'='*60}\n")
        
        # Go to LinkedIn login and STAY THERE - don't redirect
        await self.page.goto("https://www.linkedin.com/login", timeout=30000)
        
        # Just wait - don't poll aggressively or navigate
        start = asyncio.get_event_loop().time()
        timeout = timeout_minutes * 60
        
        while (asyncio.get_event_loop().time() - start) < timeout:
            # Wait 10 seconds between checks (gives user time to type)
            await asyncio.sleep(10)
            
            try:
                url = self.page.url
                
                # Check if they've reached Sales Navigator
                if '/sales/' in url and 'login' not in url.lower() and 'checkpoint' not in url.lower():
                    print("\n[LinkedIn] Sales Navigator detected - login successful!")
                    self.is_authenticated = True
                    await self.context.storage_state(path=str(LINKEDIN_STORAGE_STATE))
                    return True
                
                # Check if they're on regular LinkedIn (logged in but not sales nav yet)
                if 'linkedin.com/feed' in url or 'linkedin.com/in/' in url:
                    print("[LinkedIn] Logged into LinkedIn. Now go to Sales Navigator...")
                    print("[LinkedIn] Navigate to: https://www.linkedin.com/sales/home")
                    
            except Exception:
                pass  # Page might be navigating, ignore errors
        
        print("[LinkedIn] Login timeout")
        return False
    
    async def reset_search_state(self):
        """
        Reset the search state by navigating to Sales Navigator home.
        This clears all filters and previous search context.
        """
        print(f"[LinkedIn] Resetting search state...")
        try:
            # Add a small random delay to avoid synchronized requests across workers
            import random
            await asyncio.sleep(random.uniform(1, 3))
            
            await self.page.goto("https://www.linkedin.com/sales/home", timeout=30000)
            await self.page.wait_for_load_state('domcontentloaded', timeout=15000)
            await asyncio.sleep(3)  # Longer wait to be gentle
            print(f"[LinkedIn] Search state reset")
        except Exception as e:
            print(f"[LinkedIn] Reset error: {e}")
    
    async def search_company(self, company_name: str) -> Optional[str]:
        """
        Search for a company in Sales Navigator and return its profile URL.
        """
        import random
        print(f"[LinkedIn] Searching for company: {company_name}")
        
        try:
            # Only navigate to home if NOT already there
            # This avoids extra requests while still clearing filters from search result pages
            current_url = self.page.url
            if '/sales/home' not in current_url:
                await self.page.goto("https://www.linkedin.com/sales/home", timeout=30000)
                await self.page.wait_for_load_state('networkidle', timeout=20000)
                await asyncio.sleep(random.uniform(3, 5))
            else:
                # Already on home, just wait a bit
                await asyncio.sleep(random.uniform(1, 2))
            
            # Use the search bar
            print(f"[LinkedIn] Using search bar...")
            
            search_input = self.page.locator('input[placeholder*="Search"]').first
            
            try:
                await search_input.wait_for(state='visible', timeout=10000)
                await search_input.click()
                await asyncio.sleep(random.uniform(0.5, 1.5))
                
                # Clear any existing text first
                await search_input.fill('')
                await asyncio.sleep(0.5)
                
                # Type the new company name
                await search_input.fill(company_name)
                await asyncio.sleep(random.uniform(3, 5))  # Wait before submitting
                await search_input.press('Enter')
                
                # Wait for search results to fully load
                try:
                    await self.page.wait_for_load_state('networkidle', timeout=15000)
                except:
                    pass
                await asyncio.sleep(random.uniform(5, 8))  # Additional wait after results
            except Exception as e:
                print(f"[LinkedIn] Search bar error: {e}")
                return None
            
            # Switch to "Accounts" tab to find the company
            print(f"[LinkedIn] Switching to Accounts tab...")
            
            accounts_tab = self.page.locator('button:has-text("Accounts")').or_(
                self.page.locator('button:has-text("Account")')
            ).first
            
            try:
                if await accounts_tab.count() > 0:
                    await accounts_tab.click()
                    await asyncio.sleep(random.uniform(3, 5))
            except Exception:
                pass
            
            # Click on the first company result to go to its profile
            print(f"[LinkedIn] Looking for company in results...")
            
            company_link = self.page.locator('a[href*="/sales/company/"]').first
            
            if await company_link.count() > 0:
                await company_link.click()
                await asyncio.sleep(random.uniform(3, 5))
                
                # Now we should be on the company profile page
                if '/sales/company/' in self.page.url:
                    print(f"[LinkedIn] On company profile: {self.page.url}")
                    return self.page.url
            
            print(f"[LinkedIn] Company not found: {company_name}")
            return None
            
        except Exception as e:
            print(f"[LinkedIn] Search error: {e}")
            return None
    
    async def click_decision_makers(self) -> bool:
        """
        Click the 'Decision Makers' link on a company profile page.
        This automatically sets up the right filters.
        """
        import random
        print(f"[LinkedIn] Looking for Decision Makers link...")
        
        try:
            # Small delay before interacting
            await asyncio.sleep(random.uniform(1, 2))
            
            # Look for the Decision Makers link/button
            dm_link = self.page.locator('a:has-text("Decision maker")').or_(
                self.page.locator('a:has-text("decision maker")')
            ).or_(
                self.page.locator('button:has-text("Decision maker")')
            ).or_(
                self.page.locator('[data-test*="decision"]')
            ).or_(
                self.page.locator('a:has-text("View decision")')
            ).first
            
            if await dm_link.count() > 0:
                print(f"[LinkedIn] Clicking Decision Makers...")
                await dm_link.click()
                await asyncio.sleep(random.uniform(5, 8))  # Longer wait for results to load
                print(f"[LinkedIn] Now on: {self.page.url}")
                return True
            
            # Try scrolling down to find it
            await self.page.evaluate("window.scrollTo(0, 500)")
            await asyncio.sleep(random.uniform(2, 3))
            
            if await dm_link.count() > 0:
                await dm_link.click()
                await asyncio.sleep(random.uniform(5, 8))
                return True
            
            print(f"[LinkedIn] Decision Makers link not found")
            return False
            
        except Exception as e:
            print(f"[LinkedIn] Error clicking Decision Makers: {e}")
            return False
    
    async def get_company_employees(
        self, 
        company_url: str, 
        max_employees: int = 20,
        title_filter: str = None
    ) -> List[Dict]:
        """
        Get employees from a company's Sales Navigator page.
        
        Args:
            company_url: Sales Nav company URL or "SEARCH:company_name"
            max_employees: Max employees to scrape
            title_filter: Optional title keyword filter (e.g., "CEO", "VP", "Director")
        
        Returns list of employee dicts with name, title, linkedin_url
        """
        employees = []
        
        try:
            # Handle keyword search mode
            if company_url and company_url.startswith('SEARCH:'):
                company_name = company_url.replace('SEARCH:', '')
                # Search for people with this company keyword
                search_query = f"{company_name}"
                if title_filter:
                    search_query += f" {title_filter}"
                
                people_url = f"https://www.linkedin.com/sales/search/people?query=(keywords%3A{quote(search_query)})"
                print(f"[LinkedIn] Searching people with keyword: {search_query}")
                
            elif company_url and '/sales/company/' in company_url:
                company_id = company_url.split('/sales/company/')[1].split('/')[0].split('?')[0]
                people_url = f"https://www.linkedin.com/sales/search/people?companyIncluded={company_id}"
                
                if title_filter:
                    people_url += f"&titleIncluded={quote(title_filter)}"
            else:
                # Already on search results, just proceed
                print(f"[LinkedIn] Using current page for results")
                people_url = None
            
            if people_url:
                print(f"[LinkedIn] Navigating to people search...")
                await self.page.goto(people_url, timeout=30000)
            
            # Wait for results to load
            await self.page.wait_for_load_state('domcontentloaded', timeout=15000)
            await asyncio.sleep(5)
            
            # Scroll to load more results
            print(f"[LinkedIn] Scrolling to load results...")
            for _ in range(3):
                await self.page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
                await asyncio.sleep(2)
            
            # Try multiple selectors for employee cards
            card_selectors = [
                '[data-view-name="search-results-lead-card"]',
                '.search-results__result-item',
                'li.artdeco-list__item',
                '[data-x-search-result="LEAD"]',
            ]
            
            cards = None
            for selector in card_selectors:
                test = self.page.locator(selector)
                if await test.count() > 0:
                    cards = test
                    print(f"[LinkedIn] Found results with selector: {selector}")
                    break
            
            if not cards:
                print(f"[LinkedIn] No employee cards found")
                return employees
            
            count = await cards.count()
            print(f"[LinkedIn] Found {count} employee cards")
            
            for i in range(min(count, max_employees)):
                try:
                    card = cards.nth(i)
                    
                    # Try multiple name selectors
                    name = None
                    for name_selector in ['[data-anonymize="person-name"]', '.artdeco-entity-lockup__title', 'a span']:
                        name_el = card.locator(name_selector).first
                        if await name_el.count() > 0:
                            name = await name_el.text_content()
                            if name and len(name.strip()) > 1:
                                name = name.strip()
                                break
                    
                    # Try multiple title selectors
                    title = None
                    for title_selector in ['[data-anonymize="title"]', '.artdeco-entity-lockup__subtitle', '.t-14']:
                        title_el = card.locator(title_selector).first
                        if await title_el.count() > 0:
                            title = await title_el.text_content()
                            if title:
                                title = title.strip()
                                break
                    
                    # Get LinkedIn URL
                    linkedin_url = None
                    link_el = card.locator('a[href*="/sales/lead/"], a[href*="/in/"]').first
                    if await link_el.count() > 0:
                        linkedin_url = await link_el.get_attribute('href')
                    
                    if name:
                        employee = {
                            'name': name,
                            'title': title,
                            'linkedin_url': linkedin_url
                        }
                        employees.append(employee)
                        print(f"  - {employee['name']}: {employee.get('title', 'N/A')}")
                        
                except Exception as e:
                    print(f"[LinkedIn] Error extracting employee {i}: {e}")
                    continue
            
        except Exception as e:
            print(f"[LinkedIn] Error getting employees: {e}")
        
        return employees
    
    async def scrape_company_contacts(
        self,
        company_name: str,
        domain: str,
        max_contacts: int = 10,
        extract_public_urls: bool = False
    ) -> Dict:
        """
        Full pipeline: 
        1. Search for company (includes state reset)
        2. Go to company profile
        3. Click "Decision Makers" 
        4. Scrape the results
        
        Args:
            company_name: Company name to search
            domain: Company domain
            max_contacts: Max contacts to return
            extract_public_urls: If True, extract public /in/ URLs (slower but free).
                                 If False, only get /sales/lead/ URLs (faster).
        """
        result = {
            'company_name': company_name,
            'domain': domain,
            'employees': [],
            'status': 'pending'
        }
        
        # Note: search_company() already navigates to home to reset filters
        # Don't call reset_search_state() separately - that doubles the requests!
        
        # Step 1: Search for company and go to profile
        company_url = await self.search_company(company_name)
        
        if not company_url:
            result['status'] = 'company_not_found'
            return result
        
        # Step 2: Click "Decision Makers" on the company profile
        if await self.click_decision_makers():
            # Step 3: Scrape the decision makers
            if extract_public_urls:
                # Slower but gets public /in/ URLs directly from Sales Nav
                employees = await self.scrape_current_results_with_public_urls(
                    max_employees=max_contacts * 2,
                    extract_public_urls=True
                )
            else:
                # Faster, only gets /sales/lead/ URLs
                employees = await self.scrape_current_results(max_employees=max_contacts * 2)
            result['employees'] = employees
        else:
            # Fallback: try to get employees from company page directly
            print(f"[LinkedIn] Trying direct people search...")
            employees = await self.get_company_employees(
                company_url, 
                max_employees=max_contacts,
                title_filter=None
            )
            result['employees'] = employees
        
        # Dedupe by name
        seen = set()
        unique_employees = []
        for emp in result['employees']:
            name_key = emp['name'].lower().strip()
            if name_key not in seen and len(name_key) > 2:
                seen.add(name_key)
                unique_employees.append(emp)
        
        result['employees'] = unique_employees[:max_contacts]
        result['status'] = 'success' if result['employees'] else 'no_employees_found'
        
        return result
    
    async def scrape_current_results(self, max_employees: int = 50) -> List[Dict]:
        """
        Scrape employee results from the current page (after clicking Decision Makers).
        """
        employees = []
        
        try:
            # Wait for results to load
            await self.page.wait_for_load_state('domcontentloaded', timeout=15000)
            await asyncio.sleep(4)
            
            # Scroll the results container (not the window) to load all results
            print(f"[LinkedIn] Scrolling results container to load all...")
            last_count = 0
            no_change_count = 0
            
            for scroll_attempt in range(25):  # More scroll attempts
                # Scroll down incrementally in the container
                await self.page.evaluate("""
                    const container = document.querySelector('#search-results-container');
                    if (container) {
                        // Scroll down by 1000px each time (incremental)
                        container.scrollTop += 1000;
                    }
                """)
                await asyncio.sleep(1.5)  # Wait for lazy load
                
                # Check if we loaded more
                check_cards = self.page.locator('[data-x-search-result="LEAD"]')
                current_count = await check_cards.count()
                
                if current_count != last_count:
                    print(f"[LinkedIn] Scroll {scroll_attempt + 1}: {current_count} leads loaded")
                    no_change_count = 0
                else:
                    no_change_count += 1
                
                if current_count >= max_employees:
                    print(f"[LinkedIn] Reached max {max_employees} leads")
                    break
                    
                # If no change after 5 scrolls, we've hit the bottom
                if no_change_count >= 5:
                    print(f"[LinkedIn] Reached bottom with {current_count} leads")
                    break
                    
                last_count = current_count
            
            # One final scroll to make sure we're at the bottom
            await self.page.evaluate("""
                const container = document.querySelector('#search-results-container');
                if (container) container.scrollTop = container.scrollHeight;
            """)
            await asyncio.sleep(2)
            
            # Save page HTML for debugging
            debug_path = Path(config.DATA_DIR) / "linkedin_search_debug.html"
            html = await self.page.content()
            debug_path.write_text(html, encoding='utf-8')
            print(f"[LinkedIn] Saved debug HTML to: {debug_path}")
            
            # Find result cards - use the exact data attribute for lead results
            cards = self.page.locator('[data-x-search-result="LEAD"]')
            count = await cards.count()
            print(f"[LinkedIn] Found {count} lead cards")
            
            if not cards:
                print(f"[LinkedIn] No result cards found")
                return employees
            
            count = await cards.count()
            
            print(f"[LinkedIn] Extracting data from {min(count, max_employees)} cards...")
            
            for i in range(min(count, max_employees)):
                try:
                    card = cards.nth(i)
                    
                    # Get name from data-anonymize="person-name"
                    name = None
                    name_el = card.locator('[data-anonymize="person-name"]').first
                    if await name_el.count() > 0:
                        name = await name_el.text_content()
                        if name:
                            name = name.strip()
                    
                    # Get title from data-anonymize="title"
                    title = None
                    title_el = card.locator('[data-anonymize="title"]').first
                    if await title_el.count() > 0:
                        title = await title_el.text_content()
                        if title:
                            title = title.strip()
                    
                    # Get LinkedIn URL from lead link
                    linkedin_url = None
                    link = card.locator('a[href*="/sales/lead/"]').first
                    if await link.count() > 0:
                        linkedin_url = await link.get_attribute('href')
                    
                    if name and len(name) > 2:
                        employee = {
                            'name': name,
                            'title': title,
                            'linkedin_url': linkedin_url
                        }
                        employees.append(employee)
                        print(f"  - {name}: {title or 'N/A'}")
                        
                except Exception as e:
                    print(f"  [error] Card {i}: {e}")
                    continue
            
        except Exception as e:
            print(f"[LinkedIn] Error scraping results: {e}")
        
        return employees


    async def navigate_to_account_search(self):
        """Navigate to the Account search page in Sales Navigator."""
        import random
        print("[LinkedIn] Navigating to Account search...")
        
        try:
            # Go to Account search URL
            await self.page.goto("https://www.linkedin.com/sales/search/company", timeout=30000)
            await self.page.wait_for_load_state('domcontentloaded', timeout=15000)
            await asyncio.sleep(random.uniform(3, 5))
            
            # Make sure we're on the Account tab
            account_tab = self.page.locator('button:has-text("Account")').or_(
                self.page.locator('button:has-text("Accounts")')
            ).first
            
            if await account_tab.count() > 0:
                # Check if already selected
                is_selected = await account_tab.evaluate("el => el.getAttribute('aria-selected') === 'true'")
                if not is_selected:
                    await account_tab.click()
                    await asyncio.sleep(random.uniform(2, 3))
            
            print("[LinkedIn] On Account search page")
            return True
            
        except Exception as e:
            print(f"[LinkedIn] Error navigating to Account search: {e}")
            return False
    
    async def build_search_url(self, filters: Dict) -> Optional[str]:
        """
        Build a direct Sales Navigator search URL with filters.
        Applies first industry filter to get sessionId and query structure,
        then extracts location IDs and builds complete URL.
        
        Args:
            filters: Dictionary with filter specifications from SalesNavFilterParser
            
        Returns:
            Constructed URL string or None if unable to build
        """
        from urllib.parse import quote, unquote
        import re
        
        try:
            session_id = None
            industry_filters = []
            location_filters = []
            
            # Apply first industry filter to get sessionId and query structure
            if filters.get("industry"):
                industries = filters["industry"] if isinstance(filters["industry"], list) else [filters["industry"]]
                if industries:
                    print(f"[LinkedIn] Applying first industry filter to get sessionId...")
                    await self._apply_industry_filter(industries[0])
                    await asyncio.sleep(2)
                    
                    # Extract sessionId and query from URL
                    current_url = self.page.url
                    
                    if 'sessionId=' in current_url:
                        session_id = current_url.split('sessionId=')[1].split('&')[0]
                        print(f"[LinkedIn] Extracted sessionId: {session_id[:20]}...")
                    
                    if 'query=' in current_url:
                        # Extract and parse the query parameter
                        query_part = current_url.split('query=')[1].split('&')[0]
                        query_decoded = unquote(query_part)
                        
                        # Extract all industry IDs from the query
                        industry_pattern = r'type:INDUSTRY[^)]*?id:(\d+),text:([^,)]+),selectionType:(\w+)'
                        industry_matches = re.findall(industry_pattern, query_decoded)
                        
                        for industry_match in industry_matches:
                            industry_id, industry_text, selection_type = industry_match
                            industry_filters.append({
                                "type": "INDUSTRY",
                                "id": industry_id,
                                "text": unquote(industry_text),
                                "selectionType": selection_type
                            })
                            print(f"[LinkedIn] Extracted industry: {unquote(industry_text)} (ID: {industry_id})")
                        
                        # Add remaining industries if any
                        for industry in industries[1:]:
                            industry_id = await self._get_filter_id_from_url("INDUSTRY", industry)
                            if industry_id:
                                industry_filters.append({
                                    "type": "INDUSTRY",
                                    "id": industry_id,
                                    "text": industry,
                                    "selectionType": "INCLUDED"
                                })
            
            if not session_id:
                print("[LinkedIn] Could not extract sessionId, falling back to UI filter application")
                return None
            
            # Extract location IDs from dropdown WITHOUT applying them
            # This avoids UI interaction - we just get IDs and build the URL directly
            if filters.get("headquarters_location"):
                locations = filters["headquarters_location"] if isinstance(filters["headquarters_location"], list) else [filters["headquarters_location"]]
                
                print(f"[LinkedIn] Extracting location IDs from dropdown (NOT applying filters)...")
                for location in locations:
                    # Get location ID from dropdown without applying the filter
                    location_id = await self._get_location_id_from_dropdown(location)
                    if location_id:
                        # Verify the ID is reasonable (should be 6+ digits for locations)
                        if len(location_id) >= 6:
                            location_filters.append({
                                "type": "REGION",
                                "id": location_id,
                                "text": location,
                                "selectionType": "INCLUDED"
                            })
                            print(f"[LinkedIn] ✓ Extracted location ID: {location} (ID: {location_id})")
                        else:
                            print(f"[LinkedIn] Warning: Location ID seems invalid ({location_id}), will try applying filter to verify")
                            location_id = None  # Reset to trigger fallback
                    
                    if not location_id:
                        print(f"[LinkedIn] Could not extract ID for location: {location}, applying filter to get ID from URL...")
                        # Fallback: apply filter to get ID from URL (this is more reliable)
                        await self._apply_location_filter(location)
                        await asyncio.sleep(2)  # Wait for URL to update
                        current_url = self.page.url
                        if 'query=' in current_url:
                            import re
                            from urllib.parse import unquote
                            query_part = current_url.split('query=')[1].split('&')[0]
                            query_decoded = unquote(query_part)
                            # Extract all REGION IDs and find the one matching this location
                            region_pattern = r'type:REGION[^)]*?id:(\d+),text:([^,)]+)'
                            region_matches = re.findall(region_pattern, query_decoded)
                            
                            # Find the ID that matches this location - prioritize exact or most specific match
                            location_id = None
                            location_normalized = location.strip().lower()
                            location_parts = [part.strip().lower() for part in location.split(',')]
                            primary_location = location_parts[0] if location_parts else location_normalized
                            
                            best_match_score = 0
                            for match_id, match_text in region_matches:
                                match_text_decoded = unquote(match_text).strip().lower()
                                
                                # Score 3: Exact match
                                if match_text_decoded == location_normalized:
                                    location_id = match_id
                                    print(f"[LinkedIn] Found exact URL match: {match_text_decoded} (ID: {match_id})")
                                    break
                                
                                # Score 2: Contains both primary location and full location text
                                elif (primary_location in match_text_decoded and 
                                      location_normalized in match_text_decoded):
                                    if best_match_score < 2:
                                        location_id = match_id
                                        best_match_score = 2
                                        print(f"[LinkedIn] Found specific URL match: {match_text_decoded} (ID: {match_id})")
                                
                                # Score 1: Contains primary location
                                elif primary_location in match_text_decoded:
                                    if best_match_score < 1:
                                        location_id = match_id
                                        best_match_score = 1
                            
                            # If no match found, use the last REGION ID (most recently added) as fallback
                            if not location_id and region_matches:
                                location_id = region_matches[-1][0]
                                print(f"[LinkedIn] Using last REGION ID as fallback: {location_id}")
                            
                            if location_id:
                                # Remove any existing filter for this location to avoid duplicates
                                location_filters = [f for f in location_filters if f['text'] != location]
                                location_filters.append({
                                    "type": "REGION",
                                    "id": location_id,
                                    "text": location,
                                    "selectionType": "INCLUDED"
                                })
                                print(f"[LinkedIn] ✓ Extracted location ID from URL: {location} (ID: {location_id})")
                            else:
                                print(f"[LinkedIn] ✗ Could not extract location ID from URL for: {location}")
                
                print(f"[LinkedIn] Extracted {len(location_filters)} location IDs - building URL now...")
            
            # Combine all filters
            all_filters = industry_filters + location_filters
            
            if not all_filters:
                print("[LinkedIn] No valid filters extracted, falling back to UI")
                return None
            
            # Build the query parameter
            # Group filters by type
            filters_by_type = {}
            for filter_item in all_filters:
                filter_type = filter_item['type']
                if filter_type not in filters_by_type:
                    filters_by_type[filter_type] = []
                filters_by_type[filter_type].append(filter_item)
            
            # Build filter parts: (type:INDUSTRY,values:List((id:48,text:Construction,selectionType:INCLUDED)))
            filter_parts = []
            for filter_type, filter_items in filters_by_type.items():
                values = []
                for item in filter_items:
                    values.append(f"(id:{item['id']},text:{quote(item['text'])},selectionType:{item['selectionType']})")
                filter_parts.append(f"(type:{filter_type},values:List({','.join(values)}))")
            
            query_value = f"(filters:List({','.join(filter_parts)}))"
            
            # Build final URL
            url = f"https://www.linkedin.com/sales/search/company?query={quote(query_value)}&sessionId={quote(session_id)}"
            
            print(f"[LinkedIn] ✓ Built complete URL with {len(industry_filters)} industry and {len(location_filters)} location filters")
            print(f"[LinkedIn] Final URL: {url}")
            print(f"[LinkedIn] URL ready - will navigate directly (no more UI typing)")
            return url
            
        except Exception as e:
            print(f"[LinkedIn] Error building search URL: {e}")
            import traceback
            traceback.print_exc()
            return None
    
    async def _get_location_id_from_dropdown(self, location: str) -> Optional[str]:
        """
        Get location ID from dropdown without applying the filter.
        Expands the location filter, types in the search, and extracts ID from the dropdown option.
        
        Args:
            location: The location value (e.g., "Massachusetts, United States")
            
        Returns:
            Location ID string or None
        """
        try:
            # Find the Headquarters Location filter fieldset
            location_fieldset = self.page.locator('fieldset[data-x-search-filter="HEADQUARTERS_LOCATION"]')
            
            if await location_fieldset.count() == 0:
                return None
            
            # Expand the filter if not already expanded
            expand_button = location_fieldset.locator('button.search-filter__focus-target--button').first
            if await expand_button.count() > 0:
                aria_expanded = await expand_button.get_attribute('aria-expanded')
                if aria_expanded != 'true':
                    await expand_button.click()
                    await asyncio.sleep(1)
            
            # Find the search input
            search_input = location_fieldset.locator('input[placeholder*="Add locations" i]').first
            if await search_input.count() == 0:
                return None
            
            # Clear and type only the primary part (e.g. "California" not "California, United States")
            await search_input.click()
            await asyncio.sleep(0.2)
            await search_input.fill('')
            await asyncio.sleep(0.2)
            
            location_parts_raw = [p.strip() for p in location.split(',')]
            primary_part = location_parts_raw[0]   # e.g. "California"
            
            # Type primary part char-by-char to trigger autocomplete properly
            for char in primary_part:
                await search_input.type(char, delay=80)
            
            # Wait for dropdown to appear
            try:
                await self.page.wait_for_selector('[role="listbox"]', state='visible', timeout=5000)
            except:
                pass
            
            # Poll until the option list stabilises
            option_count = await self._wait_for_dropdown_to_settle(timeout_seconds=8.0)
            
            result_options = self.page.locator('li[role="option"]')
            option_count = await result_options.count()
            
            if option_count == 0:
                return None
            
            # ── Score each option using the shared helper ──
            best_match = None
            best_score = 0
            
            for i in range(option_count):
                try:
                    option = result_options.nth(i)
                    location_text_span = option.locator('span.t-14').first
                    if await location_text_span.count() > 0:
                        option_text = await location_text_span.text_content()
                        if option_text:
                            score = self._score_location_match(option_text, location)
                            if score > best_score:
                                best_score = score
                                best_match = option
                                print(f"[LinkedIn] Dropdown option: '{option_text.strip()}' → score {score}")
                                if score >= 100:
                                    break
                except:
                    continue
            
            if best_match is None or best_score == 0:
                print(f"[LinkedIn] No matching location found in dropdown for '{location}'")
                await search_input.fill('')
                await asyncio.sleep(0.5)
                return None
            
            # Extract ID from the option's data attributes
            option_html = await best_match.evaluate('el => el.outerHTML')
            import re
            
            # Verify we have the correct location match
            matched_text = await best_match.locator('span.t-14').first.text_content() if await best_match.locator('span.t-14').first.count() > 0 else None
            matched_text_normalized = matched_text.strip().lower() if matched_text else ""
            location_normalized = location.strip().lower()
            
            print(f"[LinkedIn] Matched location option: {matched_text}")
            
            # Verify the match is correct - should be exact or contain the full location
            if matched_text_normalized != location_normalized:
                # Check if it's a valid match (contains the primary location)
                location_parts = [part.strip().lower() for part in location.split(',')]
                primary_location = location_parts[0] if location_parts else location_normalized
                
                if primary_location not in matched_text_normalized:
                    print(f"[LinkedIn] Warning: Matched location '{matched_text}' doesn't match requested '{location}'")
                    # Still try to extract ID, but log the warning
            
            # Look for data-x-search-filter-typeahead-suggestion="include-101098412"
            # This is the most reliable pattern
            match = re.search(r'data-x-search-filter-typeahead-suggestion="[^"]*?(\d+)"', option_html)
            if match:
                location_id = match.group(1)
                print(f"[LinkedIn] Extracted location ID: {location_id} for '{matched_text}'")
                # Clear the input to reset
                await search_input.fill('')
                await asyncio.sleep(0.5)
                return location_id
            
            # Try other patterns - look for button with data attribute
            include_button = best_match.locator('button[data-x-search-filter-typeahead-suggestion]').first
            if await include_button.count() > 0:
                button_attr = await include_button.get_attribute('data-x-search-filter-typeahead-suggestion')
                if button_attr:
                    match = re.search(r'(\d+)', button_attr)
                    if match:
                        location_id = match.group(1)
                        print(f"[LinkedIn] Extracted location ID from button attribute: {location_id}")
                        await search_input.fill('')
                        await asyncio.sleep(0.5)
                        return location_id
            
            # Try other patterns
            match = re.search(r'data-[^=]*="?(\d{6,})"?', option_html)
            if match:
                location_id = match.group(1)
                print(f"[LinkedIn] Extracted location ID from generic data attribute: {location_id}")
                await search_input.fill('')
                await asyncio.sleep(0.5)
                return location_id
            
            # Clear the input
            await search_input.fill('')
            await asyncio.sleep(0.5)
            print(f"[LinkedIn] Could not extract location ID from dropdown option")
            return None
            
        except Exception as e:
            print(f"[LinkedIn] Error getting location ID from dropdown for {location}: {e}")
            return None
    
    async def _get_filter_id_from_url(self, filter_type: str, filter_value: str) -> Optional[str]:
        """
        Get filter ID by applying the filter and extracting ID from the resulting URL.
        
        Args:
            filter_type: "INDUSTRY" or "REGION"
            filter_value: The filter value
            
        Returns:
            Filter ID string or None
        """
        try:
            # Apply the filter
            if filter_type == "INDUSTRY":
                await self._apply_industry_filter(filter_value)
            elif filter_type == "REGION":
                await self._apply_location_filter(filter_value)
            else:
                return None
            
            await asyncio.sleep(2)  # Wait for URL to update
            
            # Extract ID from URL
            current_url = self.page.url
            if 'query=' in current_url:
                import re
                # Look for the filter type and extract the ID
                # Pattern: type:INDUSTRY,values:List((id:48,text:Construction
                pattern = rf'type:{filter_type}[^)]*id:(\d+),text:[^,)]*{re.escape(filter_value.split(",")[0].strip())}'
                match = re.search(pattern, current_url)
                if match:
                    return match.group(1)
                
                # Alternative pattern: just look for the latest ID added
                # Get all IDs of this type and return the last one
                pattern = rf'type:{filter_type}[^)]*id:(\d+)'
                matches = re.findall(pattern, current_url)
                if matches:
                    return matches[-1]  # Return the last (most recently added) ID
            
            return None
            
        except Exception as e:
            print(f"[LinkedIn] Error getting filter ID from URL for {filter_type}={filter_value}: {e}")
            return None
    
    async def _get_filter_id(self, filter_type: str, filter_value: str) -> Optional[str]:
        """
        Get the filter ID for a given filter type and value by expanding the filter and extracting ID from options.
        
        Args:
            filter_type: "INDUSTRY" or "HEADQUARTERS_LOCATION"
            filter_value: The filter value (e.g., "Construction" or "Massachusetts, United States")
            
        Returns:
            Filter ID string or None
        """
        try:
            # Find the appropriate filter fieldset
            if filter_type == "INDUSTRY":
                fieldset = self.page.locator('fieldset[data-x-search-filter="INDUSTRY"]')
            elif filter_type == "HEADQUARTERS_LOCATION":
                fieldset = self.page.locator('fieldset[data-x-search-filter="HEADQUARTERS_LOCATION"]')
            else:
                return None
            
            if await fieldset.count() == 0:
                return None
            
            # Expand the filter if not already expanded
            expand_button = fieldset.locator('button.search-filter__focus-target--button').first
            if await expand_button.count() > 0:
                aria_expanded = await expand_button.get_attribute('aria-expanded')
                if aria_expanded != 'true':
                    await expand_button.click()
                    await asyncio.sleep(1)
            
            # For locations, we need to type in the search input
            if filter_type == "HEADQUARTERS_LOCATION":
                search_input = fieldset.locator('input[placeholder*="Add locations" i]').first
                if await search_input.count() > 0:
                    await search_input.click()
                    await asyncio.sleep(0.5)
                    await search_input.fill('')
                    await asyncio.sleep(0.5)
                    # Type the location
                    for char in filter_value:
                        await search_input.type(char, delay=50)
                    await asyncio.sleep(2)  # Wait for dropdown
            
            # Look for the option in dropdown or suggestions
            # Try to find the option with the filter value
            if filter_type == "INDUSTRY":
                option = fieldset.locator(f'button[aria-label*="{filter_value}" i], button:has-text("{filter_value}")').first
            else:
                # For locations, look in the dropdown options
                option = self.page.locator(f'li[role="option"]:has-text("{filter_value.split(",")[0]}")').first
            
            if await option.count() > 0:
                # Extract ID from data attributes
                # Check for data-x-search-filter-typeahead-suggestion or similar
                option_html = await option.evaluate('el => el.outerHTML')
                
                # Look for data attributes with IDs
                import re
                # Pattern 1: data-x-search-filter-typeahead-suggestion="include-91000010"
                match = re.search(r'data-x-search-filter-typeahead-suggestion="[^"]*?(\d+)"', option_html)
                if match:
                    return match.group(1)
                
                # Pattern 2: data attributes with numeric IDs
                match = re.search(r'data-[^=]*="?(\d{6,})"?', option_html)
                if match:
                    return match.group(1)
                
                # Pattern 3: aria-label with ID pattern
                aria_label = await option.get_attribute('aria-label')
                if aria_label:
                    match = re.search(r'(\d{6,})', aria_label)
                    if match:
                        return match.group(1)
            
            # If we can't find it, try applying the filter and extracting from URL
            # This is a fallback
            if filter_type == "INDUSTRY":
                await self._apply_industry_filter(filter_value)
            elif filter_type == "HEADQUARTERS_LOCATION":
                await self._apply_location_filter(filter_value)
            
            await asyncio.sleep(2)
            
            # Extract from URL
            current_url = self.page.url
            if 'query=' in current_url:
                import re
                # Look for the filter value in the URL and extract its ID
                pattern = rf'id:(\d+),text:[^,)]*{re.escape(filter_value.split(",")[0].strip())}'
                match = re.search(pattern, current_url)
                if match:
                    return match.group(1)
            
            return None
            
        except Exception as e:
            print(f"[LinkedIn] Error getting filter ID for {filter_type}={filter_value}: {e}")
            return None
    
    async def apply_filters(self, filters: Dict):
        """
        Apply filters to the Account search page.
        Tries to build a direct URL by applying first filter to get sessionId,
        then extracting all filter IDs and building complete URL.
        
        Args:
            filters: Dictionary with filter specifications from SalesNavFilterParser
        """
        import random
        print(f"[LinkedIn] Applying filters: {filters}")
        
        try:
            # Try to build direct URL (applies first filter to get sessionId, then builds URL)
            direct_url = await self.build_search_url(filters)
            if direct_url:
                print(f"[LinkedIn] Navigating to direct URL with all filters...")
                print(f"[LinkedIn] URL: {direct_url[:150]}...")  # Print first 150 chars for debugging
                # Use 'domcontentloaded' instead of 'networkidle' — LinkedIn's SPA
                # keeps persistent connections open that prevent networkidle from
                # ever being reached, causing timeouts.
                await self.page.goto(direct_url, timeout=60000, wait_until='domcontentloaded')
                await asyncio.sleep(5)  # Wait for SPA to render results
                
                # Verify the URL was applied correctly by checking the current URL
                current_url = self.page.url
                print(f"[LinkedIn] Current URL after navigation: {current_url[:150]}...")
                
                # Wait for results to appear
                try:
                    await self.page.wait_for_selector('[data-x-search-result="COMPANY"], a[href*="/sales/company/"]', timeout=10000)
                    print("[LinkedIn] Results detected on page")
                except:
                    print("[LinkedIn] Warning: Results not detected, but continuing...")
                
                print("[LinkedIn] Filters applied via direct URL")
                return
            
            # Fallback to UI interaction if URL building failed
            print("[LinkedIn] Falling back to UI filter application...")
            await asyncio.sleep(random.uniform(2, 3))
            
            # Save page HTML for debugging filter structure
            debug_path = Path(config.DATA_DIR) / "salesnav_filters_debug.html"
            html = await self.page.content()
            debug_path.write_text(html, encoding='utf-8')
            print(f"[LinkedIn] Saved filter page HTML to: {debug_path}")
            
            # Apply Industry filter
            if filters.get("industry"):
                industries = filters["industry"] if isinstance(filters["industry"], list) else [filters["industry"]]
                for industry in industries:
                    await self._apply_industry_filter(industry)
                    await asyncio.sleep(random.uniform(1, 2))
            
            # Apply Headquarters Location filter
            if filters.get("headquarters_location"):
                locations = filters["headquarters_location"] if isinstance(filters["headquarters_location"], list) else [filters["headquarters_location"]]
                for location in locations:
                    await self._apply_location_filter(location)
                    await asyncio.sleep(random.uniform(1, 2))
            
            # Apply Company Headcount filter
            if filters.get("company_headcount"):
                await self._apply_headcount_filter(filters["company_headcount"])
                await asyncio.sleep(random.uniform(1, 2))
            
            # Apply Annual Revenue filter
            if filters.get("annual_revenue"):
                await self._apply_revenue_filter(filters["annual_revenue"])
                await asyncio.sleep(random.uniform(1, 2))
            
            # Wait for results to update
            await asyncio.sleep(random.uniform(3, 5))
            print("[LinkedIn] Filters applied via UI")
            
        except Exception as e:
            print(f"[LinkedIn] Error applying filters: {e}")
            import traceback
            traceback.print_exc()
    
    async def _apply_industry_filter(self, industry: str):
        """Apply an industry filter using the correct LinkedIn Sales Navigator selectors."""
        try:
            print(f"[LinkedIn] Applying industry filter: {industry}")
            
            # Find the Industry filter fieldset by data attribute
            industry_fieldset = self.page.locator('fieldset[data-x-search-filter="INDUSTRY"]')
            
            if await industry_fieldset.count() == 0:
                print("[LinkedIn] Industry filter fieldset not found")
                return
            
            # Find the expand button (plus icon button)
            expand_button = industry_fieldset.locator('button.search-filter__focus-target--button')
            
            if await expand_button.count() == 0:
                print("[LinkedIn] Industry filter expand button not found")
                return
            
            # Check if already expanded
            aria_expanded = await expand_button.get_attribute('aria-expanded')
            if aria_expanded != 'true':
                # Click to expand
                await expand_button.click()
                await asyncio.sleep(2)  # Wait for filter panel to expand
            
            # Now look for the input field or suggestion buttons
            # LinkedIn might show suggestion buttons or a search input
            # Try suggestion buttons first (they appear when filter is expanded)
            suggestion_button = industry_fieldset.locator(f'button[aria-label*="{industry}" i]').or_(
                industry_fieldset.locator(f'button:has-text("{industry}")')
            ).first
            
            if await suggestion_button.count() > 0:
                await suggestion_button.click()
                await asyncio.sleep(1)
                print(f"[LinkedIn] Applied industry filter via suggestion: {industry}")
                return
            
            # If no suggestion button, look for search input
            search_input = industry_fieldset.locator('input[type="text"]').or_(
                industry_fieldset.locator('input[placeholder*="Industry" i]')
            ).first
            
            if await search_input.count() > 0:
                await search_input.fill(industry)
                await asyncio.sleep(2)  # Wait for autocomplete
                
                # Look for autocomplete results
                result_options = industry_fieldset.locator('[role="option"]').or_(
                    industry_fieldset.locator('li[role="option"]')
                ).or_(
                    industry_fieldset.locator(f'button:has-text("{industry}")')
                )
                
                if await result_options.count() > 0:
                    # Try to find exact match first
                    for i in range(await result_options.count()):
                        text = await result_options.nth(i).text_content()
                        if industry.lower() in text.lower():
                            await result_options.nth(i).click()
                            await asyncio.sleep(1)
                            print(f"[LinkedIn] Applied industry filter: {industry}")
                            return
                    # Fallback to first result
                    await result_options.first.click()
                    await asyncio.sleep(1)
                    print(f"[LinkedIn] Applied industry filter (first match): {industry}")
            else:
                print("[LinkedIn] No search input or suggestion buttons found for Industry filter")
                
        except Exception as e:
            print(f"[LinkedIn] Error applying industry filter {industry}: {e}")
            import traceback
            traceback.print_exc()
    
    async def _wait_for_dropdown_to_settle(self, timeout_seconds: float = 8.0, poll_interval: float = 0.8) -> int:
        """
        Wait until the dropdown option list stops changing (results fully loaded).
        Returns the final option count.
        """
        result_options = self.page.locator('li[role="option"]')
        last_count = 0
        stable_ticks = 0
        elapsed = 0.0

        while elapsed < timeout_seconds:
            current_count = await result_options.count()
            if current_count > 0 and current_count == last_count:
                stable_ticks += 1
                if stable_ticks >= 2:          # stable for 2 consecutive polls
                    return current_count
            else:
                stable_ticks = 0
            last_count = current_count
            await asyncio.sleep(poll_interval)
            elapsed += poll_interval

        return last_count

    def _score_location_match(self, option_text: str, target: str) -> int:
        """
        Score how well a dropdown option matches the target location.
        Higher is better.  0 = no match.

        Key rule:  "United States" must NOT match "California, United States".
        The option must be at least as specific as the target.
        """
        opt = option_text.strip().lower()
        tgt = target.strip().lower()

        # Exact match → best
        if opt == tgt:
            return 100

        # Split into parts for structural comparison
        tgt_parts = [p.strip() for p in tgt.split(',')]
        opt_parts = [p.strip() for p in opt.split(',')]
        primary_tgt = tgt_parts[0]          # e.g. "california"

        # Option must contain the primary (state/city) part to be a candidate at all
        if primary_tgt not in opt:
            return 0

        # Reject if the option is LESS specific than the target
        # e.g. target="california, united states" (2 parts) vs option="united states" (1 part)
        if len(opt_parts) < len(tgt_parts):
            return 0

        # Good match: option contains the full target text
        if tgt in opt:
            return 80

        # Decent match: primary part matches and specificity is comparable
        if primary_tgt == opt_parts[0]:
            return 60

        # Weak partial match
        return 20

    async def _apply_location_filter(self, location: str):
        """Apply a headquarters location filter using the correct LinkedIn Sales Navigator selectors."""
        try:
            print(f"[LinkedIn] Applying location filter: {location}")
            
            # Find the Headquarters Location filter fieldset
            location_fieldset = self.page.locator('fieldset[data-x-search-filter="HEADQUARTERS_LOCATION"]')
            
            if await location_fieldset.count() == 0:
                print("[LinkedIn] Headquarters Location filter fieldset not found")
                return
            
            # Find the expand button
            expand_button = location_fieldset.locator('button.search-filter__focus-target--button')
            
            if await expand_button.count() == 0:
                print("[LinkedIn] Location filter expand button not found")
                return
            
            # Check if already expanded
            aria_expanded = await expand_button.get_attribute('aria-expanded')
            if aria_expanded != 'true':
                await expand_button.click()
                await asyncio.sleep(2)
            
            # Find the search input with placeholder "Add locations"
            search_input = location_fieldset.locator('input[placeholder*="Add locations" i]').or_(
                location_fieldset.locator('input[placeholder*="Location" i]')
            ).or_(
                location_fieldset.locator('input.artdeco-typeahead__input')
            ).first
            
            if await search_input.count() == 0:
                print("[LinkedIn] Location search input not found")
                return
            
            # Clear any existing text
            await search_input.click()
            await asyncio.sleep(0.5)
            await search_input.fill('')
            await asyncio.sleep(0.5)
            
            # ── Type only the primary part first (e.g. "California" not
            # "California, United States") to get relevant results faster,
            # then wait for the dropdown to fully settle. ──
            location_parts = [p.strip() for p in location.split(',')]
            primary_part = location_parts[0]   # e.g. "California"
            
            # Type character by character to trigger autocomplete properly
            for char in primary_part:
                await search_input.type(char, delay=80)
            
            # Wait for the dropdown to appear
            print(f"[LinkedIn] Waiting for location dropdown to appear...")
            try:
                await self.page.wait_for_selector('[role="listbox"]', state='visible', timeout=5000)
            except:
                pass
            
            # ── Poll until the option list stabilises ──
            option_count = await self._wait_for_dropdown_to_settle(timeout_seconds=8.0)
            
            result_options = self.page.locator('li[role="option"]')
            option_count = await result_options.count()
            print(f"[LinkedIn] Found {option_count} location options in dropdown")
            
            if option_count == 0:
                print("[LinkedIn] No location options found in dropdown")
                return
            
            # ── Score each option and pick the best ──
            best_match = None
            best_score = 0
            
            for i in range(option_count):
                try:
                    option = result_options.nth(i)
                    location_text_span = option.locator('span.t-14').first
                    if await location_text_span.count() > 0:
                        option_text = await location_text_span.text_content()
                        if option_text:
                            score = self._score_location_match(option_text, location)
                            if score > best_score:
                                best_score = score
                                best_match = option
                                print(f"[LinkedIn] Option: '{option_text.strip()}' → score {score}")
                                if score >= 100:
                                    break      # exact match, stop early
                except Exception as e:
                    print(f"[LinkedIn] Error checking option {i}: {e}")
                    continue
            
            if best_match is None or best_score == 0:
                print(f"[LinkedIn] No matching location found for '{location}', skipping")
                return
            
            # Click the "Include" button within the matched option
            include_button = best_match.locator('button._include-button_1cz98z').or_(
                best_match.locator('button[aria-label*="Include" i]')
            ).or_(
                best_match.locator('div._include-button_1cz98z')
            ).first
            
            if await include_button.count() > 0:
                await include_button.click()
                await asyncio.sleep(1.5)
                print(f"[LinkedIn] Successfully applied location filter: {location}")
            else:
                # Fallback: click the option itself
                print("[LinkedIn] Include button not found, clicking option directly")
                await best_match.click()
                await asyncio.sleep(1.5)
                print(f"[LinkedIn] Applied location filter (via option click): {location}")
                
        except Exception as e:
            print(f"[LinkedIn] Error applying location filter {location}: {e}")
            import traceback
            traceback.print_exc()
    
    async def _apply_headcount_filter(self, headcount_range: str):
        """Apply a company headcount filter using the correct LinkedIn Sales Navigator selectors."""
        try:
            print(f"[LinkedIn] Applying headcount filter: {headcount_range}")
            
            # Find the Company Headcount filter fieldset
            headcount_fieldset = self.page.locator('fieldset[data-x-search-filter="COMPANY_HEADCOUNT"]')
            
            if await headcount_fieldset.count() == 0:
                print("[LinkedIn] Company Headcount filter fieldset not found")
                return
            
            # Find the expand button
            expand_button = headcount_fieldset.locator('button.search-filter__focus-target--button')
            
            if await expand_button.count() == 0:
                print("[LinkedIn] Headcount filter expand button not found")
                return
            
            # Check if already expanded
            aria_expanded = await expand_button.get_attribute('aria-expanded')
            if aria_expanded != 'true':
                await expand_button.click()
                await asyncio.sleep(2)
            
            # Look for the headcount range option
            # LinkedIn might show it as a button or checkbox
            range_option = headcount_fieldset.locator(f'button:has-text("{headcount_range}")').or_(
                headcount_fieldset.locator(f'label:has-text("{headcount_range}")')
            ).or_(
                headcount_fieldset.locator(f'[aria-label*="{headcount_range}"]')
            ).first
            
            if await range_option.count() > 0:
                await range_option.click()
                await asyncio.sleep(1)
                print(f"[LinkedIn] Applied headcount filter: {headcount_range}")
            else:
                print(f"[LinkedIn] Headcount range option '{headcount_range}' not found")
                
        except Exception as e:
            print(f"[LinkedIn] Error applying headcount filter {headcount_range}: {e}")
            import traceback
            traceback.print_exc()
    
    async def _apply_revenue_filter(self, revenue_range: str):
        """Apply an annual revenue filter using the correct LinkedIn Sales Navigator selectors."""
        try:
            print(f"[LinkedIn] Applying revenue filter: {revenue_range}")
            
            # Find the Annual Revenue filter fieldset
            revenue_fieldset = self.page.locator('fieldset[data-x-search-filter="ANNUAL_REVENUE"]')
            
            if await revenue_fieldset.count() == 0:
                print("[LinkedIn] Annual Revenue filter fieldset not found")
                return
            
            # Find the expand button
            expand_button = revenue_fieldset.locator('button.search-filter__focus-target--button')
            
            if await expand_button.count() == 0:
                print("[LinkedIn] Revenue filter expand button not found")
                return
            
            # Check if already expanded
            aria_expanded = await expand_button.get_attribute('aria-expanded')
            if aria_expanded != 'true':
                await expand_button.click()
                await asyncio.sleep(2)
            
            # Look for the revenue range option
            range_option = revenue_fieldset.locator(f'button:has-text("{revenue_range}")').or_(
                revenue_fieldset.locator(f'label:has-text("{revenue_range}")')
            ).or_(
                revenue_fieldset.locator(f'[aria-label*="{revenue_range}"]')
            ).first
            
            if await range_option.count() > 0:
                await range_option.click()
                await asyncio.sleep(1)
                print(f"[LinkedIn] Applied revenue filter: {revenue_range}")
            else:
                print(f"[LinkedIn] Revenue range option '{revenue_range}' not found")
                
        except Exception as e:
            print(f"[LinkedIn] Error applying revenue filter {revenue_range}: {e}")
            import traceback
            traceback.print_exc()
    
    # ── Regex that captures LinkedIn employee-count formats ──
    # Matches: "8.5K+", "14K+", "2.5K+", "311", "1,234", "3M+", etc.
    _EMP_NUMBER_RE = re.compile(
        r'(\d+(?:[.,]\d+)?)\s*([KkMm])?\+?'
    )

    @staticmethod
    def _parse_employee_text(raw: str) -> Optional[str]:
        """
        Extract the employee-count display string from text like
        "Construction · 8.5K+ employees on LinkedIn".

        Returns a human-friendly string such as "8.5K+" or "1,234",
        or None if nothing is found.
        """
        # First, try the full "N employees" pattern (most reliable)
        m = re.search(
            r'([\d,]+(?:\.\d+)?)\s*([KkMm])?\+?\s+employees?',
            raw, re.IGNORECASE,
        )
        if m:
            number_part = m.group(1)     # e.g. "8.5" or "1,234"
            suffix = m.group(2) or ''    # e.g. "K" or ""
            plus = '+' if '+' in raw[m.start():m.end() + 2] else ''
            return f"{number_part}{suffix.upper()}{plus}"
        return None

    @staticmethod
    def _employee_display_to_int(display: str) -> int:
        """
        Convert a display string like "8.5K+" to an approximate integer (8500).
        Used only for validation / sanity checks.
        """
        s = display.replace(',', '').replace('+', '').strip().upper()
        multiplier = 1
        if s.endswith('K'):
            multiplier = 1_000
            s = s[:-1]
        elif s.endswith('M'):
            multiplier = 1_000_000
            s = s[:-1]
        try:
            return int(float(s) * multiplier)
        except ValueError:
            return 0

    async def scrape_company_results(self, max_companies: int = 100) -> List[Dict]:
        """
        Scrape company results from the current Account search page.
        
        Args:
            max_companies: Maximum number of companies to scrape
            
        Returns:
            List of company dictionaries with name, industry, employee_count, linkedin_url, etc.
        """
        companies = []
        
        try:
            # Wait for results to load
            await self.page.wait_for_load_state('domcontentloaded', timeout=15000)
            await asyncio.sleep(4)
            
            # Scroll to load more results
            print(f"[LinkedIn] Scrolling to load company results...")
            last_count = 0
            no_change_count = 0
            
            for scroll_attempt in range(20):
                # Scroll down in the results container
                await self.page.evaluate("""
                    const container = document.querySelector('#search-results-container, [data-view-name="search-results-container"]');
                    if (container) {
                        container.scrollTop += 1000;
                    } else {
                        window.scrollTo(0, window.scrollY + 1000);
                    }
                """)
                await asyncio.sleep(2)
                
                # Check if we loaded more companies
                check_cards = self.page.locator('[data-x-search-result="COMPANY"], a[href*="/sales/company/"]')
                current_count = await check_cards.count()
                
                if current_count != last_count:
                    print(f"[LinkedIn] Scroll {scroll_attempt + 1}: {current_count} companies loaded")
                    no_change_count = 0
                else:
                    no_change_count += 1
                
                if current_count >= max_companies:
                    print(f"[LinkedIn] Reached max {max_companies} companies")
                    break
                
                if no_change_count >= 5:
                    print(f"[LinkedIn] Reached bottom with {current_count} companies")
                    break
                
                last_count = current_count
            
            # Find company result cards
            # Try multiple selectors for company cards
            # Prefer the data attribute selector first, as it's more specific
            card_selectors = [
                '[data-x-search-result="COMPANY"]',
                'li[data-x-search-result="COMPANY"]',
                '[data-view-name="search-results-company-card"]',
                '.search-results__result-item'
            ]
            
            cards = None
            for selector in card_selectors:
                test = self.page.locator(selector)
                if await test.count() > 0:
                    cards = test
                    print(f"[LinkedIn] Found results with selector: {selector}")
                    break
            
            # If no cards found with specific selectors, find main company links
            # Exclude button links upfront using CSS selector
            if not cards:
                # Find links that are NOT buttons - exclude links with button classes
                cards = self.page.locator(
                    'a[href*="/sales/company/"]:not([class*="_button_"]):not([class*="_footer-button_"]):not([class*="button--"])'
                )
                link_count = await cards.count()
                if link_count > 0:
                    print(f"[LinkedIn] Found {link_count} company links (excluding buttons)")
                else:
                    # Fallback: get all links and filter during extraction
                    cards = self.page.locator('a[href*="/sales/company/"]')
                    print(f"[LinkedIn] Using all company links (will filter during extraction)")
            
            if not cards:
                print(f"[LinkedIn] No company cards found")
                # Save page HTML for debugging
                debug_path = Path(config.DATA_DIR) / "company_results_debug.html"
                html = await self.page.content()
                debug_path.write_text(html, encoding='utf-8')
                print(f"[LinkedIn] Saved debug HTML to: {debug_path}")
                return companies
            
            count = await cards.count()
            total_to_extract = min(count, max_companies)
            print(f"[LinkedIn] Extracting data from {total_to_extract} companies (processing 2 at a time)...")
            
            # Save first card HTML for debugging if extraction fails
            if count > 0:
                first_card_html = await cards.first.evaluate('el => el.outerHTML')
                debug_card_path = Path(config.DATA_DIR) / "first_company_card_debug.html"
                debug_card_path.write_text(first_card_html, encoding='utf-8')
                print(f"[LinkedIn] Saved first card HTML to: {debug_card_path}")
            
            # Helper function to extract a single company
            async def extract_company(i: int) -> Optional[Dict]:
                """Extract company data from card at index i."""
                try:
                    card = cards.nth(i)
                    
                    # Skip if this is a button link (check classes)
                    classes = await card.get_attribute('class') or ''
                    if '_button_' in classes or '_footer-button_' in classes or 'button--' in classes:
                        return None  # Skip button links
                    
                    # Get company URL first (the card might be the link itself)
                    company_url = None
                    href = await card.get_attribute('href')
                    
                    if href:
                        # Skip section links (like strategic_priorities, aiqSection, anchor)
                        # But allow _ntb parameter (tracking parameter for main company links)
                        if 'aiqSection=' in href or 'anchor=' in href or 'strategic_priorities' in href:
                            return None  # Skip section links
                        
                        # Keep the full URL including _ntb parameter if present
                        # This is the main company link
                        company_url = href
                    else:
                        # Look for link within card
                        link = card.locator('a[href*="/sales/company/"]').first
                        if await link.count() > 0:
                            href = await link.get_attribute('href')
                            if href:
                                # Skip section links
                                if 'aiqSection=' not in href and 'anchor=' not in href and 'strategic_priorities' not in href:
                                    company_url = href
                    
                    if not company_url:
                        return None  # No valid company URL found
                    
                    if not company_url.startswith('http'):
                        company_url = f"https://www.linkedin.com{company_url}"
                    
                    # Try to find the actual card container (parent of the link)
                    # Look for parent elements that might contain the company name and employee count
                    card_container = card
                    try:
                        # Strategy 1: Look for parent with data-x-search-result="COMPANY"
                        parent = card.locator('xpath=ancestor::*[@data-x-search-result="COMPANY"][1]')
                        if await parent.count() > 0:
                            card_container = parent
                        else:
                            # Strategy 2: Look for parent li or div with result classes
                            parent = card.locator('xpath=ancestor::li[contains(@class, "result") or contains(@class, "card")][1] | ancestor::div[contains(@class, "result") or contains(@class, "card")][1]')
                            if await parent.count() > 0:
                                card_container = parent
                            else:
                                # Strategy 3: Look for any parent that contains company name element
                                parent = card.locator('xpath=ancestor::*[.//*[@data-anonymize="company-name"]][1]')
                                if await parent.count() > 0:
                                    card_container = parent
                                else:
                                    # Strategy 4: Use JavaScript to find the best parent container
                                    parent_info = await card.evaluate("""
                                        el => {
                                            let current = el;
                                            let best = el;
                                            for (let i = 0; i < 15 && current; i++) {
                                                // Look for elements that suggest this is the card container
                                                if (current.querySelector('[data-anonymize="company-name"]') || 
                                                    current.getAttribute('data-x-search-result') === 'COMPANY' ||
                                                    current.classList.contains('search-results__result-item') ||
                                                    (current.tagName === 'LI' && current.querySelector('a[href*="/sales/company/"]'))) {
                                                    best = current;
                                                }
                                                current = current.parentElement;
                                                if (!current || current.tagName === 'BODY') break;
                                            }
                                            return best;
                                        }
                                    """)
                                    # We found the best parent, but we need to locate it again
                                    # Try to find it by looking for the company name within the card's ancestors
                                    if parent_info:
                                        # Try to find a parent that contains both company name and likely employee info
                                        parent = card.locator('xpath=ancestor::*[.//*[@data-anonymize="company-name"] and (.//*[contains(text(), "employee")] or .//*[contains(@class, "subtitle")])][1]')
                                        if await parent.count() > 0:
                                            card_container = parent
                    except Exception as e:
                        # If xpath fails, continue with card as container
                        pass
                    
                    # Get company name - try multiple strategies using card_container
                    company_name = None
                    
                    # Strategy 1: Look for data-anonymize="company-name" attribute (most reliable)
                    name_el = card_container.locator('[data-anonymize="company-name"]').first
                    if await name_el.count() > 0:
                        company_name = await name_el.text_content()
                        if company_name:
                            company_name = company_name.strip()
                    
                    # Strategy 2: Look for common name selectors within the card container
                    if not company_name:
                        name_selectors = [
                            'span[data-anonymize="company-name"]',
                            '.artdeco-entity-lockup__title',
                            'h3',
                            'h2',
                            'span.t-16',
                            'span.t-14'
                        ]
                        for selector in name_selectors:
                            name_el = card_container.locator(selector).first
                            if await name_el.count() > 0:
                                name_text = await name_el.text_content()
                                if name_text and len(name_text.strip()) > 1:
                                    # Skip button text
                                    if 'view all' not in name_text.lower() and 'strategic' not in name_text.lower():
                                        company_name = name_text.strip()
                                        break
                    
                    # Strategy 3: If card is the link itself, look for name in nearby elements
                    if not company_name:
                        # Try to find name in siblings or nearby elements
                        try:
                            # Look for a heading or title element near the link
                            nearby_title = card_container.locator('h2, h3, .artdeco-entity-lockup__title').first
                            if await nearby_title.count() > 0:
                                title_text = await nearby_title.text_content()
                                if title_text and len(title_text.strip()) > 1:
                                    company_name = title_text.strip()
                        except:
                            pass
                    
                    # Strategy 4: Extract from URL if we have it
                    if not company_name and company_url:
                        # Try to get name from the page title or from navigating (last resort)
                        # For now, we'll skip this as it's expensive
                        pass
                    
                    # Clean up company name
                    if company_name:
                        company_name = company_name.strip()
                        # Remove extra whitespace
                        company_name = ' '.join(company_name.split())
                        # Skip if it looks like button text
                        if 'view all' in company_name.lower() or len(company_name) < 2:
                            company_name = None
                    
                    # Get industry and employee count from details
                    # Look for specific elements rather than parsing all text
                    industry = None
                    employee_count = None
                    
                    # Strategy 1: Look for industry in specific data attributes or spans
                    industry_selectors = [
                        '[data-anonymize="industry"]',
                        'span[data-anonymize="industry"]',
                        '.artdeco-entity-lockup__subtitle',
                        '.t-14.t-black--light'
                    ]
                    
                    for selector in industry_selectors:
                        industry_el = card_container.locator(selector).first
                        if await industry_el.count() > 0:
                            industry_text = await industry_el.text_content()
                            if industry_text:
                                # Clean up industry text - take first part before bullet
                                industry_text = industry_text.strip()
                                # Split by bullet and take first part
                                if '•' in industry_text:
                                    industry = industry_text.split('•')[0].strip()
                                else:
                                    industry = industry_text
                                # Skip if it looks like button text or employee count
                                if industry and 'view all' not in industry.lower() and 'employee' not in industry.lower() and len(industry) > 1:
                                    break
                    
                    # Strategy 2: If no specific industry element, try parsing subtitle or details
                    if not industry:
                        # Get subtitle text which usually contains industry
                        subtitle = card_container.locator('.artdeco-entity-lockup__subtitle, .t-14').first
                        if await subtitle.count() > 0:
                            subtitle_text = await subtitle.text_content()
                            if subtitle_text:
                                # Parse "Construction • 311 employees on LinkedIn"
                                parts = subtitle_text.split('•')
                                if parts:
                                    industry_candidate = parts[0].strip()
                                    # Make sure it's not employee count
                                    if not re.match(r'^\d+', industry_candidate) and 'employee' not in industry_candidate.lower():
                                        industry = industry_candidate
                    
                    # Extract employee count - try multiple strategies
                    employee_count = None
                    
                    # Strategy 1: Look for employee count in subtitle/metadata area
                    # Try multiple subtitle selectors
                    subtitle_selectors = [
                        '.artdeco-entity-lockup__subtitle',
                        '.t-14.t-black--light',
                        '.t-14',
                        'span.t-14',
                        '.artdeco-entity-lockup__metadata',
                        '[data-anonymize="subtitle"]'
                    ]
                    
                    for subtitle_selector in subtitle_selectors:
                        subtitle = card_container.locator(subtitle_selector).first
                        if await subtitle.count() > 0:
                            subtitle_text = await subtitle.text_content()
                            if subtitle_text and 'employee' in subtitle_text.lower():
                                parsed = self._parse_employee_text(subtitle_text)
                                if parsed:
                                    employee_count = parsed
                                    break
                    
                    # Strategy 2: Look in all text spans and divs within the card
                    if not employee_count:
                        for tag in ('span', 'div'):
                            elements = card_container.locator(tag)
                            el_count = await elements.count()
                            limit = 30 if tag == 'span' else 20
                            for idx in range(min(el_count, limit)):
                                el = elements.nth(idx)
                                el_text = await el.text_content()
                                if el_text and 'employee' in el_text.lower():
                                    parsed = self._parse_employee_text(el_text)
                                    if parsed:
                                        approx = self._employee_display_to_int(parsed)
                                        if 1 <= approx < 10_000_000:
                                            employee_count = parsed
                                            break
                            if employee_count:
                                break
                    
                    # Strategy 3: Look in the full card text if not found
                    if not employee_count:
                        details_text = await card_container.text_content()
                        if details_text and 'employee' in details_text.lower():
                            parsed = self._parse_employee_text(details_text)
                            if parsed:
                                approx = self._employee_display_to_int(parsed)
                                if 1 <= approx < 10_000_000:
                                    employee_count = parsed
                    
                    # Strategy 4: Look for data attributes that might contain employee count
                    if not employee_count:
                        emp_el = card_container.locator('[data-anonymize*="employee"], [data-anonymize*="headcount"], [data-anonymize*="size"]').first
                        if await emp_el.count() > 0:
                            emp_text = await emp_el.text_content()
                            if emp_text:
                                parsed = self._parse_employee_text(emp_text)
                                if parsed:
                                    employee_count = parsed
                                else:
                                    # Fallback: grab the first number as raw count
                                    emp_match = re.search(r'(\d+(?:,\d+)?)', emp_text)
                                    if emp_match:
                                        employee_count = emp_match.group(1)
                    
                    # Debug: Save card HTML if we have company name but no employee count (for testing)
                    if company_name and not employee_count:
                        try:
                            # Save a sample card for debugging employee count extraction
                            debug_card_path = Path(config.DATA_DIR) / "employee_count_debug.html"
                            if not debug_card_path.exists():  # Only save once
                                card_html = await card_container.evaluate('el => el.outerHTML')
                                debug_card_path.write_text(card_html, encoding='utf-8')
                                # Also save the full text for debugging
                                card_text = await card_container.text_content()
                                debug_text_path = Path(config.DATA_DIR) / "employee_count_debug.txt"
                                debug_text_path.write_text(f"Company: {company_name}\n\nFull card text:\n{card_text}", encoding='utf-8')
                                print(f"  [debug] Saved card HTML and text for employee count debugging")
                        except:
                            pass  # Don't fail if debug save fails
                    
                    # Final validation of company name
                    if company_name:
                        # Clean up company name - remove common button/link text
                        company_name = company_name.strip()
                        # Remove extra whitespace
                        company_name = ' '.join(company_name.split())
                        
                        # Skip if it's clearly not a company name
                        skip_patterns = [
                            'view all',
                            'strategic priorities',
                            'see more',
                            'learn more',
                            'follow',
                            'message',
                            'connect'
                        ]
                        
                        if any(pattern in company_name.lower() for pattern in skip_patterns):
                            return None
                        
                        # Skip if too short or looks like a URL fragment
                        if len(company_name) < 2 or company_name.startswith('http') or '/' in company_name:
                            return None
                    
                    if company_name and len(company_name) > 1:
                        company = {
                            'company_name': company_name,
                            'industry': industry,
                            'employee_count': employee_count,
                            'linkedin_url': company_url,
                            'details': None  # Don't store full details to avoid noise
                        }
                        # Print with clear employee count display
                        parts = [f"  ✓ {company_name}"]
                        if industry:
                            parts.append(f"Industry: {industry}")
                        if employee_count:
                            parts.append(f"Employees: {employee_count}")
                        print(" | ".join(parts))
                        return company
                    else:
                        # Silent skip for invalid extractions (reduce noise)
                        return None
                        
                except Exception as e:
                    # Only log errors that are not expected (like element not found)
                    if 'not found' not in str(e).lower() and 'timeout' not in str(e).lower():
                        print(f"  [error] Company {i}: {e}")
                    return None
            
            # Process companies in parallel batches of 2
            batch_size = 2
            seen_urls = set()  # Track seen company URLs to avoid duplicates
            
            for batch_start in range(0, total_to_extract, batch_size):
                batch_end = min(batch_start + batch_size, total_to_extract)
                batch_indices = list(range(batch_start, batch_end))
                
                # Extract companies in this batch in parallel
                batch_results = await asyncio.gather(*[extract_company(i) for i in batch_indices])
                
                # Add non-None results to companies list, filtering duplicates
                for result in batch_results:
                    if result:
                        # Check for duplicates by URL (normalize by removing _ntb for comparison)
                        url = result.get('linkedin_url')
                        if url:
                            # Normalize URL for duplicate checking (remove _ntb and other tracking params)
                            # Keep base URL: /sales/company/162940
                            normalized_url = url.split('?')[0].split('#')[0]
                            
                            if normalized_url not in seen_urls:
                                seen_urls.add(normalized_url)
                                # Keep the full URL with _ntb in the result
                                companies.append(result)
                        else:
                            # If no URL, still add it (shouldn't happen, but be safe)
                            companies.append(result)
            
        except Exception as e:
            print(f"[LinkedIn] Error scraping company results: {e}")
        
        return companies
    
    async def search_companies_with_filters(
        self,
        filters: Dict,
        max_companies: int = 100
    ) -> List[Dict]:
        """
        Full pipeline: Navigate to Account search, apply filters, and scrape results.
        
        Args:
            filters: Filter specifications from SalesNavFilterParser
            max_companies: Maximum number of companies to scrape
            
        Returns:
            List of company dictionaries
        """
        # Step 1: Navigate to Account search
        if not await self.navigate_to_account_search():
            return []
        
        # Step 2: Apply filters
        await self.apply_filters(filters)
        
        # Step 3: Scrape results
        companies = await self.scrape_company_results(max_companies=max_companies)
        
        return companies

    async def extract_public_linkedin_url(self, card, name: str = None) -> Optional[str]:
        """
        Extract public LinkedIn profile URL (/in/username) from a Sales Nav lead card.
        
        Flow:
        1. Click 3-dot menu on card
        2. Ctrl+Click "View Profile" to FORCE open in new tab (keeps search results intact)
        3. Click 3-dot menu on profile page
        4. Click "Copy LinkedIn URL" 
        5. Get URL from clipboard
        6. Close tab and return to search results
        
        Args:
            card: Playwright locator for the lead card
            name: Person's name (for aria-label matching)
            
        Returns:
            Public LinkedIn URL (https://linkedin.com/in/...) or None
        """
        import random
        
        profile_page = None
        
        try:
            # Step 1: Click the 3-dot overflow menu on the card
            overflow_btn = card.locator('button[aria-label*="See more actions"]').or_(
                card.locator('button[aria-label*="More actions"]')
            ).or_(
                card.locator('button[data-search-overflow-trigger]')
            ).or_(
                card.locator('button[aria-haspopup="true"]._circle_ps32ck')
            ).or_(
                # Newer UI: icon span class can be _icon_ps32ck (matches your DOM snippet)
                card.locator('button:has(span._icon_ps32ck)')
            ).or_(
                # Generic fallback: any button with 3-dot svg (very common for overflow menus)
                card.locator('button:has(svg[viewBox="0 0 16 16"])')
            ).first
            
            if await overflow_btn.count() == 0:
                print(f"[LinkedIn] No overflow menu found for {name or 'lead'}")
                return None
            
            await overflow_btn.click()
            await asyncio.sleep(random.uniform(0.5, 1.0))
            
            # Step 2: Find "View Profile" button/link
            # Prefer scoping to the Hue menu container (id looks like hue-menu-ember###).
            menu = self.page.locator('div[id^="hue-menu-"]').last
            view_profile_btn = menu.locator('button:has-text("View profile")').or_(
                menu.locator('a:has-text("View profile")')
            ).or_(
                menu.locator('button:has-text("View Profile")')
            ).or_(
                menu.locator('a:has-text("View Profile")')
            ).or_(
                menu.locator('button:has-text("View on LinkedIn")')
            ).or_(
                menu.locator('a:has-text("View on LinkedIn")')
            ).or_(
                # Fallback (older UI)
                self.page.locator('[data-control-name="view_profile"]')
            ).first
            
            if await view_profile_btn.count() == 0:
                # Some Sales Nav variants don't show "View profile" in the card menu.
                # In those cases, we already have the Sales Nav lead URL on the card.
                # Navigate to that lead page and use its ellipsis menu to "Copy LinkedIn.com URL".
                await self.page.keyboard.press('Escape')
                print(f"[LinkedIn] No 'View Profile' option for {name or 'lead'}; trying lead page flow")

                lead_link = card.locator('a[href*="/sales/lead/"]').first
                sales_nav_url = None
                if await lead_link.count() > 0:
                    sales_nav_url = await lead_link.get_attribute('href')

                public_from_lead = await self._copy_public_url_from_lead_page(
                    sales_nav_url=sales_nav_url,
                    name=name,
                )
                if public_from_lead:
                    return public_from_lead
                return None
            
            # FORCE open in new tab using Ctrl+Click (keeps search results page intact)
            pages_before = len(self.context.pages)
            
            # Use Ctrl+Click to open in new tab
            await view_profile_btn.click(modifiers=['Control'])
            await asyncio.sleep(random.uniform(1.5, 2.5))
            
            # Wait for new tab to appear
            for _ in range(10):
                if len(self.context.pages) > pages_before:
                    break
                await asyncio.sleep(0.3)
            
            # Get the new tab
            if len(self.context.pages) <= pages_before:
                # Ctrl+Click didn't work, try regular click as fallback
                print(f"[LinkedIn] Ctrl+Click didn't open new tab, trying regular click...")
                await view_profile_btn.click()
                await asyncio.sleep(2)
                
                # Check again
                if len(self.context.pages) > pages_before:
                    profile_page = self.context.pages[-1]
                else:
                    # Navigate happened on same page - this breaks things
                    print(f"[LinkedIn] Profile opened in same tab - going back")
                    await self.page.go_back()
                    await asyncio.sleep(1)
                    return None
            else:
                profile_page = self.context.pages[-1]
            
            # Wait for profile page to load
            await profile_page.wait_for_load_state('domcontentloaded', timeout=15000)
            await asyncio.sleep(random.uniform(1, 2))
            
            # Step 3: On profile page, find the overflow menu
            profile_overflow = profile_page.locator('button[data-x--lead-actions-bar-overflow-menu]').or_(
                profile_page.locator('button._overflow-menu--trigger_1xow7n')
            ).or_(
                profile_page.locator('button[aria-label="Open actions overflow menu"]')
            ).or_(
                profile_page.locator('button:has(span._icon_ps32ck)')
            ).or_(
                profile_page.locator('button:has(svg[viewBox="0 0 16 16"])')
            ).first
            
            if await profile_overflow.count() == 0:
                print(f"[LinkedIn] No overflow menu on profile page for {name or 'lead'}")
                await profile_page.close()
                return None
            
            await profile_overflow.click()
            await asyncio.sleep(random.uniform(0.5, 1.0))
            
            # Step 4: Click "Copy LinkedIn.com URL" / "Copy LinkedIn URL"
            profile_menu = profile_page.locator('div[id^="hue-menu-"]').last
            copy_url_btn = profile_menu.locator('button:has-text("Copy LinkedIn.com URL")').or_(
                profile_menu.locator('button:has-text("Copy LinkedIn URL")')
            ).or_(
                profile_menu.locator('button:has-text("Copy LinkedIn")')
            ).or_(
                profile_menu.locator('[data-control-name="copy_linkedin_url"]')
            ).or_(
                # Some builds render menu items as divs/spans instead of buttons
                profile_menu.locator(':is(div,span):has-text("Copy LinkedIn.com URL")')
            ).or_(
                profile_menu.locator(':is(div,span):has-text("Copy LinkedIn URL")')
            ).or_(
                profile_menu.locator(':is(div,span):has-text("Copy LinkedIn")')
            ).first
            
            if await copy_url_btn.count() == 0:
                print(f"[LinkedIn] No 'Copy LinkedIn URL' option for {name or 'lead'}")
                await profile_page.keyboard.press('Escape')
                # Fallback: sometimes the profile page contains an actual public /in/ link.
                try:
                    public_link = profile_page.locator('a[href*="linkedin.com/in/"]').first
                    if await public_link.count() > 0:
                        href = await public_link.get_attribute('href')
                        if href and 'linkedin.com/in/' in href:
                            await profile_page.close()
                            return href.strip()
                except Exception:
                    pass
                await profile_page.close()
                return None
            
            # Grant clipboard permissions and click
            await self.context.grant_permissions(['clipboard-read', 'clipboard-write'])
            try:
                await copy_url_btn.click()
            except Exception:
                # If it's a non-button node, click via JS
                await copy_url_btn.evaluate("(el) => el.click()")
            await asyncio.sleep(random.uniform(0.3, 0.6))
            
            # Step 5: Read from clipboard
            linkedin_url = await profile_page.evaluate('navigator.clipboard.readText()')
            
            # Step 6: Close the profile tab (return to search results)
            await profile_page.close()
            profile_page = None
            
            # Small delay to let main page stabilize
            await asyncio.sleep(0.5)
            
            # Validate it's a LinkedIn URL
            if linkedin_url and 'linkedin.com/in/' in linkedin_url:
                return linkedin_url.strip()

            # Fallback: try to find any public profile link on the page.
            try:
                public_link = profile_page.locator('a[href*="linkedin.com/in/"]').first
                if await public_link.count() > 0:
                    href = await public_link.get_attribute('href')
                    if href and 'linkedin.com/in/' in href:
                        return href.strip()
            except Exception:
                pass
            
            return None
            
        except Exception as e:
            print(f"[LinkedIn] Error extracting public URL for {name or 'lead'}: {e}")
            # Clean up - close profile tab if it's open
            try:
                if profile_page and profile_page != self.page:
                    await profile_page.close()
            except:
                pass
            try:
                await self.page.keyboard.press('Escape')
            except:
                pass
            return None

    def _abs_salesnav_url(self, url: Optional[str]) -> Optional[str]:
        if not url:
            return None
        u = (url or "").strip()
        if not u:
            return None
        if u.startswith("http://") or u.startswith("https://"):
            return u
        if u.startswith("/"):
            return f"https://www.linkedin.com{u}"
        return u

    def _extract_public_url_from_html(self, html: str) -> Optional[str]:
        """Extract a canonical public profile URL from lead page HTML."""
        if not html:
            return None

        patterns = [
            r'https?://(?:[a-z]{2,3}\.)?linkedin\.com/in/[A-Za-z0-9%._\-]+/?',
            r'"publicProfileUrl"\s*:\s*"https:\\/\\/www\.linkedin\.com\\/in\\/[A-Za-z0-9%._\-]+\\/?',
        ]
        for pattern in patterns:
            match = re.search(pattern, html)
            if not match:
                continue

            url = match.group(0)
            if '"publicProfileUrl"' in url:
                try:
                    url = url.split(":", 1)[1].strip().strip('"')
                except Exception:
                    continue
                url = url.replace("\\/", "/")

            # Trim trailing punctuation from serialized contexts.
            url = url.strip().rstrip('",}')
            if "linkedin.com/in/" in url:
                return url
        return None

    async def _copy_public_url_from_lead_page(
        self, sales_nav_url: Optional[str], name: str = None
    ) -> Optional[str]:
        """
        Given a Sales Navigator lead URL, navigate in the SAME TAB and use the lead-page
        ellipsis menu to click "Copy LinkedIn.com URL".
        """
        import random

        abs_url = self._abs_salesnav_url(sales_nav_url)
        if not abs_url:
            print(f"[LinkedIn] No sales lead URL available for {name or 'lead'}")
            return None

        original_url = None
        try:
            original_url = self.page.url
            print(f"[LinkedIn] Opening lead page in same tab for {name or 'lead'}")
            await self.page.goto(abs_url, timeout=30000)
            await self.page.wait_for_load_state("domcontentloaded", timeout=15000)
            try:
                await self.page.wait_for_load_state("networkidle", timeout=8000)
            except Exception:
                pass
            await asyncio.sleep(random.uniform(1.0, 2.0))

            # Fast path: many lead pages embed the public /in/ URL in HTML payload.
            try:
                html = await self.page.content()
                embedded_url = self._extract_public_url_from_html(html)
                if embedded_url:
                    print(f"[LinkedIn] Found embedded public URL for {name or 'lead'}")
                    return embedded_url
            except Exception:
                pass

            # Open the exact lead actions overflow menu button.
            overflow = self.page.locator(
                'button[data-x--lead-actions-bar-overflow-menu]'
                '[aria-label="Open actions overflow menu"]'
                '._overflow-menu--trigger_1xow7n'
            ).or_(
                self.page.locator(
                    'button[id^="hue-menu-trigger-"]'
                    '[aria-label="Open actions overflow menu"]'
                    '[aria-haspopup="true"]'
                )
            ).or_(
                self.page.locator(
                    'button[data-x--lead-actions-bar-overflow-menu]'
                    '[aria-label="Open actions overflow menu"]'
                )
            ).or_(
                self.page.locator(
                    'button._overflow-menu--trigger_1xow7n'
                    '[aria-label="Open actions overflow menu"]'
                )
            )

            menu_opened = False
            overflow_count = await overflow.count()
            if overflow_count > 0:
                try:
                    for idx in range(min(overflow_count, 8)):
                        btn = overflow.nth(idx)
                        if not await btn.is_visible():
                            continue
                        await btn.scroll_into_view_if_needed()
                        try:
                            await btn.click(timeout=2000)
                        except Exception:
                            await btn.click(force=True, timeout=2000)
                        await self.page.wait_for_selector(
                            'div[id^="hue-menu-"], div._container_x5gf48',
                            timeout=1200
                        )
                        menu_opened = True
                        print(f"[LinkedIn] Opened lead actions menu via exact selector #{idx}")
                        break
                except Exception:
                    menu_opened = False

            if not menu_opened:
                # DOM fallback: only click the exact lead action menu button signatures.
                try:
                    clicked = await self.page.evaluate("""
                        () => {
                          const isVisible = (el) => {
                            if (!el) return false;
                            const r = el.getBoundingClientRect();
                            const s = window.getComputedStyle(el);
                            return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
                          };

                          const selectors = [
                            'button[data-x--lead-actions-bar-overflow-menu][aria-label="Open actions overflow menu"]._overflow-menu--trigger_1xow7n',
                            'button[id^="hue-menu-trigger-"][aria-label="Open actions overflow menu"][aria-haspopup="true"]',
                            'button[data-x--lead-actions-bar-overflow-menu][aria-label="Open actions overflow menu"]',
                            'button._overflow-menu--trigger_1xow7n[aria-label="Open actions overflow menu"]'
                          ];

                          for (const sel of selectors) {
                            const targets = Array.from(document.querySelectorAll(sel));
                            for (const target of targets) {
                              if (!isVisible(target)) continue;
                              target.click();
                              return true;
                            }
                          }
                          return false;
                        }
                    """)
                    if clicked:
                        await self.page.wait_for_selector(
                            'div[id^="hue-menu-"], div._container_x5gf48',
                            timeout=3500
                        )
                        menu_opened = True
                except Exception:
                    menu_opened = False

            if not menu_opened:
                # SVG-path fallback: target the exact three-dot icon and click a clickable ancestor.
                try:
                    ellipsis_path_selector = (
                        'svg path[d="M3 9.5A1.5 1.5 0 114.5 8 1.5 1.5 0 013 9.5z'
                        'M11.5 8A1.5 1.5 0 1013 6.5 1.5 1.5 0 0011.5 8z'
                        'm-5 0A1.5 1.5 0 108 6.5 1.5 1.5 0 006.5 8z"]'
                    )
                    dots = self.page.locator(ellipsis_path_selector)
                    dots_count = await dots.count()
                    for idx in range(min(dots_count, 12)):
                        dot = dots.nth(idx)
                        try:
                            clicked = await dot.evaluate("""
                                (el) => {
                                  const isVisible = (node) => {
                                    if (!node) return false;
                                    const r = node.getBoundingClientRect();
                                    const s = window.getComputedStyle(node);
                                    return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden';
                                  };
                                  let cur = el;
                                  for (let i = 0; i < 10 && cur; i++) {
                                    if (cur.matches?.('button,[role="button"],a,div[role="button"]') && isVisible(cur)) {
                                      cur.click();
                                      return true;
                                    }
                                    cur = cur.parentElement;
                                  }
                                  if (isVisible(el)) {
                                    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
                                    return true;
                                  }
                                  return false;
                                }
                            """)
                            if not clicked:
                                continue
                            await self.page.wait_for_selector(
                                'div[id^="hue-menu-"], div._container_x5gf48',
                                timeout=1200
                            )
                            menu_opened = True
                            print(f"[LinkedIn] Opened ellipsis menu via SVG fallback #{idx}")
                            break
                        except Exception:
                            try:
                                await self.page.keyboard.press("Escape")
                            except Exception:
                                pass
                            continue
                except Exception:
                    menu_opened = False

            if not menu_opened:
                # Brute-force fallback: iterate all visible ellipsis-like controls on the lead page
                # and click them one-by-one until the Hue menu appears.
                try:
                    candidates = self.page.locator(
                        'button:has(span._icon_ps32ck), '
                        '[role="button"]:has(span._icon_ps32ck), '
                        'button:has(svg[viewBox="0 0 16 16"]), '
                        '[role="button"]:has(svg[viewBox="0 0 16 16"])'
                    )
                    candidate_count = await candidates.count()
                    for idx in range(min(candidate_count, 24)):
                        candidate = candidates.nth(idx)
                        try:
                            if not await candidate.is_visible():
                                continue
                            await candidate.scroll_into_view_if_needed()
                            await candidate.click(force=True, timeout=2000)
                            await self.page.wait_for_selector(
                                'div[id^="hue-menu-"], div._container_x5gf48',
                                timeout=1200
                            )
                            menu_opened = True
                            print(f"[LinkedIn] Opened ellipsis menu via fallback candidate #{idx}")
                            break
                        except Exception:
                            # Close any partial popovers and keep trying.
                            try:
                                await self.page.keyboard.press("Escape")
                            except Exception:
                                pass
                            continue
                except Exception:
                    menu_opened = False

            if not menu_opened:
                print(f"[LinkedIn] Ellipsis menu did not open on lead page for {name or 'lead'}")
                return None

            menu = self.page.locator('div[id^="hue-menu-"]').or_(
                self.page.locator('div._container_x5gf48')
            ).last
            copy_btn = menu.locator('button:has-text("Copy LinkedIn.com URL")').or_(
                menu.locator('button:has-text("Copy LinkedIn URL")')
            ).or_(
                menu.locator('[data-control-name="copy_linkedin_url"]')
            ).or_(
                menu.locator('[role="menuitem"]:has-text("Copy LinkedIn.com URL")')
            ).or_(
                menu.locator('[role="menuitem"]:has-text("Copy LinkedIn URL")')
            ).or_(
                menu.locator(':is(div,span):has-text("Copy LinkedIn.com URL")')
            ).or_(
                menu.locator(':is(div,span):has-text("Copy LinkedIn URL")')
            ).first

            if await copy_btn.count() == 0:
                print(f"[LinkedIn] No 'Copy LinkedIn.com URL' option on lead page for {name or 'lead'}")
                return None

            await self.context.grant_permissions(['clipboard-read', 'clipboard-write'])
            try:
                await copy_btn.click()
            except Exception:
                await copy_btn.evaluate("(el) => el.click()")
            await asyncio.sleep(random.uniform(0.3, 0.6))

            copied = await self.page.evaluate("navigator.clipboard.readText()")
            if copied and "linkedin.com/in/" in copied:
                print(f"[LinkedIn] Copied public URL for {name or 'lead'}")
                return copied.strip()

            # Fallback: find any public /in/ link on the lead page.
            public_link = self.page.locator('a[href*="linkedin.com/in/"]').first
            if await public_link.count() > 0:
                href = await public_link.get_attribute("href")
                if href and "linkedin.com/in/" in href:
                    print(f"[LinkedIn] Found public /in/ link on lead page for {name or 'lead'}")
                    return href.strip()

            return None
        except Exception as e:
            print(f"[LinkedIn] Lead page copy URL error for {name or 'lead'}: {e}")
            return None
        finally:
            try:
                # Return to the original results page in the same tab.
                if original_url and self.page.url != original_url:
                    await self.page.goto(original_url, timeout=30000)
                    await self.page.wait_for_load_state("domcontentloaded", timeout=15000)
                    await asyncio.sleep(0.5)
            except Exception:
                pass
    
    async def scrape_current_results_with_public_urls(
        self, 
        max_employees: int = 50,
        extract_public_urls: bool = True
    ) -> List[Dict]:
        """
        Scrape employee results and extract public LinkedIn URLs.
        
        Uses TWO-PASS approach to avoid page state issues:
        1. First pass: Collect all basic info (fast, no navigation)
        2. Second pass: Extract public URLs one-by-one (if enabled)
        
        Args:
            max_employees: Maximum employees to scrape
            extract_public_urls: Whether to extract public /in/ URLs (slower but valuable)
            
        Returns:
            List of employee dicts with public linkedin_url where possible
        """
        import random
        
        employees = []
        
        try:
            await self.page.wait_for_load_state('domcontentloaded', timeout=15000)
            await asyncio.sleep(random.uniform(3, 5))
            
            # Scroll to load results
            print(f"[LinkedIn] Loading results...")
            last_count = 0
            for scroll_attempt in range(15):
                await self.page.evaluate("""
                    const container = document.querySelector('#search-results-container');
                    if (container) container.scrollTop += 800;
                """)
                await asyncio.sleep(random.uniform(1.5, 2.5))
                
                cards = self.page.locator('[data-x-search-result="LEAD"]')
                current_count = await cards.count()
                
                if current_count >= max_employees or current_count == last_count:
                    break
                last_count = current_count
            
            # ============ PASS 1: Collect all basic info (fast) ============
            cards = self.page.locator('[data-x-search-result="LEAD"]')
            count = await cards.count()
            print(f"[LinkedIn] Found {count} leads, collecting info...")
            
            for i in range(min(count, max_employees)):
                try:
                    card = cards.nth(i)
                    
                    # Extract basic info
                    name = None
                    name_el = card.locator('[data-anonymize="person-name"]').first
                    if await name_el.count() > 0:
                        name = (await name_el.text_content() or '').strip()
                    
                    title = None
                    title_el = card.locator('[data-anonymize="title"]').first
                    if await title_el.count() > 0:
                        title = (await title_el.text_content() or '').strip()
                    
                    # Get Sales Nav lead URL
                    sales_nav_url = None
                    link = card.locator('a[href*="/sales/lead/"]').first
                    if await link.count() > 0:
                        sales_nav_url = await link.get_attribute('href')
                    
                    if not name or len(name) < 2:
                        continue
                    
                    employee = {
                        'name': name,
                        'title': title,
                        'linkedin_url': sales_nav_url,  # Will be updated in pass 2
                        'sales_nav_url': sales_nav_url,
                        'has_public_url': False,
                        'card_index': i  # Remember position for pass 2
                    }
                    employees.append(employee)
                    # Avoid unicode bullets that can break Windows consoles (cp1252).
                    print(f"  - {name}: {title or 'N/A'}")
                    
                except Exception as e:
                    print(f"  [error] Card {i}: {e}")
                    continue
            
            print(f"[LinkedIn] Collected {len(employees)} leads")
            
            # ============ PASS 2: Extract public URLs (if enabled) ============
            if extract_public_urls and employees:
                print(f"[LinkedIn] Extracting public URLs...")
                
                # Scroll back to top
                await self.page.evaluate("""
                    const container = document.querySelector('#search-results-container');
                    if (container) container.scrollTop = 0;
                """)
                await asyncio.sleep(1)
                
                for emp in employees:
                    try:
                        card_index = emp.get('card_index', 0)
                        
                        # Re-locate the card (page state may have changed)
                        cards = self.page.locator('[data-x-search-result="LEAD"]')
                        if await cards.count() <= card_index:
                            continue
                        
                        card = cards.nth(card_index)
                        
                        # Scroll card into view
                        await card.scroll_into_view_if_needed()
                        await asyncio.sleep(random.uniform(0.5, 1))
                        
                        # Extract public URL
                        public_url = await self.extract_public_linkedin_url(card, emp['name'])
                        
                        if public_url:
                            emp['linkedin_url'] = public_url
                            emp['has_public_url'] = True
                            print(f"  ✓ {emp['name']}: {public_url}")
                        
                        await asyncio.sleep(random.uniform(1, 2))  # Be gentle
                        
                    except Exception as e:
                        print(f"  [error] URL extraction for {emp.get('name', '?')}: {e}")
                        continue
                
                # Clean up temp field
                for emp in employees:
                    emp.pop('card_index', None)
                    
        except Exception as e:
            print(f"[LinkedIn] Error scraping with public URLs: {e}")
        
        return employees


async def enrich_leads_with_public_urls(
    leads: List[Dict],
    company_name: str,
    use_tavily_fallback: bool = False
) -> List[Dict]:
    """
    Enrich a list of leads with public LinkedIn URLs.
    
    Tiered approach (cheapest first):
    1. Already has /in/ URL → skip
    2. Generate URL from name pattern → verify with HEAD request
    3. Tavily search (only if use_tavily_fallback=True, costs $0.007/search)
    
    Args:
        leads: List of lead dicts with 'name', 'title', optional 'linkedin_url'
        company_name: Company name for search context
        use_tavily_fallback: If True, use Tavily for leads that fail URL generation
        
    Returns:
        List of leads enriched with 'linkedin_url' where possible
    """
    import requests
    import re
    
    enriched = []
    tavily_queue = []  # Leads that need Tavily fallback
    
    for lead in leads:
        name = lead.get('name', '')
        existing_url = lead.get('linkedin_url', '')
        
        # Skip if already has public URL
        if existing_url and '/in/' in existing_url:
            enriched.append(lead)
            continue
        
        # Try URL generation + verification
        public_url = await _try_url_generation(name)
        
        if public_url:
            lead['linkedin_url'] = public_url
            lead['has_public_url'] = True
            enriched.append(lead)
            print(f"  ✓ {name}: {public_url} (generated)")
        elif use_tavily_fallback:
            tavily_queue.append(lead)
        else:
            enriched.append(lead)
            print(f"  ○ {name}: no public URL found")
    
    # Process Tavily queue (last resort, costs money)
    if tavily_queue and use_tavily_fallback:
        print(f"\n[LinkedIn] Using Tavily for {len(tavily_queue)} remaining leads...")
        for lead in tavily_queue:
            name = lead.get('name', '')
            url = await _tavily_search_profile(name, company_name)
            if url:
                lead['linkedin_url'] = url
                lead['has_public_url'] = True
                print(f"  ✓ {name}: {url} (Tavily)")
            else:
                print(f"  ✗ {name}: Tavily search failed")
            enriched.append(lead)
            await asyncio.sleep(0.5)  # Rate limit Tavily
    
    return enriched


async def _try_url_generation(name: str) -> Optional[str]:
    """
    Generate likely LinkedIn URL patterns and verify with HEAD request.
    Cost: ~0 (just HTTP requests to LinkedIn)
    """
    import requests
    
    if not name or len(name.split()) < 2:
        return None
    
    parts = name.lower().split()
    first = re.sub(r'[^a-z]', '', parts[0])
    last = re.sub(r'[^a-z]', '', parts[-1])
    
    if not first or not last:
        return None
    
    # Generate candidate URLs (most common patterns)
    candidates = [
        f"https://www.linkedin.com/in/{first}-{last}",
        f"https://www.linkedin.com/in/{first}{last}",
        f"https://www.linkedin.com/in/{last}-{first}",
        f"https://www.linkedin.com/in/{first[0]}{last}",
        f"https://www.linkedin.com/in/{first}-{last}-1",
    ]
    
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
    }
    
    for url in candidates:
        try:
            # Use HEAD request first (faster)
            resp = requests.head(url, headers=headers, timeout=5, allow_redirects=True)
            if resp.status_code == 200:
                # Verify with GET to check name appears
                resp = requests.get(url, headers=headers, timeout=5)
                if resp.status_code == 200 and first in resp.text.lower():
                    return url
        except:
            continue
        # Small delay between attempts (run sync sleep in executor to not block)
        await asyncio.sleep(0.2)
    
    return None


async def _tavily_search_profile(name: str, company: str) -> Optional[str]:
    """
    Last resort: Use Tavily to search for LinkedIn profile.
    Cost: ~$0.007 per search
    """
    import re

    from services.web_search import tavily_search

    try:
        query = f"{name} {company} LinkedIn profile site:linkedin.com/in/"

        data = await tavily_search(
            query=query,
            search_depth="basic",
            include_answer=False,
            max_results=3,
        )
        if data.get("error"):
            print(f"  [Tavily error] {data['error']}")
            return None

        results = data.get("results", [])
        
        # Find first LinkedIn /in/ URL
        for result in results:
            url = result.get('url', '')
            if 'linkedin.com/in/' in url:
                match = re.search(r'(https://[a-z.]*linkedin\.com/in/[a-zA-Z0-9_-]+)', url)
                if match:
                    return match.group(1)
        
        return None
        
    except Exception as e:
        print(f"  [Tavily error] {e}")
        return None


async def scrape_linkedin_for_domain(domain: str, company_name: str = None) -> Dict:
    """
    Convenience function to scrape LinkedIn for a single domain.
    """
    scraper = SalesNavigatorScraper()
    
    try:
        await scraper.start(headless=False)
        
        if not scraper.is_authenticated:
            if not await scraper.wait_for_login():
                return {'error': 'Login timeout', 'employees': []}
        
        result = await scraper.scrape_company_contacts(
            company_name or domain.split('.')[0],
            domain
        )
        return result
        
    finally:
        await scraper.stop()

