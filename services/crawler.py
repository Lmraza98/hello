"""
Crawler Service: Fetch + clean content, discover contact pages.
Cheap, deterministic operations - no LLM usage here.
"""
import re
import json
import hashlib
from pathlib import Path
from urllib.parse import urljoin, urlparse
from typing import List, Dict, Optional, Tuple
import requests
from bs4 import BeautifulSoup
from readability import Document
import extruct

import config
import database as db


# ============ Email/Phone Extraction (Regex) ============

EMAIL_PATTERN = re.compile(
    r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b'
)

PHONE_PATTERN = re.compile(
    r'(?:\+?1[-.\s]?)?\(?[0-9]{3}\)?[-.\s]?[0-9]{3}[-.\s]?[0-9]{4}'
)

# Common non-person emails to filter out
GENERIC_EMAIL_PREFIXES = {
    # General contact
    'info', 'contact', 'hello', 'support', 'sales', 'admin', 'help',
    'enquiries', 'enquiry', 'office', 'mail', 'team', 'general',
    # HR/Careers
    'careers', 'jobs', 'hr', 'recruitment', 'talent', 'hiring',
    # Marketing/PR
    'press', 'media', 'marketing', 'pr', 'communications', 'news',
    # Finance
    'billing', 'accounts', 'accounting', 'finance', 'invoices', 'payments', 'ap', 'ar',
    # Operations
    'operations', 'service', 'services', 'orders', 'shipping', 'logistics',
    # IT/Tech
    'webmaster', 'noreply', 'no-reply', 'donotreply', 'do-not-reply', 'it', 'tech', 'helpdesk',
    # Departments
    'philanthropy', 'donations', 'giving', 'community', 'foundation',
    'legal', 'compliance', 'privacy', 'security',
    'customerservice', 'customer-service', 'customersupport', 'customer-support',
    'members', 'membership', 'subscribers', 'partners', 'vendors',
    'reception', 'front-desk', 'frontdesk',
    # Provider/Industry specific
    'providerservices', 'provider-services', 'providers', 'claims',
    'solarfarms', 'solar-farms', 'projects',
}


def extract_emails(text: str) -> List[str]:
    """Extract emails from text, deduped."""
    emails = list(set(EMAIL_PATTERN.findall(text.lower())))
    return emails


def extract_phones(text: str) -> List[str]:
    """Extract phone numbers from text, deduped."""
    phones = list(set(PHONE_PATTERN.findall(text)))
    return phones


def is_personal_email(email: str) -> bool:
    """Check if email appears to be a personal (non-generic) business email."""
    email = email.lower().strip()
    
    # Check for malformed emails (contains numbers at start - likely phone concat)
    if not email or '@' not in email:
        return False
    
    prefix = email.split('@')[0]
    domain_part = email.split('@')[1].split('.')[0] if '@' in email else ''
    
    # Skip if prefix starts with digits (malformed - phone+email)
    if prefix and prefix[0].isdigit():
        return False
    
    # Skip if prefix matches domain (e.g., nedelta@nedelta.com)
    if prefix == domain_part:
        return False
    
    # Skip if prefix contains any generic keyword
    for generic in GENERIC_EMAIL_PREFIXES:
        if generic in prefix:
            return False
    
    # Skip very short prefixes (likely abbreviations like "hr", "pr", "it")
    if len(prefix) <= 2:
        return False
    
    return True


def get_email_with_context(html: str, email: str, context_chars: int = 200) -> str:
    """Get surrounding text context for an email address."""
    text = BeautifulSoup(html, 'lxml').get_text(separator=' ')
    idx = text.lower().find(email.lower())
    if idx == -1:
        return ""
    start = max(0, idx - context_chars)
    end = min(len(text), idx + len(email) + context_chars)
    return text[start:end].strip()


# ============ Link Discovery ============

def extract_internal_links(html: str, base_url: str) -> List[Dict]:
    """
    Extract internal links with anchor text.
    Returns: [{url, anchor_text, is_contact_likely}]
    """
    soup = BeautifulSoup(html, 'lxml')
    base_domain = urlparse(base_url).netloc
    links = []
    seen_urls = set()
    
    for a in soup.find_all('a', href=True):
        href = a['href']
        full_url = urljoin(base_url, href)
        parsed = urlparse(full_url)
        
        # Skip external, anchor-only, or non-http links
        if parsed.netloc and parsed.netloc != base_domain:
            continue
        if not parsed.scheme in ('http', 'https', ''):
            continue
        if href.startswith('#') or href.startswith('mailto:') or href.startswith('tel:'):
            continue
        
        # Normalize URL
        normalized = f"{parsed.scheme or 'https'}://{parsed.netloc or base_domain}{parsed.path}"
        if normalized in seen_urls:
            continue
        seen_urls.add(normalized)
        
        anchor_text = a.get_text(strip=True).lower()
        path_lower = parsed.path.lower()
        
        # Check if this looks like a contact page
        is_contact_likely = any(
            slug in path_lower for slug in config.CONTACT_PAGE_SLUGS
        ) or any(
            kw in anchor_text for kw in config.CONTACT_ANCHOR_KEYWORDS
        )
        
        links.append({
            'url': normalized,
            'anchor_text': anchor_text[:100],  # Truncate long anchors
            'is_contact_likely': is_contact_likely
        })
    
    return links


