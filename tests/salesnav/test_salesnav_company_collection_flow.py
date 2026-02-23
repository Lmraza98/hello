import asyncio
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from uuid import uuid4

from services.web_automation.linkedin.salesnav.flows.company_collection import SalesNavCompanyCollectionFlow


def _run(coro):
    return asyncio.run(coro)


def _db_ctx(db_path: str):
    @contextmanager
    def _ctx():
        conn = sqlite3.connect(db_path)
        try:
            yield conn
            conn.commit()
        finally:
            conn.close()

    return _ctx


def test_extract_hq_filter_value_prefers_first_non_empty_item():
    assert SalesNavCompanyCollectionFlow._extract_hq_filter_value(None) == {}
    assert SalesNavCompanyCollectionFlow._extract_hq_filter_value({"headquarters_location": "  US  "}) == {
        "headquarters_location": "US"
    }
    assert SalesNavCompanyCollectionFlow._extract_hq_filter_value(
        {"headquarters_location": ["", "   ", "California, United States", "Texas"]}
    ) == {"headquarters_location": "California, United States"}


def test_normalize_companies_maps_shape_and_limits_rows():
    payload = {
        "items": [
            {"name": "A", "title": "Software", "sales_nav_url": "https://x/1"},
            {"title": "No name", "sales_nav_url": "https://x/2"},
            {"name": "B", "title": "Healthcare", "sales_nav_url": "https://x/3"},
        ]
    }

    out = SalesNavCompanyCollectionFlow._normalize_companies(payload, max_companies=1)
    assert len(out) == 1
    assert out[0]["company_name"] == "A"
    assert out[0]["name"] == "A"
    assert out[0]["industry"] == "Software"
    assert out[0]["linkedin_url"] == "https://x/1"


def test_normalize_companies_preserves_enriched_salesnav_fields():
    payload = {
        "items": [
            {
                "company_name": "Acme",
                "industry": "Manufacturing",
                "sales_nav_url": "https://www.linkedin.com/sales/company/123",
                "employee_count": "631 employees",
                "location": "United States",
                "about": "Industrial machinery manufacturer",
                "strategic_priorities": ["Digital Transformation"],
                "ai_summary": "VP Ops posted about AI optimization",
                "has_ai_summary": True,
                "interaction_map": {"save_click": True, "spotlight_click": True},
            }
        ]
    }

    out = SalesNavCompanyCollectionFlow._normalize_companies(payload, max_companies=10)
    assert len(out) == 1
    row = out[0]
    assert row["company_name"] == "Acme"
    assert row["industry"] == "Manufacturing"
    assert row["employee_count"] == "631 employees"
    assert row["location"] == "United States"
    assert row["about"] == "Industrial machinery manufacturer"
    assert row["strategic_priorities"] == ["Digital Transformation"]
    assert row["ai_summary"] == "VP Ops posted about AI optimization"
    assert row["has_ai_summary"] is True
    assert row["interaction_map"] == {"save_click": True, "spotlight_click": True}


def test_run_account_search_passes_full_filters_and_clamps_limit(monkeypatch):
    flow = SalesNavCompanyCollectionFlow()
    call = {}

    async def _no_throttle():
        return None

    async def fake_search_and_extract(**kwargs):
        call.update(kwargs)
        return {"items": [{"name": "Acme", "title": "Software", "sales_nav_url": "https://sn/acme"}]}

    monkeypatch.setattr(flow, "_throttle_account_search", _no_throttle)
    monkeypatch.setattr("services.web_automation.linkedin.salesnav.flows.company_collection.search_and_extract", fake_search_and_extract)

    out = _run(
        flow._run_account_search(
            query="acme",
            filters={"headquarters_location": ["", "United States"], "industry": ["Software"]},
            max_companies=999,
        )
    )
    assert out and out[0]["company_name"] == "Acme"
    assert call.get("filter_values") == {"headquarters_location": ["", "United States"], "industry": ["Software"]}
    assert call.get("limit") == 100


def test_collect_with_fallback_retries_after_primary_error(monkeypatch):
    flow = SalesNavCompanyCollectionFlow()
    result = {}
    calls = []

    async def fake_run(query, filters, max_companies):
        calls.append((query, filters, max_companies))
        if len(calls) == 1:
            raise RuntimeError("primary failed")
        return [{"company_name": "Acme"}]

    async def fake_delay(**_kwargs):
        return None

    monkeypatch.setattr(flow, "_run_account_search", fake_run)
    monkeypatch.setattr(flow, "_build_keyword_fallback_filters", lambda _q: {"keywords": ["Acme"], "industry": []})
    monkeypatch.setattr("services.web_automation.linkedin.salesnav.flows.company_collection.pacing_delay", fake_delay)

    companies = _run(flow._collect_with_fallback("find acme", {}, 10, result))
    assert companies == [{"company_name": "Acme"}]
    assert len(calls) == 2
    assert calls[1][0] == "Acme"
    assert result["filters_applied_fallback"]["keywords"] == ["Acme"]


