"""
LinkedIn Profile URL Finder (Regular LinkedIn, not Sales Nav).
"""
import asyncio
import re
from typing import Optional
from playwright.async_api import async_playwright
from urllib.parse import quote

import config


class LinkedInProfileFinder:
    """
    Find actual LinkedIn profile URLs (/in/username) on regular LinkedIn.
    This is separate from Sales Navigator and uses different rate limits.
    """
    
    def __init__(self):
        self.playwright = None
        self.browser = None
        self.context = None
        self.page = None
        self.is_authenticated = False
    
    async def start(self, headless: bool = False):
        """Start browser for regular LinkedIn."""
        self.playwright = await async_playwright().start()
        
        self.browser = await self.playwright.chromium.launch(
            headless=headless,
            slow_mo=50
        )
        
        # Use separate session file for regular LinkedIn
        regular_linkedin_session = config.DATA_DIR / "linkedin_regular_auth.json"
        
        if regular_linkedin_session.exists():
            print("[LinkedIn Profile Finder] Loading existing session")
            self.context = await self.browser.new_context(
                storage_state=str(regular_linkedin_session),
                viewport={'width': 1200, 'height': 800}
            )
        else:
            print("[LinkedIn Profile Finder] Creating new session")
            self.context = await self.browser.new_context(
                viewport={'width': 1200, 'height': 800}
            )
        
        self.page = await self.context.new_page()
        await self._check_auth()
    
    async def stop(self):
        """Stop browser and save session."""
        try:
            if self.context and self.is_authenticated:
                regular_linkedin_session = config.DATA_DIR / "linkedin_regular_auth.json"
                try:
                    await self.context.storage_state(path=str(regular_linkedin_session))
                except:
                    pass
            if self.context:
                await self.context.close()
            if self.browser:
                await self.browser.close()
            if self.playwright:
                await self.playwright.stop()
        except:
            pass
    
    async def _check_auth(self) -> bool:
        """Check if logged into regular LinkedIn."""
        try:
            await self.page.goto("https://www.linkedin.com/feed/", timeout=30000)
            await self.page.wait_for_load_state('domcontentloaded', timeout=15000)
            await asyncio.sleep(2)
            
            url = self.page.url
            
            if 'login' in url or 'checkpoint' in url or 'authwall' in url:
                self.is_authenticated = False
                return False
            
            if '/feed' in url or '/in/' in url:
                self.is_authenticated = True
                return True
            
            self.is_authenticated = False
            return False
            
        except Exception as e:
            print(f"[LinkedIn Profile Finder] Auth check error: {e}")
            self.is_authenticated = False
            return False
    
    async def wait_for_login(self, timeout_minutes: int = 5) -> bool:
        """Wait for user to log in to regular LinkedIn."""
        print(f"\n{'='*60}")
        print(f"  REGULAR LINKEDIN LOGIN REQUIRED")
        print(f"  (This is separate from Sales Navigator)")
        print(f"  ")
        print(f"  1. Log in to LinkedIn in the browser window")
        print(f"  2. You should see your feed")
        print(f"  ")
        print(f"  You have {timeout_minutes} minutes.")
        print(f"{'='*60}\n")
        
        await self.page.goto("https://www.linkedin.com/login", timeout=30000)
        
        start = asyncio.get_event_loop().time()
        timeout = timeout_minutes * 60
        
        while (asyncio.get_event_loop().time() - start) < timeout:
            await asyncio.sleep(5)
            
            try:
                url = self.page.url
                if '/feed' in url or '/in/' in url:
                    print("\n[LinkedIn Profile Finder] Login successful!")
                    self.is_authenticated = True
                    regular_linkedin_session = config.DATA_DIR / "linkedin_regular_auth.json"
                    await self.context.storage_state(path=str(regular_linkedin_session))
                    return True
            except:
                pass
        
        print("[LinkedIn Profile Finder] Login timeout")
        return False
    
    async def find_profile_url(self, name: str, company: str) -> Optional[str]:
        """
        Search for LinkedIn profile URL using PARALLEL browser + LLM search.
        
        Args:
            name: Person's full name
            company: Company name (helps narrow search)
            
        Returns:
            LinkedIn profile URL (/in/username) or None
        """
        import random
        from concurrent.futures import ThreadPoolExecutor
        
        print(f"[Profile Finder] Searching: {name} @ {company}")
        
        # Start LLM search in parallel (runs in background thread)
        llm_future = None
        llm_executor = ThreadPoolExecutor(max_workers=1)
        
        # Use the sync version directly - no need for event loop
        llm_future = llm_executor.submit(self._find_profile_with_llm_sync, name, company)
        print(f"[Profile Finder] LLM search started in background...")
        
        try:
            # Browser search (main thread)
            browser_result = await self._browser_search_profile(name, company)
            
            if browser_result:
                # Browser found it! Cancel/ignore LLM result
                llm_executor.shutdown(wait=False)
                return browser_result
            
            # Browser didn't find it, wait for LLM result
            print(f"[Profile Finder] Browser search failed, waiting for LLM result...")
            try:
                llm_result = llm_future.result(timeout=30)
                if llm_result:
                    return llm_result
            except Exception as e:
                print(f"[Profile Finder] LLM search error: {e}")
            
            return None
            
        except Exception as e:
            print(f"[Profile Finder] Error: {e}")
            # Try to get LLM result as backup
            try:
                llm_result = llm_future.result(timeout=15)
                if llm_result:
                    return llm_result
            except:
                pass
            return None
        finally:
            llm_executor.shutdown(wait=False)
    
    async def _browser_search_profile(self, name: str, company: str) -> Optional[str]:
        """Browser-based LinkedIn search."""
        import random
        
        try:
            search_query = f"{name} {company}"
            encoded_query = quote(search_query)
            search_url = f"https://www.linkedin.com/search/results/people/?keywords={encoded_query}"
            
            await self.page.goto(search_url, timeout=30000)
            await self.page.wait_for_load_state('domcontentloaded', timeout=15000)
            await asyncio.sleep(random.uniform(2, 4))
            
            profile_links = self.page.locator('a[href*="/in/"]')
            count = await profile_links.count()
            
            if count == 0:
                print(f"[Profile Finder] Browser: No results")
                return None
            
            # Try to verify each result
            for i in range(min(count, 3)):
                try:
                    link = profile_links.nth(i)
                    href = await link.get_attribute('href')
                    
                    if href and '/in/' in href:
                        verified_url = await self._verify_profile(link, name, company)
                        if verified_url:
                            return verified_url
                except Exception as e:
                    continue
            
            print(f"[Profile Finder] Browser: Could not verify any profile")
            return None
            
        except Exception as e:
            print(f"[Profile Finder] Browser error: {e}")
            return None
    
    async def _verify_profile(self, link_element, name: str, company: str) -> Optional[str]:
        """
        Click on a profile link to verify it's the correct person.
        Returns the verified profile URL or None.
        """
        import random
        
        try:
            # Get the href before clicking
            href = await link_element.get_attribute('href')
            if not href or '/in/' not in href:
                return None
            
            # Click on the profile
            await link_element.click()
            await self.page.wait_for_load_state('domcontentloaded', timeout=15000)
            await asyncio.sleep(random.uniform(1.5, 2.5))
            
            # Get the current URL (should be the profile page)
            current_url = self.page.url
            
            # Check if we're on a profile page
            if '/in/' not in current_url:
                print(f"[Profile Finder] Did not land on profile page: {current_url}")
                await self.page.go_back()
                await asyncio.sleep(1)
                return None
            
            # Extract the clean profile URL
            match = re.search(r'(https://www\.linkedin\.com/in/[a-zA-Z0-9_-]+)', current_url)
            if not match:
                await self.page.go_back()
                await asyncio.sleep(1)
                return None
            
            profile_url = match.group(1)
            
            # Try to verify this is the right person by checking the page content
            try:
                # Look for the name on the profile page
                page_text = await self.page.inner_text('body')
                page_text_lower = page_text.lower()
                
                # Check if the person's name appears on the page
                name_parts = name.lower().split()
                name_matches = sum(1 for part in name_parts if len(part) > 2 and part in page_text_lower)
                
                # Check if company appears
                company_lower = company.lower()
                company_parts = company_lower.split()
                company_matches = sum(1 for part in company_parts if len(part) > 2 and part in page_text_lower)
                
                # Consider it a match if at least one name part AND one company part match
                if name_matches >= 1 and company_matches >= 1:
                    print(f"[Profile Finder] VERIFIED: {profile_url}")
                    return profile_url
                elif name_matches >= 2:
                    # Strong name match, might be good enough
                    print(f"[Profile Finder] VERIFIED (name only): {profile_url}")
                    return profile_url
                else:
                    print(f"[Profile Finder] Profile did not match: {name} @ {company}")
                    
            except Exception as e:
                print(f"[Profile Finder] Error verifying page content: {e}")
            
            # Go back to search results
            await self.page.go_back()
            await asyncio.sleep(1)
            return None
            
        except Exception as e:
            print(f"[Profile Finder] Error verifying profile: {e}")
            try:
                await self.page.go_back()
                await asyncio.sleep(1)
            except:
                pass
            return None
    
    def _find_profile_with_llm_sync(self, name: str, company: str) -> Optional[str]:
        """
        Use Tavily web search + GPT-4o to find LinkedIn profile URL.
        Synchronous version for running in a thread.
        """
        from openai import OpenAI
        from services.web_search import tavily_search_sync
        
        print(f"[Profile Finder] LLM Search: {name} @ {company}")
        
        # Step 1: Search with Tavily
        try:
            query = f"{name} {company} LinkedIn profile site:linkedin.com/in/"

            search_results = tavily_search_sync(
                query=query,
                search_depth="basic",
                include_answer=False,
                max_results=5,
            )
            if search_results.get("error"):
                print(f"[Profile Finder] Tavily search error: {search_results['error']}")
                return None
            
        except Exception as e:
            print(f"[Profile Finder] Tavily search error: {e}")
            return None
        
        # Check if any results contain LinkedIn URLs
        results = search_results.get('results', [])
        if not results:
            print(f"[Profile Finder] No Tavily results for {name}")
            return None
        
        # Build context for LLM
        context_parts = []
        linkedin_urls_found = []
        
        for result in results[:5]:
            url = result.get('url', '')
            title = result.get('title', '')
            content = result.get('content', '')[:300]
            
            # Collect any LinkedIn URLs found
            if 'linkedin.com/in/' in url:
                linkedin_urls_found.append(url)
            
            context_parts.append(f"URL: {url}\nTitle: {title}\nContent: {content}")
        
        # If only one LinkedIn URL found and it looks right, use it directly
        if len(linkedin_urls_found) == 1:
            url = linkedin_urls_found[0]
            match = re.search(r'(https://[a-z]+\.linkedin\.com/in/[a-zA-Z0-9_-]+)', url)
            if match:
                profile_url = match.group(1).replace('www.', '')
                print(f"[Profile Finder] LLM (direct): {profile_url}")
                return profile_url
        
        # Step 2: Use GPT-4o to analyze and pick the right profile
        if not config.OPENAI_API_KEY:
            print("[Profile Finder] OPENAI_API_KEY not configured")
            # Try to return first LinkedIn URL if found
            if linkedin_urls_found:
                match = re.search(r'(https://[a-z]+\.linkedin\.com/in/[a-zA-Z0-9_-]+)', linkedin_urls_found[0])
                if match:
                    return match.group(1)
            return None
        
        context = "\n\n".join(context_parts)
        
        prompt = f"""Find the LinkedIn profile URL for this person:
Name: {name}
Company: {company}

Search results:
{context}

Your task: Identify which search result (if any) is the correct LinkedIn profile for "{name}" who works at "{company}".

Return ONLY the LinkedIn profile URL in this exact format:
https://www.linkedin.com/in/username

If you cannot confidently identify the correct profile, return: NONE

Response (just the URL or NONE):"""

        try:
            client = OpenAI(api_key=config.OPENAI_API_KEY)
            response = client.chat.completions.create(
                model=config.LLM_MODEL_SMART,  # gpt-4o
                messages=[{"role": "user", "content": prompt}],
                max_tokens=100,
                temperature=0
            )
            
            result_text = response.choices[0].message.content.strip()
            
            # Extract URL from response
            if result_text == "NONE" or "none" in result_text.lower():
                print(f"[Profile Finder] LLM could not find profile for {name}")
                return None
            
            # Extract LinkedIn URL from response
            match = re.search(r'(https://(?:www\.)?linkedin\.com/in/[a-zA-Z0-9_-]+)', result_text)
            if match:
                profile_url = match.group(1)
                print(f"[Profile Finder] LLM found: {profile_url}")
                return profile_url
            
            print(f"[Profile Finder] LLM returned invalid URL: {result_text}")
            return None
            
        except Exception as e:
            print(f"[Profile Finder] LLM error: {e}")
            return None
    
    async def _find_profile_with_llm(self, name: str, company: str) -> Optional[str]:
        """Async wrapper for backward compatibility."""
        return self._find_profile_with_llm_sync(name, company)