def get_contact_page_urls(base_url: str, internal_links: List[Dict]) -> List[str]:
    """
    Get URLs to crawl for contact information.
    Prioritizes likely contact pages.
    """
    domain = urlparse(base_url).netloc
    scheme = urlparse(base_url).scheme or 'https'
    
    urls_to_crawl = []
    
    # First: try known contact page slugs
    for slug in config.CONTACT_PAGE_SLUGS:
        urls_to_crawl.append(f"{scheme}://{domain}{slug}")
    
    # Second: add likely contact pages from discovered links
    for link in internal_links:
        if link['is_contact_likely'] and link['url'] not in urls_to_crawl:
            urls_to_crawl.append(link['url'])
    
    # Cap at max pages per domain
    return urls_to_crawl[:config.MAX_PAGES_PER_DOMAIN]


# ============ Content Extraction ============

def extract_readable_content(html: str) -> Tuple[str, str]:
    """
    Extract main readable content using readability.
    Returns: (title, main_text)
    """
    try:
        doc = Document(html)
        title = doc.title()
        # Get text from the readable content
        summary_html = doc.summary()
        soup = BeautifulSoup(summary_html, 'lxml')
        main_text = soup.get_text(separator='\n', strip=True)
        return title, main_text
    except Exception:
        # Fallback to basic extraction
        soup = BeautifulSoup(html, 'lxml')
        title = soup.title.string if soup.title else ""
        # Remove script/style
        for tag in soup(['script', 'style', 'nav', 'footer', 'header']):
            tag.decompose()
        main_text = soup.get_text(separator='\n', strip=True)
        return title, main_text


def extract_metadata(html: str, url: str) -> Dict:
    """
    Extract structured metadata: title, description, JSON-LD.
    """
    soup = BeautifulSoup(html, 'lxml')
    
    meta = {
        'title': None,
        'description': None,
        'og_title': None,
        'og_description': None,
        'json_ld': [],
        'keywords': None
    }
    
    # Title
    if soup.title:
        meta['title'] = soup.title.string
    
    # Meta tags
    for tag in soup.find_all('meta'):
        name = tag.get('name', '').lower()
        prop = tag.get('property', '').lower()
        content = tag.get('content', '')
        
        if name == 'description' or prop == 'og:description':
            meta['description'] = content
        if prop == 'og:title':
            meta['og_title'] = content
        if name == 'keywords':
            meta['keywords'] = content
    
    # JSON-LD structured data
    try:
        extracted = extruct.extract(html, base_url=url, syntaxes=['json-ld'])
        meta['json_ld'] = extracted.get('json-ld', [])
    except Exception:
        pass
    
    return meta


# ============ Page Fetching ============

def fetch_page_simple(url: str) -> Optional[str]:
    """
    Fetch a page using requests (fast, for static pages).
    Returns HTML or None on failure.
    """
    try:
        headers = {'User-Agent': config.USER_AGENT}
        response = requests.get(
            url, 
            headers=headers, 
            timeout=config.REQUEST_TIMEOUT_SECONDS,
            allow_redirects=True
        )
        response.raise_for_status()
        return response.text
    except Exception as e:
        print(f"  [fetch_simple] Failed {url}: {e}")
        return None


async def fetch_page_rendered(url: str, browser_context) -> Optional[str]:
    """
    Fetch a page using Playwright for JS-heavy sites.
    Pass an existing browser context to reuse sessions.
    """
    try:
        page = await browser_context.new_page()
        await page.goto(url, timeout=config.RENDER_TIMEOUT_MS)
        await page.wait_for_load_state('networkidle', timeout=config.RENDER_TIMEOUT_MS)
        html = await page.content()
        await page.close()
        return html
    except Exception as e:
        print(f"  [fetch_rendered] Failed {url}: {e}")
        return None


