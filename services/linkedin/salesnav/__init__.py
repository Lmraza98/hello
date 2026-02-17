"""Sales Navigator scraper support modules."""

from .core.models import CompanyResult, ContactsResult, EmployeeResult
from .core.selectors import SEL
from .core.session import is_salesnav_authenticated_url, is_salesnav_host, SalesNavSessionManager
from .core.waits import SalesNavWaits
from .core.debug import SalesNavDebug
from .core.operations import run_operation_with_retries
from .core.filters import split_bullet_text, normalize_salesnav_company_url, normalize_salesnav_lead_url
from .core.nav import SalesNavNavigator

from .extractors.scrape_people import SalesNavPeopleExtractor
from .extractors.scrape_companies import SalesNavCompanyExtractor

from .flows.filter_applier import SalesNavFilterApplier
from .flows.public_url_flow import SalesNavPublicUrlFlow
from .flows.public_url_batch import SalesNavPublicUrlBatch
from .flows.navigation_company_search import SalesNavCompanySearchFlow
from .flows.navigation_employee_fetch import SalesNavEmployeeFetchFlow
from .flows.navigation_workflows import SalesNavWorkflowFlow
from .flows.filter_url_build_flow import SalesNavFilterUrlBuildFlow
from .flows.filter_url_location_flow import SalesNavFilterUrlLocationFlow
from .flows.filter_url_filter_id_flow import SalesNavFilterUrlFilterIdFlow
from .flows.company_collection import SalesNavCompanyCollectionFlow, collect_companies_from_query

from .mixins.session_mixin import SalesNavSessionMixin
from .mixins.navigation_mixin import SalesNavNavigationMixin
from .mixins.filter_url_mixin import SalesNavFilterUrlMixin
from .mixins.public_url_mixin import SalesNavPublicUrlMixin
from .mixins.parsing_mixin import SalesNavParsingMixin

__all__ = [
    "CompanyResult",
    "ContactsResult",
    "EmployeeResult",
    "SEL",
    "is_salesnav_authenticated_url",
    "is_salesnav_host",
    "SalesNavSessionManager",
    "SalesNavWaits",
    "SalesNavDebug",
    "run_operation_with_retries",
    "split_bullet_text",
    "normalize_salesnav_company_url",
    "normalize_salesnav_lead_url",
    "SalesNavNavigator",
    "SalesNavPeopleExtractor",
    "SalesNavCompanyExtractor",
    "SalesNavFilterApplier",
    "SalesNavPublicUrlFlow",
    "SalesNavPublicUrlBatch",
    "SalesNavCompanySearchFlow",
    "SalesNavEmployeeFetchFlow",
    "SalesNavWorkflowFlow",
    "SalesNavFilterUrlBuildFlow",
    "SalesNavFilterUrlLocationFlow",
    "SalesNavFilterUrlFilterIdFlow",
    "SalesNavCompanyCollectionFlow",
    "collect_companies_from_query",
    "SalesNavSessionMixin",
    "SalesNavNavigationMixin",
    "SalesNavFilterUrlMixin",
    "SalesNavPublicUrlMixin",
    "SalesNavParsingMixin",
]
