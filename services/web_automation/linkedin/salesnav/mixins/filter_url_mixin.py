"""Thin compatibility mixin for filter URL helpers."""

from __future__ import annotations

from typing import Dict, Optional

from ..flows.filter_url_build_flow import SalesNavFilterUrlBuildFlow
from ..flows.filter_url_filter_id_flow import SalesNavFilterUrlFilterIdFlow
from ..flows.filter_url_location_flow import SalesNavFilterUrlLocationFlow


class SalesNavFilterUrlMixin:
    @property
    def _filter_url_build_flow(self) -> SalesNavFilterUrlBuildFlow:
        flow = getattr(self, "__filter_url_build_flow", None)
        if flow is None:
            flow = SalesNavFilterUrlBuildFlow(self)
            setattr(self, "__filter_url_build_flow", flow)
        return flow

    @property
    def _filter_url_location_flow(self) -> SalesNavFilterUrlLocationFlow:
        flow = getattr(self, "__filter_url_location_flow", None)
        if flow is None:
            flow = SalesNavFilterUrlLocationFlow(self)
            setattr(self, "__filter_url_location_flow", flow)
        return flow

    @property
    def _filter_url_filter_id_flow(self) -> SalesNavFilterUrlFilterIdFlow:
        flow = getattr(self, "__filter_url_filter_id_flow", None)
        if flow is None:
            flow = SalesNavFilterUrlFilterIdFlow(self)
            setattr(self, "__filter_url_filter_id_flow", flow)
        return flow

    async def build_search_url(self, filters: Dict) -> Optional[str]:
        return await self._filter_url_build_flow.build_search_url(filters)

    async def _get_location_id_from_dropdown(self, location: str) -> Optional[str]:
        return await self._filter_url_location_flow.get_location_id_from_dropdown(location)

    async def _get_filter_id_from_url(self, filter_type: str, filter_value: str) -> Optional[str]:
        return await self._filter_url_filter_id_flow.get_filter_id_from_url(filter_type, filter_value)

    async def _get_filter_id(self, filter_type: str, filter_value: str) -> Optional[str]:
        return await self._filter_url_filter_id_flow.get_filter_id(filter_type, filter_value)

