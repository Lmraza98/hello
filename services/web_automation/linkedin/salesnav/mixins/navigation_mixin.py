"""Thin compatibility mixin for navigation APIs."""

from __future__ import annotations

from typing import Dict, List, Optional

from ..flows.navigation_company_search import SalesNavCompanySearchFlow
from ..flows.navigation_employee_fetch import SalesNavEmployeeFetchFlow
from ..flows.navigation_workflows import SalesNavWorkflowFlow


class SalesNavNavigationMixin:
    @property
    def _company_search_flow(self) -> SalesNavCompanySearchFlow:
        flow = getattr(self, "__company_search_flow", None)
        if flow is None:
            flow = SalesNavCompanySearchFlow(self)
            setattr(self, "__company_search_flow", flow)
        return flow

    @property
    def _employee_fetch_flow(self) -> SalesNavEmployeeFetchFlow:
        flow = getattr(self, "__employee_fetch_flow", None)
        if flow is None:
            flow = SalesNavEmployeeFetchFlow(self)
            setattr(self, "__employee_fetch_flow", flow)
        return flow

    @property
    def _workflow_flow(self) -> SalesNavWorkflowFlow:
        flow = getattr(self, "__workflow_flow", None)
        if flow is None:
            flow = SalesNavWorkflowFlow(self)
            setattr(self, "__workflow_flow", flow)
        return flow

    async def search_company(self, company_name: str) -> Optional[str]:
        return await self._company_search_flow.search_company(company_name)

    async def click_decision_makers(self) -> bool:
        return await self._company_search_flow.click_decision_makers()

    async def get_company_employees(
        self,
        company_url: str,
        max_employees: int = 20,
        title_filter: str = None,
    ) -> List[Dict]:
        return await self._employee_fetch_flow.get_company_employees(
            company_url=company_url,
            max_employees=max_employees,
            title_filter=title_filter,
        )

    async def scrape_company_contacts(
        self,
        company_name: str,
        domain: str,
        max_contacts: int = 10,
        extract_public_urls: bool = False,
    ) -> Dict:
        return await self._workflow_flow.scrape_company_contacts(
            company_name=company_name,
            domain=domain,
            max_contacts=max_contacts,
            extract_public_urls=extract_public_urls,
        )

    async def navigate_to_account_search(self):
        return await self._company_search_flow.navigate_to_account_search()

    async def search_companies_with_filters(
        self,
        filters: Dict,
        max_companies: int = 100,
    ) -> List[Dict]:
        return await self._workflow_flow.search_companies_with_filters(
            filters=filters,
            max_companies=max_companies,
        )

