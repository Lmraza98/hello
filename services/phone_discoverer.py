"""
Phone Number Discovery using Social Engineering Patterns + Parallel Processing.

Uses SearXNG (self-hosted) for web search (free, no API costs) and GPT-4o for analysis.
Implements multiple free methods in parallel for maximum speed.
"""
import re
import json
import asyncio
from typing import Optional, Dict, List, Tuple
from concurrent.futures import ThreadPoolExecutor, as_completed
from openai import OpenAI
import requests
from bs4 import BeautifulSoup

import config
import database as db
from services.crawler import extract_phones, PHONE_PATTERN
from services.name_normalizer import normalize_name


# Enhanced phone pattern (more formats)
ENHANCED_PHONE_PATTERN = re.compile(
    r'(?:\+?1[-.\s]?)?\(?([0-9]{3})\)?[-.\s]?([0-9]{3})[-.\s]?([0-9]{4})'
    r'|(?:\+?1[-.\s]?)?([0-9]{3})[-.\s]?([0-9]{3})[-.\s]?([0-9]{4})'
    r'|ext\.?\s*([0-9]{1,5})'  # Extension patterns
)

# Phone context patterns (to match phones to names)
PHONE_CONTEXT_PATTERNS = [
    r'(?:phone|tel|direct|mobile|cell|office)[:\s]+([0-9\-\(\)\s]+)',
    r'([0-9]{3}[-.\s]?[0-9]{3}[-.\s]?[0-9]{4})',
    r'\(([0-9]{3})\)\s*([0-9]{3})[-.\s]?([0-9]{4})',
]


def normalize_phone(phone: str) -> str:
    """Normalize phone number to standard format."""
    # Remove all non-digits except extension
    digits = re.sub(r'[^\d]', '', phone)
    if len(digits) == 10:
        return f"{digits[:3]}-{digits[3:6]}-{digits[6:]}"
    elif len(digits) == 11 and digits[0] == '1':
        return f"{digits[1:4]}-{digits[4:7]}-{digits[7:]}"
    return phone.strip()


def extract_phones_with_context(text: str, name: str = None) -> List[Dict]:
    """
    Extract phones AND try to match them to a person name.
    Returns list of {phone, context, confidence}.
    """
    phones = extract_phones(text)
    if not phones:
        return []
    
    name_parts = name.lower().split() if name else []
    results = []
    
    for phone in phones:
        # Find context around phone number
        phone_index = text.lower().find(phone.lower())
        if phone_index == -1:
            continue
            
        context_start = max(0, phone_index - 300)
        context_end = min(len(text), phone_index + 300)
        context = text[context_start:context_end]
        
        # Check if name appears near phone
        name_found = False
        confidence = 0.3  # Base confidence
        
        if name:
            for part in name_parts:
                if len(part) > 2 and part in context.lower():
                    name_found = True
                    confidence = 0.7
                    break
        
        # Check for title keywords (increases confidence)
        title_keywords = ['director', 'manager', 'vp', 'president', 'ceo', 'founder', 'head']
        if any(kw in context.lower() for kw in title_keywords):
            confidence += 0.1
        
        # Check for "direct" or "mobile" (personal line)
        if 'direct' in context.lower() or 'mobile' in context.lower():
            confidence += 0.15
        
        results.append({
            'phone': normalize_phone(phone),
            'context': context,
            'confidence': min(confidence, 0.95),
            'name_match': name_found
        })
    
    return results


# ============ SearXNG Web Search (Self-hosted, Privacy-respecting) ============

# Global state to track if SearXNG is blocked
_searxng_blocked = False
_searxng_error_count = 0
_searxng_semaphore = None  # Will be initialized on first use
_last_searxng_request = 0

def _init_searxng_semaphore():
    """Initialize semaphore on first use."""
    global _searxng_semaphore
    if _searxng_semaphore is None:
        _searxng_semaphore = asyncio.Semaphore(1)  # Max 1 concurrent SearXNG request to avoid rate limiting
    return _searxng_semaphore

