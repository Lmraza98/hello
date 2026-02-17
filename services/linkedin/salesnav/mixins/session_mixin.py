from __future__ import annotations

import asyncio
import json
import re
from difflib import SequenceMatcher
from pathlib import Path
from typing import Dict, List, Optional
from urllib.parse import quote

from playwright.async_api import async_playwright, Browser, BrowserContext, Page

import config
from ..core.selectors import SEL

LINKEDIN_STORAGE_STATE = config.DATA_DIR / "linkedin_auth.json"


class SalesNavSessionMixin:
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
        try:
            await self.context.grant_permissions(['clipboard-read', 'clipboard-write'])
        except Exception:
            pass
        
        # Hide webdriver flag and add stealth scripts
        await self.context.add_init_script("""
            Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
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
            print("[LinkedIn] Checking session...")
            await self.page.goto(SEL.SALES_HOME_URL, timeout=30000)
            await self.page.wait_for_load_state('domcontentloaded', timeout=15000)
            await self.waits.wait_for_url_contains("linkedin.com", timeout_seconds=4.0)

            url = self.page.url or ""

            # Detect explicit auth pages/walls first.
            if (
                'login' in url.lower()
                or 'checkpoint' in url.lower()
                or 'authwall' in url.lower()
                or await self.page.locator(SEL.AUTH_LOGIN_FORM).count() > 0
                or await self.page.locator(SEL.AUTH_WALL).count() > 0
            ):
                self.is_authenticated = False
                print("[LinkedIn] Session expired - login required")
                return False

            if self.session_mgr.is_authenticated_url(url):
                self.is_authenticated = True
                print("[LinkedIn] Session valid - already authenticated")
                return True

            self.is_authenticated = False
            return False

        except Exception as e:
            print(f"[LinkedIn] Auth check error: {e}")
            self.is_authenticated = False
            return False

    async def wait_for_login(self, timeout_minutes: int | None = None) -> bool:
        """Wait for user to manually log in."""
        if timeout_minutes is None:
            timeout_minutes = config.LINKEDIN_TIMEOUT_MINUTES
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
                
                if self.session_mgr.is_authenticated_url(url):
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

