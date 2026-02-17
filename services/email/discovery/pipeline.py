"""Orchestration pipeline for email pattern discovery."""

from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
import csv
import re
import threading
import time
from typing import Dict, Iterable, List, Optional, Tuple

import config
import database as db
from services.email.discovery.generation import generate_email
from services.email.discovery.llm import analyze_pattern_with_llm
from services.email.discovery.models import (
    CompanyTarget,
    ContactEmailUpdate,
    ContactExportRow,
    DEFAULT_PATTERN_CONFIDENCE,
    LinkedInContact,
    PatternMatch,
)
from services.email.discovery.search import search_company_emails
from services.identity.name_normalizer import normalize_name


class _RateLimiter:
    """Simple thread-safe fixed-interval rate limiter."""

    def __init__(self, min_interval_seconds: float):
        self._min_interval_seconds = min_interval_seconds
        self._lock = threading.Lock()
        self._last_call_ts = 0.0

    def wait(self) -> None:
        with self._lock:
            elapsed = time.monotonic() - self._last_call_ts
            if elapsed < self._min_interval_seconds:
                time.sleep(self._min_interval_seconds - elapsed)
            self._last_call_ts = time.monotonic()


def _normalize_company_key(company: Optional[str], domain: Optional[str]) -> str:
    raw = (company or domain or "").strip().casefold()
    return re.sub(r"\s+", " ", raw)


def _sanitize_domain(domain: Optional[str]) -> Optional[str]:
    if not domain:
        return None

    clean = domain.strip().lower()
    if clean.startswith("@"):
        clean = clean[1:]
    clean = clean.strip(".")
    if not clean:
        return None

    if "." in clean:
        return clean

    slug = re.sub(r"[^a-z0-9-]", "", clean)
    if not slug:
        return None
    return f"{slug.replace('-', '')}.com"


def _resolve_pattern_company(company_name: str, domain_hint: Optional[str]) -> CompanyTarget:
    clean_company = (company_name or "").strip()
    clean_domain = _sanitize_domain(domain_hint)
    return CompanyTarget(
        company=clean_company,
        company_key=_normalize_company_key(clean_company, clean_domain),
        domain_hint=clean_domain,
    )


def _safe_confidence(value: object) -> float:
    try:
        confidence = float(value)
    except (TypeError, ValueError):
        return DEFAULT_PATTERN_CONFIDENCE
    return max(0.0, min(1.0, confidence))


def _discover_pattern(target: CompanyTarget) -> PatternMatch:
    print(f"[EmailDiscoverer] Discovering pattern for {target.company}...")
    search_results = search_company_emails(target.company, target.domain_hint)

    if search_results.get("error"):
        error = str(search_results.get("error"))
        print(f"[EmailDiscoverer] Search failed: {error}")
        return PatternMatch.fallback(
            company=target.company,
            company_key=target.company_key,
            domain_hint=target.domain_hint,
            reasoning="Search failed, using default",
        )

    analysis = analyze_pattern_with_llm(target.company, target.domain_hint or target.company, search_results)
    discovered_domain = _sanitize_domain(analysis.get("domain"))

    result = PatternMatch(
        company=target.company,
        company_key=target.company_key,
        domain=discovered_domain or target.domain_hint,
        domain_discovered=bool(discovered_domain),
        pattern=analysis.get("pattern", "first.last"),
        confidence=_safe_confidence(analysis.get("confidence", DEFAULT_PATTERN_CONFIDENCE)),
        examples=analysis.get("examples_found", []),
        reasoning=analysis.get("reasoning", ""),
    )

    domain_status = "ok" if result.domain_discovered else "?"
    print(
        f"[EmailDiscoverer] {result.company}: {result.pattern} @ {result.domain} [{domain_status}] "
        f"(confidence: {result.confidence})"
    )
    return result


def discover_email_pattern(company_name: str, domain_hint: str = None) -> Dict:
    """
    Full pipeline: search web + analyze with LLM to discover email pattern AND domain.
    """
    target = _resolve_pattern_company(company_name, domain_hint)
    return _discover_pattern(target).to_public_dict()


def _date_filter_value(today_only: bool) -> Optional[str]:
    if not today_only:
        return None
    return datetime.now().strftime("%Y-%m-%d")