def needs_js_rendering(html: str) -> bool:
    """
    Heuristic to detect if a page needs JS rendering.
    """
    soup = BeautifulSoup(html, 'lxml')
    
    # Very little text content might indicate JS-rendered
    text = soup.get_text(strip=True)
    if len(text) < 200:
        return True
    
    # Check for common SPA indicators
    body = soup.find('body')
    if body:
        # React/Vue/Angular root divs with no content
        for div_id in ['root', 'app', '__next', '__nuxt']:
            div = body.find('div', id=div_id)
            if div and len(div.get_text(strip=True)) < 100:
                return True
    
    return False


# ============ Storage ============

def get_path_hash(url: str) -> str:
    """Generate a short hash for URL path to use in filenames."""
    path = urlparse(url).path or '/'
    return hashlib.md5(path.encode()).hexdigest()[:12]


def save_page_content(domain: str, url: str, html: str, text: str, meta: Dict) -> Tuple[str, str, str]:
    """
    Save page content to disk.
    Returns: (html_path, text_path, meta_path)
    """
    domain_dir = config.PAGES_DIR / domain
    domain_dir.mkdir(parents=True, exist_ok=True)
    
    path_hash = get_path_hash(url)
    
    html_path = domain_dir / f"{path_hash}.html"
    text_path = domain_dir / f"{path_hash}.txt"
    meta_path = domain_dir / f"{path_hash}.json"
    
    html_path.write_text(html, encoding='utf-8')
    text_path.write_text(text, encoding='utf-8')
    meta_path.write_text(json.dumps(meta, indent=2), encoding='utf-8')
    
    return str(html_path), str(text_path), str(meta_path)


# ============ Main Crawler Functions ============

def process_single_page(domain: str, url: str, html: str) -> Dict:
    """
    Process a single fetched page.
    Returns extracted data dict.
    """
    # Extract readable content
    title, main_text = extract_readable_content(html)
    
    # Extract metadata
    meta = extract_metadata(html, url)
    meta['url'] = url
    meta['title'] = meta['title'] or title
    
    # Extract emails and phones
    full_text = BeautifulSoup(html, 'lxml').get_text()
    emails = extract_emails(full_text)
    phones = extract_phones(full_text)
    
    # Get email context for personal emails
    email_contexts = {}
    for email in emails:
        if is_personal_email(email):
            email_contexts[email] = get_email_with_context(html, email)
    
    # Extract internal links
    internal_links = extract_internal_links(html, url)
    
    # Save to disk
    html_path, text_path, _ = save_page_content(domain, url, html, main_text, meta)
    
    # Update database
    db.update_page_content(
        url=url,
        text_path=text_path,
        html_path=html_path,
        meta_json=meta,
        emails_found=emails,
        phones_found=phones,
        internal_links=internal_links,
        fetch_status='fetched'
    )
    
    return {
        'url': url,
        'title': title,
        'text': main_text,
        'meta': meta,
        'emails': emails,
        'email_contexts': email_contexts,
        'phones': phones,
        'internal_links': internal_links
    }


def crawl_domain(domain: str, homepage_url: str = None) -> Dict:
    """
    Crawl a domain for contact information.
    1. Fetch homepage
    2. Discover and fetch contact pages
    3. Collect all emails/phones/data
    
    Returns aggregated data for the domain.
    """
    if homepage_url is None:
        homepage_url = f"https://{domain}"
    
    print(f"[Crawler] Processing: {domain}")
    
    all_emails = []
    all_phones = []
    all_email_contexts = {}
    pages_data = []
    
    # 1. Fetch homepage
    print(f"  Fetching homepage: {homepage_url}")
    db.add_page(domain, homepage_url, 'homepage')
    
    html = fetch_page_simple(homepage_url)
    if not html:
        db.update_target_status(domain, 'fetch_failed')
        return {'domain': domain, 'status': 'failed', 'reason': 'homepage_fetch_failed'}
    
    # Check if JS rendering needed (we'll handle this in async mode if needed)
    if needs_js_rendering(html):
        print(f"  Note: {domain} may need JS rendering for full content")
    
    homepage_data = process_single_page(domain, homepage_url, html)
    pages_data.append(homepage_data)
    all_emails.extend(homepage_data['emails'])
    all_phones.extend(homepage_data['phones'])
    all_email_contexts.update(homepage_data['email_contexts'])
    
    # 2. Get contact page URLs
    contact_urls = get_contact_page_urls(homepage_url, homepage_data['internal_links'])
    
    # Early exit check: if we already have good data, limit crawling
    personal_emails = [e for e in all_emails if is_personal_email(e)]
    if len(personal_emails) >= 2:
        print(f"  Found {len(personal_emails)} personal emails on homepage, limiting crawl")
        contact_urls = contact_urls[:3]
    
    # 3. Fetch contact pages
    for contact_url in contact_urls:
        if contact_url == homepage_url:
            continue
            
        print(f"  Fetching: {contact_url}")
        db.add_page(domain, contact_url, 'contact_page')
        
        html = fetch_page_simple(contact_url)
        if not html:
            db.update_page_content(contact_url, fetch_status='failed')
            continue
        
        page_data = process_single_page(domain, contact_url, html)
        pages_data.append(page_data)
        all_emails.extend(page_data['emails'])
        all_phones.extend(page_data['phones'])
        all_email_contexts.update(page_data['email_contexts'])
        
        # Early exit if we have enough data
        personal_emails = [e for e in set(all_emails) if is_personal_email(e)]
        if len(personal_emails) >= 3:
            print(f"  Found enough contacts ({len(personal_emails)} emails), stopping crawl")
            break
    
    # Aggregate results
    all_emails = list(set(all_emails))
    all_phones = list(set(all_phones))
    
    db.update_target_status(domain, 'crawled')
    
    print(f"  Completed: {len(pages_data)} pages, {len(all_emails)} emails, {len(all_phones)} phones")
    
    return {
        'domain': domain,
        'status': 'success',
        'pages': pages_data,
        'all_emails': all_emails,
        'all_phones': all_phones,
        'email_contexts': all_email_contexts,
        'personal_emails': [e for e in all_emails if is_personal_email(e)],
        'generic_emails': [e for e in all_emails if not is_personal_email(e)]
    }


