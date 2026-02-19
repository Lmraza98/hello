"""
GPT-4 Filter Parser: Converts natural language queries into LinkedIn Sales Navigator filter specifications.
"""
import json
import re
from typing import Dict, List, Optional
from openai import OpenAI

import config
import database as db
from api.observability import compute_openai_cost_usd, record_cost


class SalesNavFilterParser:
    """
    Uses GPT-4 to parse natural language queries into structured Sales Navigator filters.
    
    Example:
        Input: "Construction companies in New England"
        Output: {
            "industry": ["Construction"],
            "headquarters_location": [
                "Massachusetts, United States",
                "New Hampshire, United States",
                "Vermont, United States",
                "Maine, United States",
                "Connecticut, United States",
                "Rhode Island, United States"
            ],
            "company_headcount": None,
            "annual_revenue": None,
            ...
        }
    """
    
    def __init__(self):
        if not config.OPENAI_API_KEY:
            raise ValueError("OPENAI_API_KEY not configured in config.py")
        self.client = OpenAI(api_key=config.OPENAI_API_KEY)

    _COMPARATIVE_MARKERS = [
        " like ",
        " similar to ",
        " comparable to ",
        " such as ",
    ]
    _TRAILING_STOP_MARKERS = [
        " in ",
        " with ",
        " for ",
        " from ",
        " near ",
        " around ",
        " where ",
        " that ",
    ]
    _TARGET_MARKET_PATTERN = re.compile(
        r"\bfor\s+(?:the\s+)?([a-z0-9&,\-/ ]+?)\s+(?:industry|sector|market)\b",
        flags=re.IGNORECASE,
    )
    _INDUSTRY_CANONICAL_MAP = {
        # --------------------
        # Healthcare
        # --------------------
        "healthcare": "Hospitals and Health Care",
        "health care": "Hospitals and Health Care",
        "hospital": "Hospitals and Health Care",
        "hospitals": "Hospitals and Health Care",
        "hospitals and health care": "Hospitals and Health Care",
        "medical": "Hospitals and Health Care",
        "medicine": "Hospitals and Health Care",
        "medical practice": "Medical Practices",
        "medical practices": "Medical Practices",
        "clinic": "Medical Practices",
        "clinics": "Medical Practices",
        "outpatient": "Outpatient Care Centers",
        "outpatient care": "Outpatient Care Centers",
        "home health": "Home Health Care Services",
        "home health care": "Home Health Care Services",
        "nursing home": "Nursing Homes and Residential Care Facilities",
        "nursing homes": "Nursing Homes and Residential Care Facilities",
        "residential care": "Nursing Homes and Residential Care Facilities",
        "mental health": "Mental Health Care",
        "therapist": "Physical, Occupational and Speech Therapists",
        "therapy": "Physical, Occupational and Speech Therapists",
        "physical therapy": "Physical, Occupational and Speech Therapists",
        "occupational therapy": "Physical, Occupational and Speech Therapists",
        "speech therapy": "Physical, Occupational and Speech Therapists",
        "ambulance": "Ambulance Services",
        "laboratory": "Medical and Diagnostic Laboratories",
        "lab": "Medical and Diagnostic Laboratories",
        "medical device": "Medical Device",
        "medical equipment": "Medical Equipment Manufacturing",
        "pharma": "Pharmaceutical Manufacturing",
        "pharmaceutical": "Pharmaceutical Manufacturing",
        "biotech": "Biotechnology Research",
        "biotechnology": "Biotechnology Research",
        "veterinary": "Veterinary",
        "vet": "Veterinary",
        "optometry": "Optometrists",
        "optometrist": "Optometrists",
        "chiropractic": "Chiropractors",
        "chiropractor": "Chiropractors",

        # --------------------
        # Technology / Software / IT
        # --------------------
        "technology": "Technology, Information and Internet",
        "tech": "Technology, Information and Internet",
        "technology, information and internet": "Technology, Information and Internet",
        "technology, information and media": "Technology, Information and Media",
        "internet": "Technology, Information and Internet",
        "online media": "Online Media",
        "information services": "Information Services",

        "software": "Software Development",
        "software development": "Software Development",
        "saas": "Software Development",
        "application software": "Software Development",
        "embedded software": "Embedded Software Products",
        "embedded software products": "Embedded Software Products",
        "mobile software": "Mobile Computing Software Products",
        "mobile computing": "Mobile Computing Software Products",
        "desktop software": "Desktop Computing Software Products",
        "desktop computing": "Desktop Computing Software Products",

        "it services": "IT Services and IT Consulting",
        "it consulting": "IT Services and IT Consulting",
        "information technology services": "Information Technology & Services",
        "information technology & services": "Information Technology & Services",
        "it": "IT Services and IT Consulting",
        "computer and network security": "Computer and Network Security",
        "network security": "Computer and Network Security",
        "data security": "Data Security Software Products",
        "data security software": "Data Security Software Products",
        "business intelligence": "Business Intelligence Platforms",
        "bi platforms": "Business Intelligence Platforms",

        "computer hardware": "Computer Hardware",
        "computer hardware manufacturing": "Computer Hardware Manufacturing",
        "computers and electronics": "Computers and Electronics Manufacturing",
        "computer networking": "Computer Networking",
        "computer networking products": "Computer Networking Products",
        "telecom": "Telecommunications",
        "telecommunications": "Telecommunications",
        "wireless": "Wireless Services",
        "telecommunications carriers": "Telecommunications Carriers",

        "semiconductors": "Semiconductors",
        "semiconductor": "Semiconductors",
        "semiconductor manufacturing": "Semiconductor Manufacturing",

        # --------------------
        # Construction / Engineering / Architecture
        # --------------------
        "construction": "Construction",
        "building construction": "Building Construction",
        "residential construction": "Residential Building Construction",
        "nonresidential construction": "Nonresidential Building Construction",
        "civil engineering": "Civil Engineering",
        "architecture": "Architecture and Planning",
        "architecture and planning": "Architecture and Planning",
        "engineering services": "Engineering Services",
        "industrial automation": "Industrial Automation",
        "industrial machinery": "Industrial Machinery Manufacturing",
        "machinery manufacturing": "Machinery Manufacturing",

        # --------------------
        # Finance
        # --------------------
        "finance": "Financial Services",
        "financial services": "Financial Services",
        "fintech": "Financial Services",
        "bank": "Banking",
        "banks": "Banking",
        "banking": "Banking",
        "insurance": "Insurance",
        "accounting": "Accounting",
        "capital markets": "Capital Markets",
        "investment banking": "Investment Banking",
        "investment management": "Investment Management",
        "venture capital": "Venture Capital and Private Equity Principals",
        "private equity": "Venture Capital and Private Equity Principals",

        # --------------------
        # Manufacturing (general + notable verticals)
        # --------------------
        "manufacturing": "Manufacturing",
        "industrial manufacturing": "Manufacturing",
        "chemical manufacturing": "Chemical Manufacturing",
        "plastics manufacturing": "Plastics Manufacturing",
        "textile manufacturing": "Textile Manufacturing",
        "food manufacturing": "Food and Beverage Manufacturing",
        "food & beverage": "Food & Beverages",
        "beverage manufacturing": "Beverage Manufacturing",
        "medical equipment manufacturing": "Medical Equipment Manufacturing",
        "consumer electronics": "Consumer Electronics",
        "automotive": "Automotive",
        "motor vehicle manufacturing": "Motor Vehicle Manufacturing",
        "motor vehicle parts": "Motor Vehicle Parts Manufacturing",
        "aviation": "Aviation & Aerospace",
        "aerospace": "Aviation & Aerospace",
        "aviation and aerospace components": "Aviation and Aerospace Component Manufacturing",
        "defense": "Defense & Space",
        "defense and space": "Defense & Space",
        "defense & space manufacturing": "Defense and Space Manufacturing",
        "space research": "Space Research and Technology",
        "robotics": "Robotics Engineering",
        "robot manufacturing": "Robot Manufacturing",

        # --------------------
        # Real estate
        # --------------------
        "real estate": "Real Estate",
        "commercial real estate": "Commercial Real Estate",
        "property management": "Real Estate",
        "leasing": "Real Estate and Equipment Rental Services",
        "leasing residential": "Leasing Residential Real Estate",
        "leasing non-residential": "Leasing Non-residential Real Estate",

        # --------------------
        # Legal
        # --------------------
        "law": "Law Practice",
        "law practice": "Law Practice",
        "legal": "Legal Services",
        "legal services": "Legal Services",

        # --------------------
        # Consulting / Professional services
        # --------------------
        "consulting": "Business Consulting and Services",
        "business consulting": "Business Consulting and Services",
        "business consulting and services": "Business Consulting and Services",
        "operations consulting": "Operations Consulting",
        "strategic management": "Strategic Management Services",
        "market research": "Market Research",
        "advertising": "Advertising Services",
        "public relations": "Public Relations and Communications Services",

        # --------------------
        # Logistics / Transportation
        # --------------------
        "logistics": "Transportation, Logistics, Supply Chain and Storage",
        "supply chain": "Transportation, Logistics, Supply Chain and Storage",
        "transportation": "Transportation, Logistics, Supply Chain and Storage",
        "warehousing": "Warehousing and Storage",
        "warehousing and storage": "Warehousing and Storage",
        "truck transportation": "Truck Transportation",
        "rail": "Rail Transportation",
        "maritime": "Maritime Transportation",

        # --------------------
        # Energy / Utilities
        # --------------------
        "utilities": "Utilities",
        "utility": "Utilities",
        "oil and gas": "Oil and Gas",
        "oil & gas": "Oil and Gas",
        "oil extraction": "Oil Extraction",
        "natural gas extraction": "Natural Gas Extraction",
        "renewable energy": "Renewable Energy Power Generation",
        "renewables": "Renewable Energy Power Generation",
        "solar": "Solar Electric Power Generation",
        "wind": "Wind Electric Power Generation",

        # --------------------
        # Retail / Hospitality
        # --------------------
        "retail": "Retail",
        "ecommerce": "Online and Mail Order Retail",
        "online retail": "Online and Mail Order Retail",
        "restaurants": "Restaurants",
        "restaurant": "Restaurants",
        "hospitality": "Hospitality",
        "travel": "Travel Arrangements",

        # --------------------
        # Education / Nonprofit / Government
        # --------------------
        "education": "Education",
        "higher education": "Higher Education",
        "primary education": "Primary and Secondary Education",
        "nonprofit": "Non-profit Organizations",
        "non-profit": "Non-profit Organizations",
        "government": "Government Administration",
        "government administration": "Government Administration",
    }


    def _normalize_spaces(self, value: str) -> str:
        return " ".join(value.strip().split())

    def _strip_wrapping_quotes(self, value: str) -> str:
        text = value.strip()
        while text and text[0] in {'"', "'", "`"}:
            text = text[1:].strip()
        while text and text[-1] in {'"', "'", "`"}:
            text = text[:-1].strip()
        return text

    def _split_reference_candidates(self, value: str) -> List[str]:
        # Split on commas and boolean conjunctions without regex.
        normalized = self._normalize_spaces(value)
        pieces: List[str] = []
        current = []
        tokens = normalized.split(" ")
        i = 0
        while i < len(tokens):
            tok = tokens[i]
            lower = tok.lower().strip(",")
            is_comma_break = tok.endswith(",")
            is_joiner = lower in {"and", "or"}
            if is_comma_break or is_joiner:
                candidate = self._strip_wrapping_quotes(" ".join(current).strip(" ,.;"))
                if candidate:
                    pieces.append(candidate)
                current = []
                i += 1
                continue
            current.append(tok.strip(" ,.;"))
            i += 1
        candidate = self._strip_wrapping_quotes(" ".join(current).strip(" ,.;"))
        if candidate:
            pieces.append(candidate)
        return pieces

    def _truncate_at_stop_marker(self, value: str) -> str:
        lower = value.lower()
        best = len(value)
        for marker in self._TRAILING_STOP_MARKERS:
            idx = lower.find(marker)
            if idx >= 0:
                best = min(best, idx)
        return value[:best].strip(" ,.;")

    def _is_comparative_query(self, query: str) -> bool:
        lower = query.lower()
        return any(marker.strip() in lower for marker in self._COMPARATIVE_MARKERS)

    def _extract_reference_entities(self, query: str) -> List[str]:
        normalized_query = f" {self._normalize_spaces(query)} "
        lower_query = normalized_query.lower()
        refs: List[str] = []

        for marker in self._COMPARATIVE_MARKERS:
            start = 0
            while True:
                idx = lower_query.find(marker, start)
                if idx < 0:
                    break
                after = normalized_query[idx + len(marker):].strip()
                if after:
                    truncated = self._truncate_at_stop_marker(after)
                    for part in self._split_reference_candidates(truncated):
                        lowered = part.lower()
                        if lowered.startswith("the "):
                            part = part[4:].strip()
                        elif lowered.startswith("a "):
                            part = part[2:].strip()
                        elif lowered.startswith("an "):
                            part = part[3:].strip()
                        if len(part) >= 2:
                            refs.append(part)
                start = idx + len(marker)

        # unique preserve order
        seen = set()
        unique = []
        for r in refs:
            key = r.lower()
            if key in seen:
                continue
            seen.add(key)
            unique.append(r)
        return unique

    def _lookup_company_profile(self, name: str) -> Optional[Dict[str, Optional[str]]]:
        def _table_columns(cursor, table_name: str) -> set[str]:
            cursor.execute(f"PRAGMA table_info({table_name})")
            return {str(row[1]).lower() for row in cursor.fetchall()}

        def _safe_select_company(cursor, table_name: str, exact_name: str) -> Optional[tuple]:
            cols = _table_columns(cursor, table_name)
            has_vertical = "vertical" in cols
            vertical_col = "vertical" if has_vertical else "NULL AS vertical"
            cursor.execute(
                f"""
                SELECT company_name, {vertical_col}, domain
                FROM {table_name}
                WHERE LOWER(company_name) = LOWER(?)
                LIMIT 1
                """,
                (exact_name,),
            )
            row = cursor.fetchone()
            if row:
                return row
            cursor.execute(
                f"""
                SELECT company_name, {vertical_col}, domain
                FROM {table_name}
                WHERE LOWER(company_name) LIKE LOWER(?)
                ORDER BY LENGTH(company_name) ASC
                LIMIT 1
                """,
                (f"%{exact_name}%",),
            )
            return cursor.fetchone()

        with db.get_db() as conn:
            cursor = conn.cursor()
            # Exact + fuzzy from targets.
            row = _safe_select_company(cursor, "targets", name)

            # Fallback to known contact-company records.
            if not row:
                row = _safe_select_company(cursor, "linkedin_contacts", name)

        if not row:
            return None
        return {
            "company_name": row[0],
            "vertical": row[1],
            "domain": row[2],
        }

    def _apply_reference_grounding(self, query: str, filters: Dict) -> Dict:
        """
        General comparative-query grounding:
        - Detect exemplar entities (e.g., "like Zco Corporation")
        - Resolve known profile fields from local DB
        - Promote resolved fields into structured filters
        - Remove exemplar proper-noun keywords that over-constrain discovery
        """
        comparative = self._is_comparative_query(query)
        references = self._extract_reference_entities(query)
        if not comparative or not references:
            return filters

        profiles = []
        for ref in references:
            profile = self._lookup_company_profile(ref)
            if profile:
                profiles.append(profile)

        if not profiles:
            print(f"[Filter Parser] Comparative query detected but no local reference profile found: {references}")
            return filters

        industries: List[str] = []
        for p in profiles:
            vertical = (p.get("vertical") or "").strip()
            if vertical:
                industries.append(vertical)

        # promote grounded industries when parser left industry empty
        if industries and not filters.get("industry"):
            # unique preserve order
            deduped = []
            seen = set()
            for i in industries:
                k = i.lower()
                if k in seen:
                    continue
                seen.add(k)
                deduped.append(i)
            filters["industry"] = deduped[:3]

        keywords = filters.get("keywords") or []
        if not isinstance(keywords, list):
            keywords = [keywords] if keywords else []

        # remove exemplar names from keyword search to avoid exact-company bias
        blocked = {x.lower() for x in references}
        blocked.update({(p.get("company_name") or "").lower() for p in profiles if p.get("company_name")})
        keywords = [k for k in keywords if isinstance(k, str) and k.strip() and k.strip().lower() not in blocked]

        # if keywords emptied out, seed with grounded industries for "like X" discovery
        if not keywords and filters.get("industry"):
            keywords = [str(v) for v in (filters.get("industry") or [])[:2] if isinstance(v, str) and v.strip()]

        filters["keywords"] = keywords
        print(
            "[Filter Parser] Applied reference grounding:",
            {
                "references": references,
                "resolved_companies": [p.get("company_name") for p in profiles],
                "industry": filters.get("industry"),
                "keywords": filters.get("keywords"),
            },
        )
        return filters

    def _canonicalize_industry(self, raw: str) -> str:
        value = self._normalize_spaces(raw).strip(" ,.;").lower()
        if not value:
            return ""
        return self._INDUSTRY_CANONICAL_MAP.get(value, raw.strip())

    def _apply_target_market_heuristics(self, query: str, filters: Dict) -> Dict:
        """
        Deterministic correction for "X for the Y industry/sector/market" phrasing.
        This ensures Y is treated as target industry even when the model overfits on
        technology words in X (e.g. SaaS/AI/cybersecurity -> Technology).
        """
        match = self._TARGET_MARKET_PATTERN.search(query or "")
        if not match:
            return filters

        target_raw = self._normalize_spaces(match.group(1) or "")
        if not target_raw:
            return filters

        target_industry = self._canonicalize_industry(target_raw)
        if target_industry:
            filters["industry"] = [target_industry]

        raw_keywords = filters.get("keywords") or []
        if not isinstance(raw_keywords, list):
            raw_keywords = [raw_keywords] if raw_keywords else []
        target_tokens = {t for t in re.split(r"[^a-z0-9]+", target_raw.lower()) if t}
        cleaned_keywords: List[str] = []
        for kw in raw_keywords:
            if not isinstance(kw, str):
                continue
            kw_clean = self._normalize_spaces(kw)
            if not kw_clean:
                continue
            kw_tokens = {t for t in re.split(r"[^a-z0-9]+", kw_clean.lower()) if t}
            if kw_tokens and kw_tokens.issubset(target_tokens):
                continue
            cleaned_keywords.append(kw_clean)
        filters["keywords"] = cleaned_keywords
        return filters
    
    def parse_query(self, query: str) -> Dict:
        """
        Parse a natural language query into Sales Navigator filter specifications.
        
        Args:
            query: Natural language query like "Construction companies in New England"
            
        Returns:
            Dictionary with filter specifications
        """
        prompt = f"""You are a LinkedIn Sales Navigator filter expert. Convert the following natural language query into structured filter specifications for LinkedIn Sales Navigator Account search.

Query: "{query}"

CRITICAL RULES for decomposition:
- "industry" is the TARGET MARKET the companies SERVE (e.g., "for healthcare" => industry = "Healthcare").
- "keywords" describe WHAT the companies DO or their technology (e.g., "AI-powered cybersecurity SaaS" => keywords).
- NEVER put the target market in keywords. Put it in industry.
- When the query says "X for the Y industry", Y is the industry and X is keywords.
- Example: "SaaS companies specializing in AI-powered cybersecurity for the healthcare industry"
  => industry: ["Healthcare"], keywords: ["AI cybersecurity SaaS"]
- Example: "Construction companies in New England"
  => industry: ["Construction"], headquarters_location: [states], keywords: []
- Example: "fintech companies"
  => industry: ["Financial Services"], keywords: ["fintech"]

Available filter categories:
1. Industry - use supported canonical values only:
   - "Hospitals and Health Care"
   - "Optometrists"
   - "Chiropractors"
2. Headquarters Location - currently URL-mapped canonical value:
   - "United States"
3. Company Headcount - one of:
   - "1-10", "11-50", "51-200", "201-500", "501-1,000", "1,001-5,000", "5,001-10,000", "10,001+"
4. Annual Revenue - numeric range in millions only (for URL range encoding), e.g.:
   - "1-10", "10-50", "50-100"
5. Company Headcount Growth - numeric percent range only, e.g.:
   - "1-19%", "10-20%"
6. Number of Followers - one of:
   - "1-50", "51-100", "101-1000", "1001-5000", "5001+"
7. Fortune - one of:
   - "Fortune 50", "Fortune 51-100", "Fortune 101-250", "Fortune 251-500", "Fortune 500"
8. Department Headcount - "<Department> <min>-<max>", e.g.:
   - "Marketing 1-10"
9. Department Headcount Growth - "<Department> <min>-<max>%", e.g.:
   - "Marketing 1-19%"
10. Job opportunities:
   - "Hiring on Linkedin"
11. Recent activities:
   - "Senior leadership changes in last 3 months"
12. Connection:
   - "1st Degree Connections"

Industry name mapping (use EXACT supported names):
- "Healthcare" or "health" => "Hospitals and Health Care"
- "Technology" or "tech" or "software" => "Technology, Information and Internet"
- "Construction" => "Construction"
- "Finance" or "fintech" or "banking" => "Financial Services"
- "Manufacturing" => "Manufacturing"
- "Real Estate" => "Real Estate"

Special handling:
- If a requested filter cannot be represented in the supported URL-mapped values above, leave it null/empty.
- Do NOT invent unsupported categories or values.

Return a JSON object with this structure:
{{
    "industry": ["Exact LinkedIn Industry Name"],
    "headquarters_location": ["State, United States", ...],
    "company_headcount": "1-10" or null,
    "annual_revenue": "1M-10M" or null,
    "company_headcount_growth": "Growing" or null,
    "number_of_followers": "1000+" or null,
    "keywords": ["concise", "search", "terms"]
}}

If a filter category is not specified in the query, set it to null.
Keywords should be 2-4 concise terms, NOT the full original query.
Return ONLY valid JSON, no additional text."""

        try:
            response = self.client.chat.completions.create(
                model=config.LLM_MODEL_SMART,  # Use GPT-4o for better reasoning
                messages=[
                    {
                        "role": "system",
                        "content": "You are a LinkedIn Sales Navigator filter expert. Always return valid JSON only."
                    },
                    {
                        "role": "user",
                        "content": prompt
                    }
                ],
                response_format={"type": "json_object"},
                temperature=0.1  # Low temperature for consistent parsing
            )
            usage = response.usage
            prompt_tokens = usage.prompt_tokens if usage else 0
            completion_tokens = usage.completion_tokens if usage else 0
            record_cost(
                provider="openai",
                model=config.LLM_MODEL_SMART,
                feature="salesnav",
                endpoint="services.web_automation.linkedin.salesnav.filter_parser.parse_query",
                usd=compute_openai_cost_usd(config.LLM_MODEL_SMART, prompt_tokens, completion_tokens),
                input_tokens=prompt_tokens,
                output_tokens=completion_tokens,
            )
            
            result_text = response.choices[0].message.content.strip()
            filters = json.loads(result_text)
            
            # Validate and clean the filters
            validated = self._validate_filters(filters)
            grounded = self._apply_reference_grounding(query, validated)
            corrected = self._apply_target_market_heuristics(query, grounded)
            return self._validate_filters(corrected)
            
        except json.JSONDecodeError as e:
            print(f"[Filter Parser] JSON decode error: {e}")
            print(f"[Filter Parser] Response was: {result_text}")
            raise ValueError(f"Failed to parse GPT-4 response as JSON: {e}")
        except Exception as e:
            print(f"[Filter Parser] Error: {e}")
            raise
    
    def _validate_filters(self, filters: Dict) -> Dict:
        """Validate and clean filter specifications."""
        validated = {
            "industry": filters.get("industry") or [],
            "headquarters_location": filters.get("headquarters_location") or [],
            "company_headcount": filters.get("company_headcount"),
            "annual_revenue": filters.get("annual_revenue"),
            "company_headcount_growth": filters.get("company_headcount_growth"),
            "number_of_followers": filters.get("number_of_followers"),
            "keywords": filters.get("keywords") or []
        }
        
        # Ensure lists are actually lists
        if not isinstance(validated["industry"], list):
            validated["industry"] = [validated["industry"]] if validated["industry"] else []
        if not isinstance(validated["headquarters_location"], list):
            validated["headquarters_location"] = [validated["headquarters_location"]] if validated["headquarters_location"] else []
        if not isinstance(validated["keywords"], list):
            validated["keywords"] = [validated["keywords"]] if validated["keywords"] else []
        
        return validated