def _fetch_company_targets(cursor, scraped_date: Optional[str]) -> List[CompanyTarget]:
    query = """
        SELECT DISTINCT
            COALESCE(company_name, domain) AS company,
            domain
        FROM linkedin_contacts
        WHERE name IS NOT NULL
    """
    params: List[str] = []
    if scraped_date:
        query += " AND DATE(scraped_at) = ?"
        params.append(scraped_date)

    cursor.execute(query, params)
    rows = cursor.fetchall()

    companies: List[CompanyTarget] = []
    for row in rows:
        company = (row["company"] or row["domain"] or "").strip()
        if not company:
            continue
        domain_hint = _sanitize_domain(row["domain"])
        companies.append(
            CompanyTarget(
                company=company,
                company_key=_normalize_company_key(company, row["domain"]),
                domain_hint=domain_hint,
            )
        )

    return companies


def _discover_patterns_for_companies(companies: List[CompanyTarget], workers: int) -> Dict[str, PatternMatch]:
    patterns_by_key: Dict[str, PatternMatch] = {}
    completed = 0

    rate_limiter = _RateLimiter(min_interval_seconds=0.3)
    actual_workers = min(max(workers, 1), 3)
    print(f"[EmailDiscoverer] Using {actual_workers} workers (rate-limited)")

    def _discover_with_limit(target: CompanyTarget) -> PatternMatch:
        rate_limiter.wait()
        return _discover_pattern(target)

    with ThreadPoolExecutor(max_workers=actual_workers) as executor:
        futures = {executor.submit(_discover_with_limit, company): company for company in companies}
        for future in as_completed(futures):
            target = futures[future]
            try:
                match = future.result()
            except Exception as exc:
                print(f"[EmailDiscoverer] Error for {target.company}: {exc}")
                match = PatternMatch.fallback(
                    company=target.company,
                    company_key=target.company_key,
                    domain_hint=target.domain_hint,
                    reasoning=f"Discovery error: {exc}",
                )

            patterns_by_key[match.company_key] = match
            completed += 1
            if completed % 5 == 0:
                print(f"[EmailDiscoverer] Progress: {completed}/{len(companies)} companies")

    return patterns_by_key


def _fetch_contacts(cursor, scraped_date: Optional[str]) -> List[LinkedInContact]:
    query = """
        SELECT
            id,
            COALESCE(company_name, domain) AS company,
            domain,
            name,
            title
        FROM linkedin_contacts
        WHERE name IS NOT NULL
    """
    params: List[str] = []
    if scraped_date:
        query += " AND DATE(scraped_at) = ?"
        params.append(scraped_date)

    query += " ORDER BY company, name"
    cursor.execute(query, params)
    rows = cursor.fetchall()

    contacts: List[LinkedInContact] = []
    for row in rows:
        company = (row["company"] or row["domain"] or "").strip()
        contacts.append(
            LinkedInContact(
                contact_id=row["id"],
                company=company,
                company_key=_normalize_company_key(company, row["domain"]),
                domain_raw=row["domain"],
                name=row["name"],
                title=row["title"],
            )
        )

    return contacts


def _resolve_domain_for_contact(pattern: PatternMatch, contact: LinkedInContact) -> Tuple[Optional[str], bool]:
    if pattern.domain:
        return pattern.domain, pattern.domain_discovered
    return _sanitize_domain(contact.domain_raw), False


def _build_contact_outputs(
    contacts: Iterable[LinkedInContact],
    patterns_by_key: Dict[str, PatternMatch],
) -> Tuple[List[ContactExportRow], List[ContactEmailUpdate], int]:
    rows: List[ContactExportRow] = []
    updates: List[ContactEmailUpdate] = []
    emails_generated = 0

    for contact in contacts:
        match = patterns_by_key.get(contact.company_key)
        if not match:
            match = PatternMatch.fallback(
                company=contact.company,
                company_key=contact.company_key,
                domain_hint=_sanitize_domain(contact.domain_raw),
                reasoning="No company-level pattern available, using default",
            )

        domain, domain_verified = _resolve_domain_for_contact(match, contact)
        email = generate_email(contact.name, match.pattern, domain)
        if email:
            updates.append(
                ContactEmailUpdate(
                    contact_id=contact.contact_id,
                    email=email,
                    pattern=match.pattern,
                )
            )
            emails_generated += 1

        normalized = normalize_name(contact.name)
        rows.append(
            ContactExportRow(
                company=contact.company,
                name=contact.name,
                first_name=normalized.first,
                last_name=normalized.last,
                title=contact.title,
                email=email,
                pattern=match.pattern,
                confidence=match.confidence,
                domain=domain,
                domain_verified=domain_verified,
            )
        )

    return rows, updates, emails_generated


