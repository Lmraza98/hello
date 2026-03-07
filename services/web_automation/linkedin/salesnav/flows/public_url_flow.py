"""Single-card public URL extraction flow for Sales Navigator leads."""

from __future__ import annotations

import asyncio
import re
from typing import Any, Optional

from ..core.interaction import click_locator, scroll_into_view, wait_with_jitter


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

    def _normalize_public_profile_url(self, url: Optional[str]) -> Optional[str]:
        value = self._abs_salesnav_url(url)
        if not value:
            return None
        if "linkedin.com/in/" not in value:
            return None
        return value.split("?", 1)[0].strip()

    async def _read_public_url_from_clipboard(self, page) -> Optional[str]:
        try:
            await self.context.grant_permissions(["clipboard-read", "clipboard-write"])
        except Exception:
            pass

        for _ in range(4):
            try:
                copied = await page.evaluate("navigator.clipboard.readText()")
            except Exception:
                copied = None
            normalized = self._normalize_public_profile_url(copied)
            if normalized:
                return normalized
            await asyncio.sleep(0.25)
        return None

    async def _click_when_ready(self, page, locator, *, settle_s: float = 0.35) -> bool:
        try:
            await locator.first.wait_for(state="visible", timeout=8000)
            await scroll_into_view(page, locator)
            await wait_with_jitter(settle_s, 0.08)
            await click_locator(page, locator)
            await wait_with_jitter(0.45, 0.12)
            return True
        except Exception:
            return False

    async def _open_card_overflow(self, card, name: str | None) -> bool:
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
        return await self._click_when_ready(self.page, overflow_btn, settle_s=0.45)

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
        current_url = self._normalize_public_profile_url(getattr(profile_page, "url", None))
        if current_url:
            return current_url

        try:
            try:
                await profile_page.bring_to_front()
            except Exception:
                pass
            html = await profile_page.content()
            embedded_url = self._extract_public_url_from_html(html)
            normalized_embedded = self._normalize_public_profile_url(embedded_url)
            if normalized_embedded:
                return normalized_embedded
        except Exception:
            pass

        profile_overflow = profile_page.locator('button[data-x--lead-actions-bar-overflow-menu]').or_(
            profile_page.locator("button._overflow-menu--trigger_1xow7n")
        ).or_(profile_page.locator('button[aria-label="Open actions overflow menu"]')).or_(
            profile_page.locator("button:has(span._icon_ps32ck)")
        ).or_(profile_page.locator('button:has(svg[viewBox="0 0 16 16"])')).first
        if await profile_overflow.count() == 0:
            print(f"[LinkedIn] No overflow menu on profile page for {name or 'lead'}")
            return None
        if not await self._click_when_ready(profile_page, profile_overflow, settle_s=0.5):
            print(f"[LinkedIn] Profile overflow click failed for {name or 'lead'}")
            return None

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
                    normalized_href = self._normalize_public_profile_url(href)
                    if normalized_href:
                        return normalized_href
            except Exception:
                pass
            return None

        if not await self._click_when_ready(profile_page, copy_url_btn, settle_s=0.4):
            return None
        normalized_clipboard = await self._read_public_url_from_clipboard(profile_page)
        if normalized_clipboard:
            return normalized_clipboard
        try:
            html = await profile_page.content()
            embedded_url = self._extract_public_url_from_html(html)
            normalized_embedded = self._normalize_public_profile_url(embedded_url)
            if normalized_embedded:
                return normalized_embedded
        except Exception:
            pass
        return None

    async def _copy_public_url_from_lead_page(self, sales_nav_url: Optional[str], name: str | None = None) -> Optional[str]:
        abs_url = self._abs_salesnav_url(sales_nav_url)
        if not abs_url:
            print(f"[LinkedIn] No sales lead URL available for {name or 'lead'}")
            return None

        lead_page = None
        try:
            lead_page = await self.context.new_page()
            print(f"[LinkedIn] Opening lead page in new tab for {name or 'lead'}")
            await lead_page.goto(abs_url, timeout=30000)
            await lead_page.wait_for_load_state("domcontentloaded", timeout=15000)
            await wait_with_jitter(1.4, 0.25)

            try:
                html = await lead_page.content()
                embedded_url = self._extract_public_url_from_html(html)
                if embedded_url:
                    print(f"[LinkedIn] Found embedded public URL for {name or 'lead'}")
                    return embedded_url
            except Exception:
                pass

            overflow = lead_page.locator(
                'button[data-x--lead-actions-bar-overflow-menu][aria-label="Open actions overflow menu"]._overflow-menu--trigger_1xow7n'
            ).or_(lead_page.locator('button[id^="hue-menu-trigger-"][aria-label="Open actions overflow menu"][aria-haspopup="true"]')).or_(
                lead_page.locator('button[data-x--lead-actions-bar-overflow-menu][aria-label="Open actions overflow menu"]')
            ).or_(lead_page.locator('button._overflow-menu--trigger_1xow7n[aria-label="Open actions overflow menu"]'))

            menu_opened = False
            overflow_count = await overflow.count()
            for idx in range(min(overflow_count, 8)):
                btn = overflow.nth(idx)
                try:
                    if not await btn.is_visible():
                        continue
                    if not await self._click_when_ready(lead_page, btn, settle_s=0.45):
                        continue
                    await lead_page.wait_for_selector('div[id^="hue-menu-"], div._container_x5gf48', timeout=1200)
                    menu_opened = True
                    break
                except Exception:
                    continue
            if not menu_opened:
                print(f"[LinkedIn] Ellipsis menu did not open on lead page for {name or 'lead'}")
                return None

            menu = lead_page.locator('div[id^="hue-menu-"]').or_(lead_page.locator("div._container_x5gf48")).last
            copy_btn = menu.locator('button:has-text("Copy LinkedIn.com URL")').or_(
                menu.locator('button:has-text("Copy LinkedIn URL")')
            ).or_(menu.locator('[data-control-name="copy_linkedin_url"]')).or_(
                menu.locator('[role="menuitem"]:has-text("Copy LinkedIn.com URL")')
            ).or_(menu.locator('[role="menuitem"]:has-text("Copy LinkedIn URL")')).or_(
                menu.locator(':is(div,span):has-text("Copy LinkedIn.com URL")')
            ).or_(menu.locator(':is(div,span):has-text("Copy LinkedIn URL")')).first
            if await copy_btn.count() == 0:
                return None

            if not await self._click_when_ready(lead_page, copy_btn, settle_s=0.4):
                return None
            normalized_copied = await self._read_public_url_from_clipboard(lead_page)
            if normalized_copied:
                return normalized_copied
            try:
                html = await lead_page.content()
                embedded_url = self._extract_public_url_from_html(html)
                normalized_embedded = self._normalize_public_profile_url(embedded_url)
                if normalized_embedded:
                    return normalized_embedded
            except Exception:
                pass
            public_link = lead_page.locator('a[href*="linkedin.com/in/"]').first
            if await public_link.count() > 0:
                href = await public_link.get_attribute("href")
                normalized_href = self._normalize_public_profile_url(href)
                if normalized_href:
                    return normalized_href
            return None
        finally:
            try:
                if lead_page and lead_page != self.page:
                    await lead_page.close()
            except Exception:
                pass

    async def extract_public_linkedin_url(self, card, name: str | None = None) -> Optional[str]:
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
            await scroll_into_view(self.page, view_profile_btn)
            await wait_with_jitter(0.5, 0.08)
            await view_profile_btn.click(modifiers=["Control"])
            await wait_with_jitter(1.8, 0.35)
            for _ in range(10):
                if len(self.context.pages) > pages_before:
                    break
                await asyncio.sleep(0.3)
            if len(self.context.pages) <= pages_before:
                if not await self._click_when_ready(self.page, view_profile_btn, settle_s=0.5):
                    return None
                await wait_with_jitter(2.0, 0.35)
                if len(self.context.pages) > pages_before:
                    profile_page = self.context.pages[-1]
                else:
                    try:
                        await self.page.go_back()
                        await wait_with_jitter(1.0, 0.15)
                    except Exception:
                        pass
                    return None
            else:
                profile_page = self.context.pages[-1]

            await profile_page.wait_for_load_state("domcontentloaded", timeout=15000)
            await wait_with_jitter(1.2, 0.25)
            direct_url = self._normalize_public_profile_url(getattr(profile_page, "url", None))
            if direct_url:
                return direct_url
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