async def search_with_searxng(query: str, max_results: int = 10) -> Dict:
    """
    Search web using SearXNG instance (self-hosted, no API costs).
    Async wrapper for parallel processing with rate limiting.
    """
    global _searxng_blocked, _searxng_error_count, _last_searxng_request
    
    # Skip if SearXNG is blocked (too many 403s)
    if _searxng_blocked:
        return {'error': 'SearXNG is blocked (too many 403 errors). Skipping searches.', 'results': []}
    
    # Rate limiting: use semaphore and ensure minimum delay between requests
    semaphore = _init_searxng_semaphore()
    async with semaphore:
        # Ensure minimum 2 seconds between requests to avoid rate limiting
        current_time = asyncio.get_event_loop().time()
        time_since_last = current_time - _last_searxng_request
        if time_since_last < 2.0:
            await asyncio.sleep(2.0 - time_since_last)
        _last_searxng_request = asyncio.get_event_loop().time()
    
    searxng_url = getattr(config, 'SEARXNG_URL', 'http://localhost:8080')
    
    try:
        # Use a session for better connection handling
        session = requests.Session()
        session.headers.update({
            'User-Agent': config.USER_AGENT,
            'Accept': 'application/json',
            'Accept-Language': 'en-US,en;q=0.9',
        })
        
        response = session.get(
            f"{searxng_url}/search",
            params={
                "q": query,
                "format": "json",
                "engines": "duckduckgo",  # Start with just DuckDuckGo (less likely to block)
            },
            timeout=30,
            allow_redirects=True
        )
        
        # Check for 403 - SearXNG is blocking us
        if response.status_code == 403:
            _searxng_error_count += 1
            if _searxng_error_count >= 3 and not _searxng_blocked:
                _searxng_blocked = True
                print(f"[PhoneDiscoverer] SearXNG is blocking requests (403). Disabling SearXNG searches after {_searxng_error_count} errors.")
            return {'error': '403 Forbidden - SearXNG is blocking requests', 'results': []}
        
        response.raise_for_status()
        searxng_data = response.json()
        
        # Reset error count on success
        _searxng_error_count = 0
        
        # Convert SearXNG format to Tavily-compatible format
        results = []
        for result in searxng_data.get('results', [])[:max_results]:
            # SearXNG returns results with url, title, and content/snippet
            results.append({
                'url': result.get('url', ''),
                'title': result.get('title', ''),
                'content': result.get('content', '') or result.get('snippet', '') or ''
            })
        
        return {'results': results, 'error': None}
    except requests.exceptions.ConnectionError:
        return {'error': f'Cannot connect to SearXNG at {searxng_url}. Is it running?', 'results': []}
    except requests.exceptions.Timeout:
        return {'error': 'SearXNG request timed out', 'results': []}
    except Exception as e:
        return {'error': str(e), 'results': []}


# Keep old function name for compatibility, but use SearXNG
async def search_with_tavily(query: str, max_results: int = 10) -> Dict:
    """Alias for search_with_searxng - using SearXNG instead of Tavily."""
    return await search_with_searxng(query, max_results)


def extract_phones_from_url(url: str) -> List[str]:
    """Extract phone numbers from a URL's content."""
    try:
        response = requests.get(url, timeout=10, headers={'User-Agent': config.USER_AGENT})
        if response.status_code == 200:
            phones = extract_phones(response.text)
            return [normalize_phone(p) for p in phones]
    except:
        pass
    return []


# ============ Discovery Methods ============