def parse_salesnav_query(query: str) -> Dict:
    """
    Convenience function to parse a query.
    
    Args:
        query: Natural language query
        
    Returns:
        Filter specifications dictionary
    """
    parser = SalesNavFilterParser()
    return parser.parse_query(query)


def infer_company_vertical(company_name: str, domain: str | None = None) -> str | None:
    """
    Infer a company vertical using deterministic SalesNav parser mappings.

    This uses the canonical industry mapping in `SalesNavFilterParser` and does
    not require LLM calls or parser client initialization.
    """
    if not company_name or not company_name.strip():
        return None

    parser = SalesNavFilterParser.__new__(SalesNavFilterParser)
    haystacks: List[str] = [company_name]
    if domain and domain.strip():
        normalized_domain = re.sub(r"[-_.]", " ", domain.strip().lower())
        haystacks.append(normalized_domain)

    joined = " ".join(haystacks).lower()
    joined = re.sub(r"[^a-z0-9&/,+ -]+", " ", joined)
    joined = " ".join(joined.split())
    if not joined:
        return None

    keys = sorted(SalesNavFilterParser._INDUSTRY_CANONICAL_MAP.keys(), key=len, reverse=True)
    for key in keys:
        key_norm = parser._normalize_spaces(key).lower()
        if not key_norm:
            continue
        if re.search(rf"(^|\b){re.escape(key_norm)}(\b|$)", joined):
            return SalesNavFilterParser._INDUSTRY_CANONICAL_MAP[key]

    return None


def infer_company_vertical_if_missing(
    company_name: str,
    domain: str | None = None,
    existing_vertical: str | None = None,
) -> str | None:
    """Infer vertical only when existing value is missing/empty."""
    if existing_vertical and existing_vertical.strip():
        return existing_vertical
    return infer_company_vertical(company_name=company_name, domain=domain)


def backfill_missing_verticals(batch_size: int = 50) -> dict:
    """Backfill missing `targets.vertical` using parser-based deterministic mapping."""
    classified = 0
    failed = 0

    with db.get_db() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT id, company_name, domain FROM targets "
            "WHERE vertical IS NULL OR TRIM(vertical) = '' "
            "ORDER BY id "
            f"LIMIT {int(batch_size)}"
        )
        rows = [dict(row) for row in cursor.fetchall()]

    total = len(rows)
    for row in rows:
        vertical = infer_company_vertical(row["company_name"], row.get("domain"))
        if vertical:
            with db.get_db() as conn:
                conn.cursor().execute(
                    "UPDATE targets SET vertical = ? WHERE id = ?",
                    (vertical, row["id"]),
                )
            classified += 1
        else:
            failed += 1

    return {"total": total, "classified": classified, "failed": failed}


