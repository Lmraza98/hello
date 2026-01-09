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
import database as db


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
        """Start browser with persistent LinkedIn session."""
        self.playwright = await async_playwright().start()
        
        self.browser = await self.playwright.chromium.launch(
            headless=headless,
            slow_mo=100
        )
        
        # Load existing session if available
        if LINKEDIN_STORAGE_STATE.exists():
            print("[LinkedIn] Loading existing session")
            self.context = await self.browser.new_context(
                storage_state=str(LINKEDIN_STORAGE_STATE),
                viewport={'width': 1920, 'height': 1080}
            )
        else:
            print("[LinkedIn] Creating new session")
            self.context = await self.browser.new_context(
                viewport={'width': 1920, 'height': 1080}
            )
        
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
    
    async def search_company(self, company_name: str) -> Optional[str]:
        """
        Search for a company in Sales Navigator and return its profile URL.
        """
        print(f"[LinkedIn] Searching for company: {company_name}")
        
        try:
            # Go to Sales Navigator home first
            if '/sales/' not in self.page.url:
                await self.page.goto("https://www.linkedin.com/sales/home", timeout=30000)
                await asyncio.sleep(3)
            
            # Use the search bar
            print(f"[LinkedIn] Using search bar...")
            
            search_input = self.page.locator('input[placeholder*="Search"]').first
            
            try:
                await search_input.wait_for(state='visible', timeout=10000)
                await search_input.click()
                await asyncio.sleep(1)
                await search_input.fill(company_name)
                await asyncio.sleep(2)
                await search_input.press('Enter')
                await asyncio.sleep(5)
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
                    await asyncio.sleep(4)
            except Exception:
                pass
            
            # Click on the first company result to go to its profile
            print(f"[LinkedIn] Looking for company in results...")
            
            company_link = self.page.locator('a[href*="/sales/company/"]').first
            
            if await company_link.count() > 0:
                await company_link.click()
                await asyncio.sleep(4)
                
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
        print(f"[LinkedIn] Looking for Decision Makers link...")
        
        try:
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
                await asyncio.sleep(5)
                print(f"[LinkedIn] Now on: {self.page.url}")
                return True
            
            # Try scrolling down to find it
            await self.page.evaluate("window.scrollTo(0, 500)")
            await asyncio.sleep(2)
            
            if await dm_link.count() > 0:
                await dm_link.click()
                await asyncio.sleep(5)
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
        max_contacts: int = 10
    ) -> Dict:
        """
        Full pipeline: 
        1. Search for company
        2. Go to company profile
        3. Click "Decision Makers" 
        4. Scrape the results
        """
        result = {
            'company_name': company_name,
            'domain': domain,
            'employees': [],
            'status': 'pending'
        }
        
        # Step 1: Search for company and go to profile
        company_url = await self.search_company(company_name)
        
        if not company_url:
            # Try with domain name
            domain_name = domain.split('.')[0]
            company_url = await self.search_company(domain_name)
        
        if not company_url:
            result['status'] = 'company_not_found'
            return result
        
        # Step 2: Click "Decision Makers" on the company profile
        if await self.click_decision_makers():
            # Step 3: Scrape the decision makers (get extra, will dedupe later)
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


# Database functions for storing LinkedIn data

def save_linkedin_contacts(company_name: str, employees: List[Dict], domain: str = None):
    """
    Save scraped LinkedIn contacts to database.
    
    Args:
        company_name: Company name (primary identifier)
        employees: List of employee dicts with name, title, linkedin_url
        domain: Optional domain for backwards compatibility
    """
    import re
    
    # If no domain, create a slug from company name (required for legacy DB schema)
    if not domain and company_name:
        domain = re.sub(r'[^\w\s-]', '', company_name.lower())
        domain = re.sub(r'[\s_]+', '-', domain).strip('-')
    
    with db.get_db() as conn:
        cursor = conn.cursor()
        
        for emp in employees:
            cursor.execute("""
                INSERT OR REPLACE INTO linkedin_contacts 
                (company_name, domain, name, title, linkedin_url, scraped_at)
                VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            """, (company_name, domain, emp['name'], emp['title'], emp.get('linkedin_url')))


def get_linkedin_contacts(company_name: str = None, domain: str = None) -> List[Dict]:
    """
    Get stored LinkedIn contacts by company name or domain.
    
    Args:
        company_name: Company name to search (preferred)
        domain: Domain to search (legacy support)
    """
    with db.get_db() as conn:
        cursor = conn.cursor()
        if company_name:
            cursor.execute("""
                SELECT name, title, linkedin_url, company_name, domain 
                FROM linkedin_contacts
                WHERE company_name = ?
                ORDER BY scraped_at DESC
            """, (company_name,))
        elif domain:
            cursor.execute("""
                SELECT name, title, linkedin_url, company_name, domain 
                FROM linkedin_contacts
                WHERE domain = ?
                ORDER BY scraped_at DESC
            """, (domain,))
        else:
            return []
        return [dict(row) for row in cursor.fetchall()]


# Add table for LinkedIn contacts
def init_linkedin_table():
    """Initialize LinkedIn contacts table."""
    import sqlite3
    
    with db.get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS linkedin_contacts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                domain TEXT,
                company_name TEXT,
                name TEXT NOT NULL,
                title TEXT,
                linkedin_url TEXT,
                email_generated TEXT,
                email_confidence INTEGER DEFAULT 0,
                email_verified INTEGER DEFAULT 0,
                scraped_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(domain, name)
            )
        """)
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_linkedin_domain ON linkedin_contacts(domain)")
        
        # Migration: Add columns if they don't exist (for existing databases)
        for col, col_type in [('company_name', 'TEXT'), ('email_confidence', 'INTEGER DEFAULT 0')]:
            try:
                cursor.execute(f"ALTER TABLE linkedin_contacts ADD COLUMN {col} {col_type}")
            except sqlite3.OperationalError:
                pass  # Column already exists
        
        # Create company index after migration
        try:
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_linkedin_company ON linkedin_contacts(company_name)")
        except sqlite3.OperationalError:
            pass


# Initialize table on import
init_linkedin_table()

