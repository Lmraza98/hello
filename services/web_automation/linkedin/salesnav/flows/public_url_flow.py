"""Single-card public URL extraction flow for Sales Navigator leads."""

from __future__ import annotations

import asyncio
import re
from typing import Any, Optional


class SalesNavPublicUrlFlow:
    def __init__(self, scraper: Any):
        self.scraper = scraper

    @property
    def page(self):
        return self.scraper.page

    @property
    def context(self):
        return self.scraper.context

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
            url = url.strip().rstrip('",}')
            if "linkedin.com/in/" in url:
                return url
        return None

    async def _open_card_overflow(self, card, name: str | None) -> bool:
        import random

        overflow_btn = card.locator('button[aria-label*="See more actions"]').or_(
            card.locator('button[aria-label*="More actions"]')
        ).or_(card.locator('button[data-search-overflow-trigger]')).or_(
            card.locator('button[aria-haspopup="true"]._circle_ps32ck')
        ).or_(card.locator('button:has(span._icon_ps32ck)')).or_(
            card.locator('button:has(svg[viewBox="0 0 16 16"])')
        ).first
        if await overflow_btn.count() == 0:
            print(f"[LinkedIn] No overflow menu found for {name or 'lead'}")
            return False
        await overflow_btn.click()
        await asyncio.sleep(random.uniform(0.5, 1.0))
        return True

    async def _find_view_profile_action(self):
        menu = self.page.locator('div[id^="hue-menu-"]').last
        return menu.locator('button:has-text("View profile")').or_(
            menu.locator('a:has-text("View profile")')
        ).or_(menu.locator('button:has-text("View Profile")')).or_(
            menu.locator('a:has-text("View Profile")')
        ).or_(menu.locator('button:has-text("View on LinkedIn")')).or_(
            menu.locator('a:has-text("View on LinkedIn")')
        ).or_(self.page.locator('[data-control-name="view_profile"]')).first

    async def _extract_from_profile_page(self, profile_page, name: str | None) -> Optional[str]:
        import random

        profile_overflow = profile_page.locator('button[data-x--lead-actions-bar-overflow-menu]').or_(
            profile_page.locator("button._overflow-menu--trigger_1xow7n")
        ).or_(profile_page.locator('button[aria-label="Open actions overflow menu"]')).or_(
            profile_page.locator("button:has(span._icon_ps32ck)")
        ).or_(profile_page.locator('button:has(svg[viewBox="0 0 16 16"])')).first
        if await profile_overflow.count() == 0:
            print(f"[LinkedIn] No overflow menu on profile page for {name or 'lead'}")
            return None
        await profile_overflow.click()
        await asyncio.sleep(random.uniform(0.5, 1.0))

        profile_menu = profile_page.locator('div[id^="hue-menu-"]').last
        copy_url_btn = profile_menu.locator('button:has-text("Copy LinkedIn.com URL")').or_(
            profile_menu.locator('button:has-text("Copy LinkedIn URL")')
        ).or_(profile_menu.locator('button:has-text("Copy LinkedIn")')).or_(
            profile_menu.locator('[data-control-name="copy_linkedin_url"]')
        ).or_(profile_menu.locator(':is(div,span):has-text("Copy LinkedIn.com URL")')).or_(
            profile_menu.locator(':is(div,span):has-text("Copy LinkedIn URL")')
        ).or_(profile_menu.locator(':is(div,span):has-text("Copy LinkedIn")')).first
        if await copy_url_btn.count() == 0:
            try:
                public_link = profile_page.locator('a[href*="linkedin.com/in/"]').first
                if await public_link.count() > 0:
                    href = await public_link.get_attribute("href")
                    if href and "linkedin.com/in/" in href:
                        return href.strip()
            except Exception:
                pass
            return None

        await self.context.grant_permissions(["clipboard-read", "clipboard-write"])
        try:
            await copy_url_btn.click()
        except Exception:
            await copy_url_btn.evaluate("(el) => el.click()")
        await asyncio.sleep(random.uniform(0.3, 0.6))
        linkedin_url = await profile_page.evaluate("navigator.clipboard.readText()")
        if linkedin_url and "linkedin.com/in/" in linkedin_url:
            return linkedin_url.strip()
        return None

    async def _copy_public_url_from_lead_page(self, sales_nav_url: Optional[str], name: str | None = None) -> Optional[str]:
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
            await asyncio.sleep(random.uniform(1.0, 2.0))

            try:
                html = await self.page.content()
                embedded_url = self._extract_public_url_from_html(html)
                if embedded_url:
                    print(f"[LinkedIn] Found embedded public URL for {name or 'lead'}")
                    return embedded_url
            except Exception:
                pass

            overflow = self.page.locator(
                'button[data-x--lead-actions-bar-overflow-menu][aria-label="Open actions overflow menu"]._overflow-menu--trigger_1xow7n'
            ).or_(self.page.locator('button[id^="hue-menu-trigger-"][aria-label="Open actions overflow menu"][aria-haspopup="true"]')).or_(
                self.page.locator('button[data-x--lead-actions-bar-overflow-menu][aria-label="Open actions overflow menu"]')
            ).or_(self.page.locator('button._overflow-menu--trigger_1xow7n[aria-label="Open actions overflow menu"]'))

            menu_opened = False
            overflow_count = await overflow.count()
            for idx in range(min(overflow_count, 8)):
                btn = overflow.nth(idx)
                try:
                    if not await btn.is_visible():
                        continue
                    await btn.scroll_into_view_if_needed()
                    await btn.click(force=True, timeout=2000)
                    await self.page.wait_for_selector('div[id^="hue-menu-"], div._container_x5gf48', timeout=1200)
                    menu_opened = True
                    break
                except Exception:
                    continue
            if not menu_opened:
                print(f"[LinkedIn] Ellipsis menu did not open on lead page for {name or 'lead'}")
                return None

            menu = self.page.locator('div[id^="hue-menu-"]').or_(self.page.locator("div._container_x5gf48")).last
            copy_btn = menu.locator('button:has-text("Copy LinkedIn.com URL")').or_(
                menu.locator('button:has-text("Copy LinkedIn URL")')
            ).or_(menu.locator('[data-control-name="copy_linkedin_url"]')).or_(
                menu.locator('[role="menuitem"]:has-text("Copy LinkedIn.com URL")')
            ).or_(menu.locator('[role="menuitem"]:has-text("Copy LinkedIn URL")')).or_(
                menu.locator(':is(div,span):has-text("Copy LinkedIn.com URL")')
            ).or_(menu.locator(':is(div,span):has-text("Copy LinkedIn URL")')).first
            if await copy_btn.count() == 0:
                return None

            await self.context.grant_permissions(["clipboard-read", "clipboard-write"])
            try:
                await copy_btn.click()
            except Exception:
                await copy_btn.evaluate("(el) => el.click()")
            await asyncio.sleep(random.uniform(0.3, 0.6))
            copied = await self.page.evaluate("navigator.clipboard.readText()")
            if copied and "linkedin.com/in/" in copied:
                return copied.strip()
            public_link = self.page.locator('a[href*="linkedin.com/in/"]').first
            if await public_link.count() > 0:
                href = await public_link.get_attribute("href")
                if href and "linkedin.com/in/" in href:
                    return href.strip()
            return None
        finally:
            try:
                if original_url and self.page.url != original_url:
                    await self.page.goto(original_url, timeout=30000)
                    await self.page.wait_for_load_state("domcontentloaded", timeout=15000)
                    await asyncio.sleep(0.5)
            except Exception:
                pass

    async def extract_public_linkedin_url(self, card, name: str | None = None) -> Optional[str]:
        import random

        profile_page = None
        try:
            if not await self._open_card_overflow(card, name):
                return None
            view_profile_btn = await self._find_view_profile_action()
            if await view_profile_btn.count() == 0:
                await self.page.keyboard.press("Escape")
                lead_link = card.locator('a[href*="/sales/lead/"]').first
                sales_nav_url = await lead_link.get_attribute("href") if await lead_link.count() > 0 else None
                return await self._copy_public_url_from_lead_page(sales_nav_url=sales_nav_url, name=name)

            pages_before = len(self.context.pages)
            await view_profile_btn.click(modifiers=["Control"])
            await asyncio.sleep(random.uniform(1.5, 2.5))
            for _ in range(10):
                if len(self.context.pages) > pages_before:
                    break
                await asyncio.sleep(0.3)
            if len(self.context.pages) <= pages_before:
                await view_profile_btn.click()
                await asyncio.sleep(2.0)
                if len(self.context.pages) > pages_before:
                    profile_page = self.context.pages[-1]
                else:
                    try:
                        await self.page.go_back()
                        await asyncio.sleep(1.0)
                    except Exception:
                        pass
                    return None
            else:
                profile_page = self.context.pages[-1]

            await profile_page.wait_for_load_state("domcontentloaded", timeout=15000)
            await asyncio.sleep(random.uniform(1, 2))
            return await self._extract_from_profile_page(profile_page, name)
        except Exception as exc:
            print(f"[LinkedIn] Error extracting public URL for {name or 'lead'}: {exc}")
            return None
        finally:
            try:
                if profile_page and profile_page != self.page:
                    await profile_page.close()
            except Exception:
                pass
            try:
                await self.page.keyboard.press("Escape")
            except Exception:
                pass