async def find_phone_from_crawled_pages(name: str, company: str, domain: str) -> Optional[Dict]:
    """Method 1: Extract from already crawled pages (free, instant)."""
    # Try multiple domain formats (slug vs actual domain)
    domain_variants = [domain] if domain else []
    
    # Look up domain from targets table if company name is provided
    if company and not domain_variants:
        with db.get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT domain FROM targets WHERE company_name = ? LIMIT 1", (company,))
            row = cursor.fetchone()
            if row and row[0] and '.' in str(row[0]):
                domain_variants.append(row[0])
                print(f"[PhoneDiscoverer] Found domain from targets: {row[0]}")
    
    # If domain is a slug (no dots), try to convert to actual domain
    if domain and '.' not in domain:
        # Try common TLDs
        domain_variants.extend([
            domain.replace('-', '') + '.com',
            domain.replace('-', '') + '.org',
            domain.replace('-', '') + '.net',
        ])
        # Also try with dashes
        domain_variants.append(domain + '.com')
    
    with db.get_db() as conn:
        cursor = conn.cursor()
        
        # Try each domain variant
        all_pages = []
        for dom in domain_variants:
            cursor.execute("""
                SELECT url, phones_found, text_path
                FROM pages
                WHERE domain = ? AND phones_found IS NOT NULL AND phones_found != '[]' AND phones_found != ''
            """, (dom,))
            pages = cursor.fetchall()
            # Convert to dicts while connection is open
            all_pages.extend([dict(row) for row in pages])
        
        # Also try matching by company name in pages table (fuzzy match) - this is important!
        if company:
            # Try various company name formats
            company_variants = [
                company.lower(),
                company.lower().replace(' ', '-'),
                company.lower().replace(' ', ''),
                company.lower().replace(' county ', ' ').replace(' ', '-'),  # "merrimack county savings bank" -> "merrimack-savings-bank"
                company.lower().replace(' county ', '').replace(' ', '-'),   # "merrimack county savings bank" -> "merrimacksavingsbank"
            ]
            for comp_var in company_variants:
                cursor.execute("""
                    SELECT url, phones_found, text_path, domain
                    FROM pages
                    WHERE phones_found IS NOT NULL AND phones_found != '[]' AND phones_found != ''
                    AND (url LIKE ? OR domain LIKE ?)
                """, (f'%{comp_var}%', f'%{comp_var}%'))
                pages_by_company = cursor.fetchall()
                all_pages.extend([dict(row) for row in pages_by_company])
        
        # Also try to find ANY pages with phones for this company (broader search)
        if company:
            # Extract key words from company name
            words = company.lower().split()
            # Remove common words
            key_words = [w for w in words if w not in ['the', 'a', 'an', 'and', 'or', 'of', 'for', 'bank', 'savings', 'county']]
            if key_words:
                # Try first significant word (e.g., "merrimack" from "Merrimack County Savings Bank")
                main_word = key_words[0]
                cursor.execute("""
                    SELECT url, phones_found, text_path, domain
                    FROM pages
                    WHERE phones_found IS NOT NULL AND phones_found != '[]' AND phones_found != ''
                    AND (url LIKE ? OR domain LIKE ?)
                    LIMIT 50
                """, (f'%{main_word}%', f'%{main_word}%'))
                pages_by_keyword = cursor.fetchall()
                all_pages.extend([dict(row) for row in pages_by_keyword])
                
                # Also try searching by person's name in pages with phones (very broad)
                if name:
                    name_words = name.lower().split()
                    if len(name_words) >= 2:
                        first_name = name_words[0]
                        last_name = name_words[-1]
                        # Search for pages that might contain this person's info
                        cursor.execute("""
                            SELECT url, phones_found, text_path, domain
                            FROM pages
                            WHERE phones_found IS NOT NULL AND phones_found != '[]' AND phones_found != ''
                            AND text_path IS NOT NULL
                            LIMIT 100
                        """)
                        candidate_pages = [dict(row) for row in cursor.fetchall()]
                        # Filter pages that might contain the name (we'll check text_path later)
                        all_pages.extend(candidate_pages)
        
        pages = all_pages
        
        # If no pages with phones_found, try finding pages and extracting phones on the fly
        if not all_pages and company:
            # Try to find pages even without phones_found - we'll extract phones from text
            for dom in domain_variants[:3]:  # Limit to avoid too many
                if not dom:
                    continue
                cursor.execute("""
                    SELECT url, phones_found, text_path, domain
                    FROM pages
                    WHERE domain = ? AND text_path IS NOT NULL
                    LIMIT 20
                """, (dom,))
                pages_without_phones = cursor.fetchall()
                all_pages.extend([dict(row) for row in pages_without_phones])
            
            # Also try by company name
            if company:
                company_lower = company.lower()
                cursor.execute("""
                    SELECT url, phones_found, text_path, domain
                    FROM pages
                    WHERE (url LIKE ? OR domain LIKE ?) AND text_path IS NOT NULL
                    LIMIT 30
                """, (f'%{company_lower}%', f'%{company_lower}%'))
                pages_by_company = cursor.fetchall()
                all_pages.extend([dict(row) for row in pages_by_company])
        
        pages = all_pages
        
        # Debug logging (inside the with block so connection is still open)
        if pages:
            print(f"[PhoneDiscoverer] Found {len(pages)} pages for {company} (domain: {domain})")
        else:
            print(f"[PhoneDiscoverer] No pages found for {company} (domain: {domain})")
            # Debug: check if ANY pages exist for this domain/company
            cursor.execute("SELECT COUNT(*) FROM pages WHERE domain LIKE ? OR url LIKE ?", 
                          (f'%{domain}%' if domain else '', f'%{company.lower()}%' if company else ''))
            total_pages = cursor.fetchone()[0]
            if total_pages > 0:
                print(f"[PhoneDiscoverer] Found {total_pages} total pages for {company}, but none matched search criteria")
    
    if not pages:
        return None
    
    best_phone = None
    best_confidence = 0
    
    for page in pages:
        # If we have text path, extract phones from text (even if phones_found is empty)
        if page.get('text_path'):
            try:
                with open(page['text_path'], 'r', encoding='utf-8') as f:
                    text = f.read()
                
                # Extract phones with context (this is the best method)
                phones_with_context = extract_phones_with_context(text, name)
                for pwc in phones_with_context:
                    if pwc['confidence'] > best_confidence:
                        best_phone = {
                            'phone': pwc['phone'],
                            'source': 'crawled_page',
                            'confidence': pwc['confidence'],
                            'url': page['url']
                        }
                        best_confidence = pwc['confidence']
                
                # Fallback: if no phones with context, try phones_found field
                if not best_phone:
                    phones_json = page.get('phones_found')
                    if phones_json:
                        phones = json.loads(phones_json) if isinstance(phones_json, str) else phones_json
                        if phones:
                            best_phone = {
                                'phone': normalize_phone(phones[0]),
                                'source': 'crawled_page',
                                'confidence': 0.5,
                                'url': page['url']
                            }
            except Exception as e:
                # If text extraction fails, try phones_found as fallback
                phones_json = page.get('phones_found')
                if phones_json:
                    try:
                        phones = json.loads(phones_json) if isinstance(phones_json, str) else phones_json
                        if phones and not best_phone:
                            best_phone = {
                                'phone': normalize_phone(phones[0]),
                                'source': 'crawled_page',
                                'confidence': 0.4,
                                'url': page['url']
                            }
                    except:
                        pass
    
    return best_phone


