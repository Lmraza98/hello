import sqlite3
from contextlib import contextmanager

from services.linkedin.salesnav.flows.company_collection import SalesNavCompanyCollectionFlow
from services.linkedin.salesnav.filter_parser import SalesNavFilterParser



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


def test_collector_save_companies_without_vertical_column(monkeypatch, tmp_path):
    db_path = tmp_path / "compat.db"
    conn = sqlite3.connect(db_path)
    conn.execute(
        """
        CREATE TABLE targets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            domain TEXT UNIQUE,
            company_name TEXT,
            source TEXT,
            notes TEXT,
            status TEXT
        )
        """
    )
    conn.commit()
    conn.close()

    monkeypatch.setattr("services.linkedin.salesnav.flows.company_collection.db.get_db", _db_ctx(str(db_path)))

    collector = SalesNavCompanyCollectionFlow.__new__(SalesNavCompanyCollectionFlow)
    saved = collector._save_companies_to_db(
        [{"company_name": "Zco Corporation", "industry": "Software Development"}],
        "Find companies like Zco",
    )
    assert saved == 1

    conn = sqlite3.connect(db_path)
    row = conn.execute(
        "SELECT company_name, domain, source, status FROM targets WHERE company_name = ?",
        ("Zco Corporation",),
    ).fetchone()
    conn.close()
    assert row is not None
    assert row[0] == "Zco Corporation"
    assert row[1] == "zco-corporation"
    assert row[2] == "salesnav_automated"
    assert row[3] == "pending"


def test_filter_parser_lookup_company_profile_without_vertical_column(monkeypatch, tmp_path):
    db_path = tmp_path / "compat.db"
    conn = sqlite3.connect(db_path)
    conn.execute(
        """
        CREATE TABLE targets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            domain TEXT UNIQUE,
            company_name TEXT
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE linkedin_contacts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            company_name TEXT,
            domain TEXT
        )
        """
    )
    conn.execute(
        "INSERT INTO targets(domain, company_name) VALUES (?, ?)",
        ("zco.com", "Zco Corporation"),
    )
    conn.commit()
    conn.close()

    monkeypatch.setattr("services.salesnav.filter_parser.db.get_db", _db_ctx(str(db_path)))

    parser = SalesNavFilterParser.__new__(SalesNavFilterParser)
    profile = parser._lookup_company_profile("Zco Corporation")
    assert profile is not None
    assert profile["company_name"] == "Zco Corporation"
    assert profile["domain"] == "zco.com"
    assert profile["vertical"] is None


def test_filter_parser_target_market_heuristic_overrides_industry():
    parser = SalesNavFilterParser.__new__(SalesNavFilterParser)
    filters = {
        "industry": ["Technology, Information and Internet"],
        "headquarters_location": [],
        "company_headcount": None,
        "annual_revenue": None,
        "company_headcount_growth": None,
        "number_of_followers": None,
        "keywords": ["AI-powered cybersecurity SaaS", "healthcare"],
    }

    out = parser._apply_target_market_heuristics(
        "SaaS companies specializing in AI-powered cybersecurity for the healthcare industry",
        filters,
    )

    assert out["industry"] == ["Hospitals and Health Care"]
    assert "healthcare" not in [str(x).lower() for x in out.get("keywords", [])]
