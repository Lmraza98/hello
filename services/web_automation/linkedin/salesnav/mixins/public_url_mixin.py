"""Thin compatibility mixin for public URL extraction APIs."""

from __future__ import annotations

from typing import Optional

from ..flows.public_url_batch import SalesNavPublicUrlBatch
from ..flows.public_url_flow import SalesNavPublicUrlFlow


class SalesNavPublicUrlMixin:
    @property
    def _public_url_flow(self) -> SalesNavPublicUrlFlow:
        flow = getattr(self, "__public_url_flow", None)
        if flow is None:
            flow = SalesNavPublicUrlFlow(self)
            setattr(self, "__public_url_flow", flow)
        return flow

    async def extract_public_linkedin_url(self, card, name: str = None) -> Optional[str]:
        return await self._public_url_flow.extract_public_linkedin_url(card, name=name)

    def _abs_salesnav_url(self, url: Optional[str]) -> Optional[str]:
        return self._public_url_flow._abs_salesnav_url(url)

    def _extract_public_url_from_html(self, html: str) -> Optional[str]:
        return self._public_url_flow._extract_public_url_from_html(html)

    async def _copy_public_url_from_lead_page(self, sales_nav_url: Optional[str], name: str = None) -> Optional[str]:
        return await self._public_url_flow._copy_public_url_from_lead_page(sales_nav_url=sales_nav_url, name=name)

    async def scrape_current_results_with_public_urls(self, max_employees: int = 50, extract_public_urls: bool = True):
        batch = SalesNavPublicUrlBatch(self, self._public_url_flow)
        return await batch.run(max_employees=max_employees, extract_public_urls=extract_public_urls)