async def find_phone_via_email_association(name: str, email: str, company: str) -> Optional[Dict]:
    """Method 2: Search for email + phone patterns (people list both together)."""
    global _searxng_blocked
    
    if not email:
        return None
    
    # Skip if SearXNG is already blocked
    if _searxng_blocked:
        return None
    
    # Only use SearXNG if we have a good email (not generic)
    generic_prefixes = ['info', 'contact', 'hello', 'support', 'sales', 'admin', 'help', 'noreply']
    if email.split('@')[0].lower() in generic_prefixes:
        return None
    
    # Add delay to avoid rate limiting
    await asyncio.sleep(0.5)  # Small delay between SearXNG requests
    
    query = f'"{email}" phone OR telephone OR "call me" OR "reach me"'
    results = await search_with_searxng(query, max_results=3)
    
    if results.get('error'):
        # Silently skip if SearXNG is blocked (already logged)
        return None
    
    if not results.get('results'):
        return None
    
    for result in results.get('results', []):
        content = result.get('content', '')
        url = result.get('url', '')
        
        if email.lower() in content.lower():
            # Extract phones near email mention
            phones_with_context = extract_phones_with_context(content, name)
            if phones_with_context:
                best = max(phones_with_context, key=lambda x: x['confidence'])
                return {
                    'phone': best['phone'],
                    'source': 'email_association',
                    'confidence': best['confidence'],
                    'url': url
                }
    
    # If no results found, try extracting phones from any search results (broader search)
    for result in results.get('results', []):
        content = result.get('content', '')
        url = result.get('url', '')
        
        # Extract any phones from the content
        phones_with_context = extract_phones_with_context(content, name)
        if phones_with_context:
            best = max(phones_with_context, key=lambda x: x['confidence'])
            # Lower confidence since email wasn't found in same context
            return {
                'phone': best['phone'],
                'source': 'email_association',
                'confidence': max(0.4, best['confidence'] * 0.7),  # Reduce confidence
                'url': url
            }
    
    return None


async def find_phone_via_conference_pages(name: str, company: str) -> Optional[Dict]:
    """Method 3: Conference speaker pages often have contact info."""
    query = f'"{name}" "{company}" speaker OR conference OR "presented at" OR "speaking"'
    results = await search_with_tavily(query, max_results=5)
    
    if results.get('error'):
        return None
    
    if not results.get('results'):
        return None
    
    for result in results.get('results', []):
        url = result.get('url', '')
        if 'conference' in url.lower() or 'speaker' in url.lower() or 'event' in url.lower():
            phones = extract_phones_from_url(url)
            if phones:
                return {
                    'phone': phones[0],
                    'source': 'conference_page',
                    'confidence': 0.7,
                    'url': url
                }
    
    return None


async def find_phone_via_press_releases(name: str, company: str) -> Optional[Dict]:
    """Method 4: Press releases list media contact info."""
    query = f'"{company}" "press release" OR "media contact" OR "for media inquiries" "{name}"'
    results = await search_with_tavily(query, max_results=5)
    
    if results.get('error'):
        return None
    
    for result in results.get('results', []):
        content = result.get('content', '')
        url = result.get('url', '')
        
        if name.lower() in content.lower():
            phones_with_context = extract_phones_with_context(content, name)
            if phones_with_context:
                best = max(phones_with_context, key=lambda x: x['confidence'])
                return {
                    'phone': best['phone'],
                    'source': 'press_release',
                    'confidence': best['confidence'],
                    'url': url
                }
    
    return None


