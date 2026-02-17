from services.linkedin.salesnav.query_builder import (
    SalesNavQueryBuildError,
    build_salesnav_account_search_url,
    build_salesnav_people_search_url,
)


def test_build_salesnav_account_search_url_with_keyword_and_filters():
    out = build_salesnav_account_search_url(
        keyword="ai",
        filters={
            "industry": "Hospitals and Health Care",
            "headquarters_location": "United States",
            "company_headcount": "1-10",
        },
    )
    assert "query=" in out.url
    assert "viewAllFilters=true" in out.url
    assert out.applied_filters["industry"]["applied"] is True
    assert out.applied_filters["headquarters_location"]["applied"] is True
    assert out.applied_filters["company_headcount"]["applied"] is True


def test_build_salesnav_account_search_url_handles_department_ranges():
    out = build_salesnav_account_search_url(
        keyword="ai",
        filters={
            "department_headcount": "Marketing 1-10",
            "department_headcount_growth": "Marketing 1-19%",
        },
    )
    assert out.applied_filters["department_headcount"]["applied"] is True
    assert out.applied_filters["department_headcount_growth"]["applied"] is True


def test_build_salesnav_account_search_url_raises_on_unmapped_filter_values():
    try:
        build_salesnav_account_search_url(
            keyword="quantum",
            filters={"industry": "Totally Unknown Industry Label"},
        )
        raise AssertionError("expected SalesNavQueryBuildError")
    except SalesNavQueryBuildError as exc:
        assert isinstance(exc.unmapped_filters, list)
        assert exc.unmapped_filters
        assert exc.unmapped_filters[0]["filter"] == "industry"


def test_build_salesnav_account_search_url_resolves_industry_from_ids_file():
    out = build_salesnav_account_search_url(
        keyword="industrial",
        filters={"industry": "Industrial Machinery Manufacturing"},
    )
    assert out.applied_filters["industry"]["applied"] is True
    resolved = out.applied_filters["industry"]["resolved"]
    assert isinstance(resolved, list) and resolved
    assert resolved[0]["id"] == "135"


def test_build_salesnav_account_search_url_supports_decimal_annual_revenue_ranges():
    out = build_salesnav_account_search_url(
        keyword="industrial",
        filters={"annual_revenue": "0.5-2.5"},
    )
    assert out.applied_filters["annual_revenue"]["applied"] is True
    assert "type%3AANNUAL_REVENUE" in out.url
    assert "min%3A0.5" in out.url
    assert "max%3A2.5" in out.url


def test_build_salesnav_account_search_url_supports_open_ended_annual_revenue_ranges():
    out = build_salesnav_account_search_url(
        keyword="industrial",
        filters={"annual_revenue": "1000+"},
    )
    assert out.applied_filters["annual_revenue"]["applied"] is True
    assert "type%3AANNUAL_REVENUE" in out.url
    assert "min%3A1000" in out.url
    assert "max%3A1001" in out.url


def test_build_salesnav_people_search_url_supports_current_company_urn():
    out = build_salesnav_people_search_url(
        keyword="vp operations",
        filters={
            "current_company": "ZCO Stockholm",
            "current_company_urn": "urn:li:organization:1296977",
            "function": "Operations",
            "seniority_level": "Vice President",
            "headquarters_location": "United States",
        },
    )
    assert "query=" in out.url
    assert "type%3ACURRENT_COMPANY" in out.url
    assert "urn%253Ali%253Aorganization%253A1296977" in out.url
    assert out.applied_filters["current_company"]["applied"] is True
    assert out.applied_filters["function"]["applied"] is True
    assert out.applied_filters["seniority_level"]["applied"] is True


def test_build_salesnav_people_search_url_uses_sales_company_url_for_org_id():
    out = build_salesnav_people_search_url(
        keyword="vp operations",
        filters={
            "current_company": "Acme Corp",
            "current_company_sales_nav_url": "https://www.linkedin.com/sales/company/1659661",
            "function": "Operations",
            "seniority_level": "Vice President",
        },
    )
    assert out.applied_filters["current_company"]["applied"] is True
    resolved = out.applied_filters["current_company"]["resolved"]
    assert isinstance(resolved, list) and resolved
    assert resolved[0]["urn"] == "urn:li:organization:1659661"


def test_build_salesnav_people_search_url_rejects_unmapped_values():
    try:
        build_salesnav_people_search_url(
            keyword="vp",
            filters={"function": "Totally Unknown Function"},
        )
        raise AssertionError("expected SalesNavQueryBuildError")
    except SalesNavQueryBuildError as exc:
        assert isinstance(exc.unmapped_filters, list)
        assert exc.unmapped_filters
        assert exc.unmapped_filters[0]["filter"] == "function"