def _apply_contact_updates(cursor, updates: Iterable[ContactEmailUpdate]) -> None:
    update_payload = [(u.email, u.pattern, u.contact_id) for u in updates]
    if not update_payload:
        return

    cursor.executemany(
        """
        UPDATE linkedin_contacts
        SET email_generated = ?, email_pattern = ?
        WHERE id = ?
        """,
        update_payload,
    )


def _write_contact_export(output_path: str, rows: Iterable[ContactExportRow]) -> None:
    with open(output_path, "w", newline="", encoding="utf-8") as file_handle:
        writer = csv.writer(file_handle)
        writer.writerow(
            [
                "Company",
                "Name",
                "First_Name",
                "Last_Name",
                "Title",
                "Email",
                "Email_Pattern",
                "Pattern_Confidence",
                "Domain",
                "Domain_Verified",
            ]
        )

        for row in rows:
            writer.writerow(
                [
                    row.company,
                    row.name,
                    row.first_name,
                    row.last_name,
                    row.title,
                    row.email,
                    row.pattern,
                    row.confidence,
                    row.domain,
                    "Yes" if row.domain_verified else "No",
                ]
            )


def _build_output_path(output_path: Optional[str], today_only: bool) -> str:
    if output_path:
        return output_path

    if today_only:
        date_str = datetime.now().strftime("%Y-%m-%d")
        return str(config.DATA_DIR / f"linkedin_contacts_{date_str}.csv")

    return str(config.DATA_DIR / "linkedin_contacts_with_emails.csv")


def _patterns_summary(patterns_by_key: Dict[str, PatternMatch]) -> Dict:
    summary: Dict[str, Dict] = {}
    for match in patterns_by_key.values():
        summary[match.company] = match.to_patterns_summary()
    return summary


def process_linkedin_contacts_with_patterns(
    output_path: str = None,
    today_only: bool = False,
    workers: int = 5,
) -> Dict:
    """
    Process LinkedIn contacts: discover patterns and generate emails.
    """
    output_path = _build_output_path(output_path=output_path, today_only=today_only)
    scraped_date = _date_filter_value(today_only=today_only)
    if scraped_date:
        print(f"[EmailDiscoverer] Filtering for contacts scraped on {scraped_date}")

    conn = db.get_connection()
    try:
        cursor = conn.cursor()
        companies = _fetch_company_targets(cursor, scraped_date)

        if not companies:
            print(f"[EmailDiscoverer] No contacts found{' for today' if today_only else ''}")
            return {"contacts": 0, "companies": 0, "output_path": output_path, "patterns": {}}

        print(f"[EmailDiscoverer] Processing {len(companies)} companies with {workers} parallel workers...")
        patterns_by_key = _discover_patterns_for_companies(companies, workers=workers)

        contacts = _fetch_contacts(cursor, scraped_date)
        export_rows, updates, emails_generated = _build_contact_outputs(
            contacts=contacts,
            patterns_by_key=patterns_by_key,
        )
        _apply_contact_updates(cursor, updates)
        _write_contact_export(output_path, export_rows)

        conn.commit()

        patterns = _patterns_summary(patterns_by_key)
        print(f"[EmailDiscoverer] Updated {emails_generated} contacts with generated emails in database")
        print(f"\n[EmailDiscoverer] Exported {len(export_rows)} contacts to {output_path}")
        print(f"[EmailDiscoverer] Discovered patterns for {len(patterns)} companies")

        return {
            "contacts": len(export_rows),
            "companies": len(patterns),
            "output_path": output_path,
            "patterns": patterns,
        }
    finally:
        conn.close()