async def find_phone_via_industry_directories(name: str, company: str, industry: str = None) -> Optional[Dict]:
    """Method 5: Industry directories often have contact info."""
    queries = [
        f'"{company}" "{name}" directory OR members',
        f'"{name}" "{company}" association OR "member directory"',
    ]
    
    if industry:
        queries.append(f'"{company}" "{industry}" directory "{name}"')
    
    for query in queries:
        results = await search_with_tavily(query, max_results=3)
        
        if results.get('error'):
            continue
        
        for result in results.get('results', []):
            url = result.get('url', '')
            if 'directory' in url.lower() or 'members' in url.lower():
                phones = extract_phones_from_url(url)
                if phones:
                    return {
                        'phone': phones[0],
                        'source': 'industry_directory',
                        'confidence': 0.65,
                        'url': url
                    }
    
    return None


async def find_phone_via_google_patterns(name: str, company: str) -> Optional[Dict]:
    """Method 6: Use Google search patterns (via Tavily)."""
    patterns = [
        f'"{name}" "{company}" contact OR phone OR "reach"',
        f'"{name}" "{company}" "direct line" OR "direct dial"',
        f'"{company}" "{name}" phone number',
        f'"{name}" "{company}" email phone',
        f'"{company}" team "{name}" contact',
    ]
    
    for query in patterns:
        results = await search_with_tavily(query, max_results=3)
        
        if results.get('error'):
            continue
        
        for result in results.get('results', []):
            content = result.get('content', '')
            url = result.get('url', '')
            
            phones_with_context = extract_phones_with_context(content, name)
            if phones_with_context:
                best = max(phones_with_context, key=lambda x: x['confidence'])
                if best['confidence'] > 0.5:
                    return {
                        'phone': best['phone'],
                        'source': 'web_search',
                        'confidence': best['confidence'],
                        'url': url
                    }
    
    return None


async def find_phone_via_social_proof(name: str, company: str) -> Optional[Dict]:
    """Method 7: Social proof contexts (personal sites, guest posts, etc.)."""
    queries = [
        f'"{name}" "contact me" OR "get in touch"',
        f'"{name}" "{company}" "guest post" OR "author bio"',
        f'"{name}" "{company}" podcast guest',
        f'"{name}" "{company}" webinar presenter',
    ]
    
    for query in queries:
        results = await search_with_tavily(query, max_results=3)
        
        if results.get('error'):
            continue
        
        for result in results.get('results', []):
            url = result.get('url', '')
            phones = extract_phones_from_url(url)
            if phones:
                return {
                    'phone': phones[0],
                    'source': 'social_proof',
                    'confidence': 0.6,
                    'url': url
                }
    
    return None


async def find_phone_from_linkedin(name: str, company: str, linkedin_url: str = None) -> Optional[Dict]:
    """Method 8: Extract from LinkedIn profile (if available)."""
    if not linkedin_url:
        return None
    
    # Check if we have LinkedIn data in database
    with db.get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT linkedin_url FROM linkedin_contacts
            WHERE name = ? AND company_name = ?
        """, (name, company))
        result = cursor.fetchone()
    
    # Note: Actual LinkedIn scraping would need browser automation
    # This is a placeholder - you'd integrate with your LinkedIn scraper
    return None


async def find_phone_via_llm_analysis(name: str, company: str, domain: str, search_results: List[Dict]) -> Optional[Dict]:
    """Method 9: Use GPT-4o to analyze search results and extract phone."""
    if not config.OPENAI_API_KEY or not search_results:
        return None
    
    # Prepare context from search results
    context_parts = []
    for result in search_results[:5]:
        content = result.get('content', '')[:500]
        url = result.get('url', '')
        context_parts.append(f"URL: {url}\nContent: {content}")
    
    context = "\n\n".join(context_parts)
    
    prompt = f"""Find the phone number for {name} at {company} ({domain}).

Search results:
{context}

Your task:
1. Extract any phone numbers mentioned
2. Identify which phone number belongs to {name} (if any)
3. Determine confidence (0.0-1.0) based on context

Respond in JSON format:
{{
    "phone": "555-123-4567" or null,
    "confidence": 0.8,
    "reasoning": "Found in press release with name and title"
}}