def crawl_pending_targets(limit: int = 50) -> List[Dict]:
    """
    Process all pending targets.
    Returns list of crawl results.
    """
    targets = db.get_pending_targets(limit)
    results = []
    
    for target in targets:
        try:
            result = crawl_domain(target['domain'], target['source_url'])
            results.append(result)
        except Exception as e:
            print(f"[Crawler] Error processing {target['domain']}: {e}")
            db.update_target_status(target['domain'], 'error')
            results.append({
                'domain': target['domain'],
                'status': 'error',
                'reason': str(e)
            })
    
    return results


# ============ Target Company Import ============

def import_target_companies(csv_path: str) -> int:
    """
    Import target companies from CSV for LinkedIn search.
    
    Expected columns:
        - Company (required): Company name for LinkedIn search
        - Tier (optional): Priority tier (A, B, C)
        - Vertical (optional): Industry/vertical
        - Target_Reason (optional): Why this is a good target
        - Wedge (optional): Sales angle / product fit
    
    Legacy format (domain_or_url) is also supported for backwards compatibility.
    
    Returns count of new targets added.
    """
    import csv
    
    added = 0
    skipped = 0
    
    with open(csv_path, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        headers = reader.fieldnames or []
        
        # Detect format: new (Company) vs legacy (domain_or_url)
        is_new_format = 'Company' in headers
        
        for row in reader:
            if is_new_format:
                # New format: Company name based
                company_name = row.get('Company', '').strip()
                if not company_name:
                    skipped += 1
                    continue
                
                # Support both old and new column names
                target_reason = (
                    row.get('Target_Reason', '') or 
                    row.get('Why this is a good Zco target', '')
                ).strip() or None
                wedge = (
                    row.get('Wedge', '') or 
                    row.get('Zco wedge', '')
                ).strip() or None
                
                result = db.add_target(
                    company_name=company_name,
                    domain=None,  # No domain - we'll search LinkedIn by name
                    tier=row.get('Tier', '').strip() or None,
                    vertical=row.get('Vertical', '').strip() or None,
                    target_reason=target_reason,
                    wedge=wedge,
                    source='csv_import'
                )
            else:
                # Legacy format: domain based
                url_or_domain = row.get('domain_or_url', '').strip()
                if not url_or_domain:
                    skipped += 1
                    continue
                
                # Extract domain from URL if needed
                if url_or_domain.startswith('http'):
                    domain = urlparse(url_or_domain).netloc
                    source_url = url_or_domain
                else:
                    domain = url_or_domain.replace('www.', '')
                    source_url = f"https://{domain}"
                
                # Derive company name from domain
                company_name = domain.split('.')[0].replace('-', ' ').title()
                
                result = db.add_target(
                    company_name=company_name,
                    domain=domain,
                    source_url=source_url,
                    source=row.get('source', 'manual'),
                    notes=row.get('notes', '')
                )
            
            if result > 0:
                added += 1
            else:
                skipped += 1
    
    print(f"[Crawler] Imported {added} new targets from {csv_path}")
    if skipped > 0:
        print(f"[Crawler] Skipped {skipped} (duplicates or empty)")
    return added


# Backwards compatibility alias
def import_seed_urls(csv_path: str) -> int:
    """Legacy alias for import_target_companies."""
    return import_target_companies(csv_path)