def test_collect_with_fallback_raises_primary_error_when_no_fallback():
    flow = SalesNavCompanyCollectionFlow()

    async def fake_run(*_args, **_kwargs):
        raise RuntimeError("primary failed")

    flow._run_account_search = fake_run
    flow._build_keyword_fallback_filters = lambda _q: None

    try:
        _run(flow._collect_with_fallback("find acme", {}, 10, {}))
        raise AssertionError("expected RuntimeError")
    except RuntimeError as exc:
        assert str(exc) == "primary failed"


def test_collect_companies_success_without_save(monkeypatch):
    flow = SalesNavCompanyCollectionFlow()

    class _Parser:
        @staticmethod
        def parse_query(_q):
            return {"headquarters_location": ["United States"]}

    flow.filter_parser = _Parser()

    async def fake_collect(query, filters, max_companies, result):
        assert query == "acme"
        assert filters == {"headquarters_location": ["United States"]}
        assert max_companies == 5
        assert isinstance(result, dict)
        return [{"company_name": "Acme"}]

    monkeypatch.setattr(flow, "_collect_with_fallback", fake_collect)

    out = _run(flow.collect_companies(query="acme", max_companies=5, save_to_db=False))
    assert out["status"] == "success"
    assert out["error"] is None
    assert len(out["companies"]) == 1


def test_collect_companies_passes_parser_output_to_execution_payload(monkeypatch):
    flow = SalesNavCompanyCollectionFlow()
    parsed_filters = {
        "industry": ["Hospitals and Health Care"],
        "headquarters_location": ["United States"],
        "company_headcount": "51-200",
        "annual_revenue": "0.5-2.5",
        "company_headcount_growth": None,
        "number_of_followers": None,
        "keywords": ["Acme"],
    }
    calls = []

    class _Parser:
        @staticmethod
        def parse_query(_q):
            return parsed_filters

    flow.filter_parser = _Parser()

    async def fake_run_account_search(query, filters, max_companies):
        calls.append({"query": query, "filters": filters, "max_companies": max_companies})
        return [{"company_name": "Acme"}]

    monkeypatch.setattr(flow, "_run_account_search", fake_run_account_search)

    out = _run(
        flow.collect_companies(
            query="find Acme on Sales Navigator in healthcare",
            max_companies=7,
            save_to_db=False,
        )
    )

    assert out["status"] == "success"
    assert len(calls) == 1
    assert calls[0]["query"] == "find Acme on Sales Navigator in healthcare"
    assert calls[0]["filters"] == parsed_filters
    assert calls[0]["max_companies"] == 7


def test_collect_companies_returns_error_status_on_exception(monkeypatch):
    flow = SalesNavCompanyCollectionFlow()

    class _Parser:
        @staticmethod
        def parse_query(_q):
            return {}

    flow.filter_parser = _Parser()

    async def fake_collect(*_args, **_kwargs):
        raise RuntimeError("boom")

    monkeypatch.setattr(flow, "_collect_with_fallback", fake_collect)
    out = _run(flow.collect_companies(query="acme", save_to_db=False))
    assert out["status"] == "error"
    assert out["error"] == "boom"


def test_save_companies_to_db_insert_and_update_with_vertical(monkeypatch):
    db_path = Path(".pytest_tmp_targets_" + uuid4().hex + ".db")
    conn = sqlite3.connect(db_path)
    conn.execute(
        """
        CREATE TABLE targets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            domain TEXT UNIQUE,
            company_name TEXT,
            vertical TEXT,
            source TEXT,
            notes TEXT,
            status TEXT
        )
        """
    )
    conn.execute(
        "INSERT INTO targets(domain, company_name, vertical, source, notes, status) VALUES (?, ?, ?, ?, ?, ?)",
        ("acme", "Acme Inc", "Old", "manual", "old note", "pending"),
    )
    conn.commit()
    conn.close()

    monkeypatch.setattr("services.web_automation.linkedin.salesnav.flows.company_collection.db.get_db", _db_ctx(str(db_path)))
    monkeypatch.setattr(
        "services.web_automation.linkedin.salesnav.flows.company_collection.infer_company_vertical",
        lambda company_name, domain: f"inferred:{company_name}:{domain}",
    )

    flow = SalesNavCompanyCollectionFlow.__new__(SalesNavCompanyCollectionFlow)
    saved = flow._save_companies_to_db(
        [
            {"company_name": "Acme Inc", "domain": "acme", "industry": ""},
            {"company_name": "Beta Labs"},
        ],
        "find acme",
    )
    assert saved == 2

    conn = sqlite3.connect(db_path)
    rows = conn.execute(
        "SELECT company_name, domain, vertical, source, notes, status FROM targets ORDER BY company_name"
    ).fetchall()
    conn.close()
    db_path.unlink(missing_ok=True)

    assert rows == [
        ("Acme Inc", "acme", "inferred:Acme Inc:acme", "salesnav_automated", "Collected via query: find acme", "pending"),
        (
            "Beta Labs",
            "beta-labs",
            "inferred:Beta Labs:beta-labs",
            "salesnav_automated",
            "Collected via query: find acme",
            "pending",
        ),
    ]