If no phone number found, return {{"phone": null, "confidence": 0, "reasoning": "No phone found"}}
Respond ONLY with JSON, no other text."""

    try:
        client = OpenAI(api_key=config.OPENAI_API_KEY)
        response = client.chat.completions.create(
            model=config.LLM_MODEL_SMART,  # GPT-4o
            messages=[{"role": "user", "content": prompt}],
            max_tokens=200,
            temperature=0
        )
        
        result_text = response.choices[0].message.content.strip()
        result_text = re.sub(r'^```json\s*', '', result_text)
        result_text = re.sub(r'\s*```$', '', result_text)
        
        result = json.loads(result_text)
        
        if result.get('phone'):
            return {
                'phone': normalize_phone(result['phone']),
                'source': 'llm_analysis',
                'confidence': result.get('confidence', 0.5),
                'reasoning': result.get('reasoning', '')
            }
    except Exception as e:
        print(f"[PhoneDiscoverer] LLM error: {e}")
    
    return None


# ============ Main Discovery Function (Parallel) ============

def generate_email_variations(name: str, domain: str) -> List[str]:
    """Generate possible email variations from a name (don't save to DB)."""
    if not name or not domain:
        return []
    
    # Parse name
    name_parts = name.lower().strip().split()
    if len(name_parts) < 2:
        return []
    
    first = name_parts[0]
    last = name_parts[-1]
    
    # Common email patterns
    variations = [
        f"{first}.{last}@{domain}",
        f"{first}{last}@{domain}",
        f"{first[0]}{last}@{domain}",
        f"{first}{last[0]}@{domain}",
        f"{first[0]}.{last}@{domain}",
        f"{first}.{last[0]}@{domain}",
        f"{last}.{first}@{domain}",
        f"{last}{first}@{domain}",
        f"{last}.{first[0]}@{domain}",
    ]
    
    # Add middle initial if available
    if len(name_parts) > 2:
        middle = name_parts[1][0] if name_parts[1] else ''
        if middle:
            variations.extend([
                f"{first}.{middle}.{last}@{domain}",
                f"{first}{middle}{last}@{domain}",
                f"{first[0]}{middle}{last}@{domain}",
            ])
    
    return variations


async def find_phone_from_company_website(name: str, company: str, email_domain: str = None) -> Optional[Dict]:
    """Try to fetch the company website directly and extract phone numbers."""
    if not email_domain or '.' not in email_domain:
        return None
    
    # Try common company website URLs
    base_domain = email_domain
    urls_to_try = [
        f"https://{base_domain}",
        f"https://www.{base_domain}",
        f"https://{base_domain}/contact",
        f"https://{base_domain}/contact-us",
        f"https://www.{base_domain}/contact",
        f"https://www.{base_domain}/contact-us",
        f"https://{base_domain}/about",
        f"https://www.{base_domain}/about",
    ]
    
    best_phone = None
    best_confidence = 0
    best_url = None
    
    for url in urls_to_try[:4]:  # Limit to first 4 to avoid too many requests
        try:
            response = requests.get(url, timeout=10, headers={'User-Agent': config.USER_AGENT}, allow_redirects=True)
            if response.status_code == 200:
                text = response.text.lower()
                
                # Check if this page mentions the person's name
                name_words = name.lower().split()
                if len(name_words) >= 2:
                    first_name = name_words[0]
                    last_name = name_words[-1]
                    name_in_text = first_name in text and last_name in text
                else:
                    name_in_text = False
                
                # Extract phones with context
                phones_with_context = extract_phones_with_context(response.text, name if name_in_text else None)
                
                for pwc in phones_with_context:
                    # Higher confidence if name is found near the phone
                    confidence = pwc['confidence'] * (1.2 if name_in_text else 0.8)
                    if confidence > best_confidence:
                        best_phone = pwc['phone']
                        best_confidence = min(confidence, 1.0)
                        best_url = url
                
                # If we found a phone with good confidence, return early
                if best_phone and best_confidence > 0.6:
                    print(f"[PhoneDiscoverer] Found phone from company website: {url}")
                    return {
                        'phone': best_phone,
                        'source': 'company_website_direct',
                        'confidence': best_confidence,
                        'url': best_url
                    }
        except Exception as e:
            # Continue to next URL
            continue
    
    # If we found any phone (even with lower confidence), return it
    if best_phone and best_confidence > 0.3:
        print(f"[PhoneDiscoverer] Found company phone from website: {best_url} (confidence: {best_confidence:.2f})")
        return {
            'phone': best_phone,
            'source': 'company_website_direct',
            'confidence': best_confidence,
            'url': best_url
        }
    
    return None


async def find_phone_by_name_in_all_pages(name: str, company: str) -> Optional[Dict]:
    """Search for phone numbers by person's name across ALL pages with phones."""
    import json
    import re
    
    # Normalize name for matching
    name_lower = name.lower()
    name_words = name_lower.split()
    if len(name_words) < 2:
        return None
    
    first_name = name_words[0]
    last_name = name_words[-1]
    
    with db.get_db() as conn:
        cursor = conn.cursor()
        
        # Get all pages with phones
        cursor.execute("""
            SELECT url, phones_found, text_path, domain
            FROM pages
            WHERE phones_found IS NOT NULL AND phones_found != '[]' AND phones_found != ''
            LIMIT 100
        """)
        all_pages = [dict(row) for row in cursor.fetchall()]
    
    best_phone = None
    best_confidence = 0
    
    for page in all_pages:
        # Check if page text contains the person's name
        if page.get('text_path'):
            try:
                with open(page['text_path'], 'r', encoding='utf-8') as f:
                    text = f.read().lower()
                
                # Check if name appears in text
                if first_name in text and last_name in text:
                    # Extract phones with context
                    phones_with_context = extract_phones_with_context(text, name)
                    for pwc in phones_with_context:
                        if pwc['confidence'] > best_confidence:
                            best_phone = {
                                'phone': pwc['phone'],
                                'source': 'name_match_in_page',
                                'confidence': pwc['confidence'],
                                'url': page['url']
                            }
                            best_confidence = pwc['confidence']
            except:
                pass
    
    return best_phone


async def discover_phone_parallel(
    name: str,
    company: str,
    domain: str,
    email: str = None,
    linkedin_url: str = None,
    industry: str = None
) -> Optional[Dict]:
    """
    Phone discovery is disabled - company website phones are not individual direct lines.
    Finding direct phone numbers reliably requires paid data providers.
    
    Returns None - no phone discovery without proper data source.
    """
    # Disabled: Company website phones are NOT individual direct lines
    # Assigning the same company phone to all contacts is incorrect
    return None


# ============ Batch Processing ============

async def discover_phones_for_contacts(
    contacts: List[Dict],
    max_workers: int = 10
) -> Dict:
    """
    Discover phones for multiple contacts in parallel.
    
    Args:
        contacts: List of {name, company, domain, email, linkedin_url, ...}
        max_workers: Max parallel workers
    
    Returns:
        Dict with results summary
    """
    semaphore = asyncio.Semaphore(max_workers)
    processed = 0
    
    async def discover_with_limit(contact):
        nonlocal processed
        async with semaphore:
            try:
                processed += 1
                if processed % 10 == 0:
                    print(f"[PhoneDiscoverer] Processed {processed}/{len(contacts)} contacts...")
                
                phone_data = await discover_phone_parallel(
                    name=contact.get('name', ''),
                    company=contact.get('company_name') or contact.get('company', ''),
                    domain=contact.get('domain', ''),
                    email=contact.get('email') or contact.get('email_generated', ''),
                    linkedin_url=contact.get('linkedin_url', ''),
                    industry=contact.get('industry')
                )
                
                if phone_data:
                    print(f"[PhoneDiscoverer] ✓ {contact.get('name')}: {phone_data.get('phone')} ({phone_data.get('source')})")
                # Log first few failures to debug
                elif processed <= 5:
                    email_val = contact.get('email') or contact.get('email_generated', '')
                    print(f"[PhoneDiscoverer] ✗ {contact.get('name')}: No phone found (email: {email_val}, domain: {contact.get('domain')})")
                
                return {
                    'contact_id': contact.get('id'),
                    'name': contact.get('name'),
                    'phone_data': phone_data
                }
            except Exception as e:
                print(f"[PhoneDiscoverer] Error for {contact.get('name')}: {e}")
                import traceback
                traceback.print_exc()
                return {
                    'contact_id': contact.get('id'),
                    'name': contact.get('name'),
                    'phone_data': None,
                    'error': str(e)
                }
    
    # Process all contacts in parallel
    tasks = [discover_with_limit(contact) for contact in contacts]
    results = await asyncio.gather(*tasks)
    
    # Update database
    updated = 0
    with db.get_db() as conn:
        cursor = conn.cursor()
        
        # Ensure columns exist
        from services.linkedin.contacts import init_linkedin_table
        init_linkedin_table()
        
        for result in results:
            if result.get('phone_data'):
                phone_data = result['phone_data']
                contact_id = result.get('contact_id')
                
                if contact_id:
                    try:
                        cursor.execute("""
                            UPDATE linkedin_contacts
                            SET phone = ?, phone_source = ?, phone_confidence = ?
                            WHERE id = ?
                        """, (
                            phone_data.get('phone'),
                            phone_data.get('source'),
                            int(phone_data.get('confidence', 0) * 100),  # Store as 0-100
                            contact_id
                        ))
                        updated += 1
                    except Exception as e:
                        print(f"[PhoneDiscoverer] Error updating contact {contact_id}: {e}")
                        # Try to ensure columns exist and retry
                        init_linkedin_table()
                        try:
                            cursor.execute("""
                                UPDATE linkedin_contacts
                                SET phone = ?, phone_source = ?, phone_confidence = ?
                                WHERE id = ?
                            """, (
                                phone_data.get('phone'),
                                phone_data.get('source'),
                                int(phone_data.get('confidence', 0) * 100),
                                contact_id
                            ))
                            updated += 1
                        except:
                            pass
    
    return {
        'total': len(contacts),
        'found': sum(1 for r in results if r.get('phone_data')),
        'updated': updated
    }


# ============ CLI Function ============

async def process_linkedin_contacts_for_phones(today_only: bool = False, max_workers: int = 10) -> Dict:
    """
    Process all LinkedIn contacts to discover phone numbers.
    Similar to process_linkedin_contacts_with_patterns for emails.
    """
    # Ensure database migration has run
    from services.linkedin.contacts import init_linkedin_table
    init_linkedin_table()
    
    # Diagnostic: Check what's in the database
    with db.get_db() as conn:
        cursor = conn.cursor()
        
        # Check pages table for phones
        cursor.execute("SELECT COUNT(*) FROM pages WHERE phones_found IS NOT NULL AND phones_found != '[]' AND phones_found != ''")
        pages_with_phones = cursor.fetchone()[0]
        print(f"[PhoneDiscoverer] Diagnostic: {pages_with_phones} pages in database have phone numbers")
        
        # Check contacts
        cursor.execute("SELECT COUNT(*) FROM linkedin_contacts WHERE name IS NOT NULL")
        total_contacts = cursor.fetchone()[0]
        print(f"[PhoneDiscoverer] Diagnostic: {total_contacts} total contacts in database")
        
        # Check if phone column exists
        cursor.execute("PRAGMA table_info(linkedin_contacts)")
        columns = [row[1] for row in cursor.fetchall()]
        has_phone_column = 'phone' in columns
        print(f"[PhoneDiscoverer] Diagnostic: phone column exists: {has_phone_column}")
        
        date_filter = ""
        if today_only:
            from datetime import datetime
            today = datetime.now().strftime('%Y-%m-%d')
            date_filter = f"AND DATE(scraped_at) = '{today}'"
        
        # Build query based on whether phone column exists
        if has_phone_column:
            query = f"""
                SELECT id, name, company_name, domain, email_generated, linkedin_url
                FROM linkedin_contacts
                WHERE name IS NOT NULL
                AND (phone IS NULL OR phone = '')
                {date_filter}
                ORDER BY scraped_at DESC
            """
        else:
            # If column doesn't exist, get all contacts (migration will add column)
            query = f"""
                SELECT id, name, company_name, domain, email_generated, linkedin_url
                FROM linkedin_contacts
                WHERE name IS NOT NULL
                {date_filter}
                ORDER BY scraped_at DESC
            """
        
        cursor.execute(query)
        contacts = [dict(row) for row in cursor.fetchall()]
        
        # Show sample contacts
        if contacts:
            print(f"[PhoneDiscoverer] Sample contacts to process:")
            for c in contacts[:3]:
                print(f"  - {c.get('name')} at {c.get('company_name')} (domain: {c.get('domain')})")
    
    if not contacts:
        print("[PhoneDiscoverer] No contacts found to process")
        return {'contacts': 0, 'found': 0, 'updated': 0}
    
    print(f"[PhoneDiscoverer] Processing {len(contacts)} contacts with {max_workers} parallel workers...")
    
    results = await discover_phones_for_contacts(contacts, max_workers=max_workers)
    
    print(f"[PhoneDiscoverer] Found phones for {results['found']} contacts")
    print(f"[PhoneDiscoverer] Updated {results['updated']} contacts in database")
    
    # Summary
    if results['found'] == 0:
        print(f"\n[PhoneDiscoverer] No phones found. Possible reasons:")
        print(f"  - No crawled pages with phone numbers in database")
        print(f"  - SearXNG is blocked (if enabled)")
        print(f"  - Try crawling company websites first to extract phone numbers")
    
    return results


if __name__ == '__main__':
    # Test with a single contact
    async def test():
        result = await discover_phone_parallel(
            name="John Smith",
            company="Acme Corp",
            domain="acme.com",
            email="john.smith@acme.com"
        )
        print(json.dumps(result, indent=2))
    
    asyncio.run(test())

