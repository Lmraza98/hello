"""
Enhanced Email Finder: Multiple methods to discover email patterns and find emails.
Tries Google, pattern analysis, MX validation, and LLM as fallback.
"""
import asyncio
import re
import json
from typing import List, Dict, Optional, Tuple
from playwright.async_api import async_playwright, Page
from openai import OpenAI

try:
    import dns.resolver
    HAS_DNS = True
except ImportError:
    HAS_DNS = False

import config


def verify_mx_records(domain: str) -> Dict:
    """
    Check if domain has valid MX records (can receive email).
    Uses DNS lookup similar to mxtoolbox.com
    """
    result = {
        'has_mx': False,
        'mx_records': [],
        'error': None
    }
    
    if not HAS_DNS:
        result['error'] = 'dnspython not installed'
        return result
    
    try:
        # Query MX records
        mx_records = dns.resolver.resolve(domain, 'MX')
        for mx in mx_records:
            result['mx_records'].append({
                'host': str(mx.exchange).rstrip('.'),
                'priority': mx.preference
            })
        result['has_mx'] = len(result['mx_records']) > 0
        
    except dns.resolver.NXDOMAIN:
        result['error'] = 'Domain does not exist'
    except dns.resolver.NoAnswer:
        result['error'] = 'No MX records found'
    except dns.resolver.NoNameservers:
        result['error'] = 'No nameservers found'
    except Exception as e:
        result['error'] = str(e)
    
    return result


def quick_mx_check(domain: str) -> bool:
    """Quick check if domain has MX records (can receive email)."""
    if not HAS_DNS:
        return True  # Assume valid if we can't check
    
    try:
        dns.resolver.resolve(domain, 'MX')
        return True
    except:
        return False

# Common email patterns with base confidence
EMAIL_PATTERNS = [
    ('{first}.{last}', 0.35),      # john.smith - most common
    ('{first}{last}', 0.20),       # johnsmith
    ('{f}{last}', 0.20),           # jsmith
    ('{first}_{last}', 0.10),      # john_smith
    ('{first}', 0.05),             # john
    ('{f}.{last}', 0.05),          # j.smith
    ('{last}.{first}', 0.03),      # smith.john
    ('{last}{f}', 0.02),           # smithj
]


def detect_pattern_from_email(prefix: str, name_parts: Dict) -> Optional[str]:
    """
    Given an email prefix and name parts, determine what pattern was used.
    e.g., prefix="john.smith", name={'first':'john','last':'smith'} -> '{first}.{last}'
    """
    first = name_parts.get('first', '')
    last = name_parts.get('last', '')
    f = name_parts.get('f', '')
    
    if not first or not last:
        return None
    
    prefix = prefix.lower()
    
    # Check each pattern
    if prefix == f"{first}.{last}":
        return '{first}.{last}'
    if prefix == f"{first}{last}":
        return '{first}{last}'
    if prefix == f"{f}{last}":
        return '{f}{last}'
    if prefix == f"{first}_{last}":
        return '{first}_{last}'
    if prefix == f"{first}-{last}":
        return '{first}-{last}'
    if prefix == f"{f}.{last}":
        return '{f}.{last}'
    if prefix == f"{last}.{first}":
        return '{last}.{first}'
    if prefix == f"{last}{first}":
        return '{last}{first}'
    if prefix == first:
        return '{first}'
    if prefix == last:
        return '{last}'
    
    # Fuzzy matching - check if components are present
    if '.' in prefix:
        parts = prefix.split('.')
        if len(parts) == 2:
            if first in parts[0] and last in parts[1]:
                return '{first}.{last}'
            if len(parts[0]) == 1 and last in parts[1]:
                return '{f}.{last}'
    
    if first in prefix and last in prefix:
        if prefix.index(first) < prefix.index(last):
            return '{first}{last}'
        else:
            return '{last}{first}'
    
    if f == prefix[0] and last in prefix:
        return '{f}{last}'
    
    return None


def parse_name(full_name: str) -> Dict:
    """Parse a full name into components."""
    # Clean the name - remove credentials, parentheses, etc.
    name = re.sub(r'\([^)]*\)', '', full_name)  # Remove (stuff)
    name = re.sub(r',.*$', '', name)  # Remove ", MBA" etc
    name = re.sub(r'[^\w\s\'-]', '', name).strip()
    
    parts = name.split()
    
    if len(parts) == 0:
        return {'first': '', 'last': '', 'f': '', 'l': ''}
    elif len(parts) == 1:
        first = parts[0].lower()
        return {'first': first, 'last': '', 'f': first[0] if first else '', 'l': ''}
    else:
        first = parts[0].lower()
        last = parts[-1].lower()
        return {
            'first': first,
            'last': last,
            'f': first[0] if first else '',
            'l': last[0] if last else ''
        }


def generate_email_variants(name: str, domain: str) -> List[Dict]:
    """Generate all possible email variants with confidence scores."""
    parts = parse_name(name)
    
    if not parts['first']:
        return []
    
    variants = []
    for pattern, base_conf in EMAIL_PATTERNS:
        try:
            # Skip patterns requiring last name if we don't have one
            if '{last}' in pattern and not parts['last']:
                continue
            if '{l}' in pattern and not parts['l']:
                continue
                
            prefix = pattern.format(**parts)
            email = f"{prefix}@{domain}"
            variants.append({
                'email': email,
                'pattern': pattern,
                'confidence': base_conf
            })
        except (KeyError, IndexError):
            continue
    
    return variants


async def search_google_for_emails(domain: str, page: Page) -> List[str]:
    """Search Google for emails from this domain."""
    emails = set()
    
    # More targeted search queries
    queries = [
        f'"{domain}" email',
        f'"@{domain}"',
        f'site:{domain} contact email',
        f'"{domain}" contact us',
    ]
    
    for query in queries:
        try:
            search_url = f"https://www.google.com/search?q={query}&num=20"
            print(f"[EmailFinder] Trying: {query}")
            await page.goto(search_url, timeout=20000)
            await asyncio.sleep(3)
            
            # Get text content
            content = await page.content()
            text = await page.evaluate("document.body.innerText")
            
            # Find emails with looser pattern first
            pattern = rf'([a-zA-Z][a-zA-Z0-9._-]{{1,30}})@{re.escape(domain)}'
            
            # Search in both HTML and text
            found_html = re.findall(pattern, content, re.IGNORECASE)
            found_text = re.findall(pattern, text, re.IGNORECASE)
            
            for prefix in found_html + found_text:
                prefix = prefix.lower()
                email = f"{prefix}@{domain}"
                if is_valid_person_email(prefix, domain):
                    emails.add(email)
                    print(f"[EmailFinder] Found: {email}")
            
            await asyncio.sleep(2)
            
        except Exception as e:
            print(f"[EmailFinder] Search error: {e}")
            continue
    
    # Also try to visit the company website directly
    if len(emails) < 2:
        try:
            print(f"[EmailFinder] Checking company website...")
            await page.goto(f"https://{domain}/contact", timeout=15000)
            await asyncio.sleep(2)
            text = await page.evaluate("document.body.innerText")
            
            pattern = rf'([a-zA-Z][a-zA-Z0-9._-]{{1,30}})@{re.escape(domain)}'
            found = re.findall(pattern, text, re.IGNORECASE)
            
            for prefix in found:
                prefix = prefix.lower()
                if is_valid_person_email(prefix, domain):
                    emails.add(f"{prefix}@{domain}")
                    print(f"[EmailFinder] Found on site: {prefix}@{domain}")
        except:
            pass
        
        try:
            await page.goto(f"https://{domain}/about", timeout=15000)
            await asyncio.sleep(2)
            text = await page.evaluate("document.body.innerText")
            
            pattern = rf'([a-zA-Z][a-zA-Z0-9._-]{{1,30}})@{re.escape(domain)}'
            found = re.findall(pattern, text, re.IGNORECASE)
            
            for prefix in found:
                prefix = prefix.lower()
                if is_valid_person_email(prefix, domain):
                    emails.add(f"{prefix}@{domain}")
                    print(f"[EmailFinder] Found on site: {prefix}@{domain}")
        except:
            pass
    
    return list(emails)[:20]


def is_valid_person_email(prefix: str, domain: str = None) -> bool:
    """Check if an email prefix looks like a real person's email (not a department)."""
    if not prefix:
        return False
    
    prefix = prefix.lower().strip()
    
    # Must start with a letter
    if not prefix[0].isalpha():
        return False
    
    # IMPORTANT: Reject if prefix matches the domain name (like nedelta@nedelta.com)
    if domain:
        domain_name = domain.split('.')[0].lower()
        if prefix == domain_name:
            return False
        # Also reject if very similar
        if prefix in domain_name or domain_name in prefix:
            if len(prefix) > 4:  # Allow short common names like "dan" even if domain is "daniels.com"
                return False
    
    # Reject common generic/department prefixes (exact match)
    generic_exact = {
        'info', 'contact', 'support', 'sales', 'admin', 'hello', 'hr', 
        'jobs', 'careers', 'marketing', 'press', 'media', 'help',
        'billing', 'accounts', 'service', 'team', 'office', 'mail',
        'news', 'newsletter', 'subscribe', 'webmaster', 'postmaster',
        'noreply', 'no-reply', 'donotreply', 'feedback', 'enquiries',
        'inquiries', 'general', 'reception', 'main', 'privacy',
        'legal', 'abuse', 'security', 'www', 'ftp', 'smtp', 'pop',
        'imap', 'dns', 'ns', 'mx', 'web', 'orders', 'shipping',
        'returns', 'warranty', 'tech', 'it', 'helpdesk', 'tickets'
    }
    if prefix in generic_exact:
        return False
    
    # Reject if contains department keywords
    department_keywords = [
        'service', 'support', 'relations', 'marketing', 'sales', 'billing',
        'account', 'provider', 'customer', 'client', 'member', 'partner',
        'vendor', 'supplier', 'press', 'media', 'news', 'event', 'career',
        'recruit', 'talent', 'human', 'resource', 'legal', 'compliance',
        'finance', 'payroll', 'benefit', 'insurance', 'claim', 'dental',
        'medical', 'health', 'care', 'philanthropy', 'foundation', 'giving',
        'donate', 'volunteer', 'community', 'public', 'government', 'policy',
        'investor', 'shareholder', 'board', 'executive', 'corporate', 'office',
        'headquarters', 'general', 'main', 'front', 'reception', 'lobby'
    ]
    for kw in department_keywords:
        if kw in prefix:
            return False
    
    # Should be reasonable length
    if len(prefix) < 4 or len(prefix) > 35:
        return False
    
    # Personal emails usually have a separator (., _, -) OR are short (first name only)
    has_separator = '.' in prefix or '_' in prefix or '-' in prefix
    
    # If no separator, should be short (likely just first name or flast)
    if not has_separator:
        if len(prefix) > 10:  # Too long for just a first name
            return False
    
    # Should have at least 3 letters total
    letter_count = sum(1 for c in prefix if c.isalpha())
    if letter_count < 3:
        return False
    
    # Reject if mostly numbers
    digit_count = sum(1 for c in prefix if c.isdigit())
    if digit_count > letter_count:
        return False
    
    return True


async def search_for_person_email(name: str, domain: str, company: str, page: Page) -> List[Dict]:
    """Search for a specific person's email using various queries."""
    results = []
    parts = parse_name(name)
    
    if not parts['first']:
        return results
    
    # Build targeted search queries (no quotes around name for broader match)
    queries = [
        f'{parts["first"]} {parts["last"]} email "@{domain}"',
        f'{parts["first"]} {parts["last"]} {company} email',
    ]
    
    # Also search for likely email patterns directly
    likely_emails = [
        f'{parts["first"]}.{parts["last"]}@{domain}',  # john.smith@
        f'{parts["f"]}{parts["last"]}@{domain}',       # jsmith@
        f'{parts["first"]}{parts["last"]}@{domain}',   # johnsmith@
        f'{parts["first"]}_{parts["last"]}@{domain}',  # john_smith@
    ]
    
    # Search for exact email patterns first (most reliable)
    for email_guess in likely_emails[:3]:
        queries.insert(0, f'"{email_guess}"')
    
    for query in queries[:3]:  # Limit queries
        try:
            await page.goto(f"https://www.google.com/search?q={query}", timeout=15000)
            await asyncio.sleep(2)
            
            # Extract actual result URLs (not Google's page)
            result_urls = await page.evaluate("""
                () => {
                    const links = [];
                    document.querySelectorAll('a[href^="http"]').forEach(a => {
                        const href = a.href;
                        if (href && 
                            !href.includes('google.com') && 
                            !href.includes('googleapis.com') &&
                            !href.includes('youtube.com')) {
                            links.push(href);
                        }
                    });
                    return [...new Set(links)].slice(0, 3);
                }
            """)
            
            is_exact_search = query.startswith('"') and '@' in query
            searched_email = query.strip('"').lower() if is_exact_search else None
            
            # Visit actual result pages
            for url in result_urls[:2]:
                try:
                    await page.goto(url, timeout=8000)
                    await asyncio.sleep(1)
                    
                    page_text = await page.evaluate("document.body.innerText || ''")
                    page_html = await page.content()
                    
                    # Look for emails on this actual page
                    email_pattern = rf'([a-zA-Z][a-zA-Z0-9._-]{{1,30}})@{re.escape(domain)}'
                    found = re.findall(email_pattern, page_html + page_text, re.IGNORECASE)
                    
                    for prefix in found:
                        prefix = prefix.lower()
                        if not is_valid_person_email(prefix, domain):
                            continue
                            
                        email = f"{prefix}@{domain}"
                        
                        # Verified on real page!
                        if searched_email and email == searched_email:
                            results.append({
                                'email': email,
                                'confidence': 0.90,
                                'source': f'verified:{url[:40]}'
                            })
                            print(f"[EmailFinder] VERIFIED: {email}")
                            return results  # Found it!
                        
                        # Found email matching person's name
                        score = 0.5
                        if parts['first'] in prefix:
                            score += 0.2
                        if parts['last'] in prefix:
                            score += 0.2
                            
                        if score > 0.5:  # Only if it matches the person
                            results.append({
                                'email': email,
                                'confidence': score,
                                'source': f'found:{url[:40]}'
                            })
                            print(f"[EmailFinder] Found: {email} ({score:.0%})")
                
                except Exception:
                    continue
            
            await asyncio.sleep(1)
            
        except Exception:
            continue
    
    return results


async def search_hunter_style(domain: str, sample_names: List[str], page: Page) -> List[str]:
    """
    Search for emails by looking up known employees.
    Similar to how Hunter.io finds emails.
    """
    found_emails = []
    
    for name in sample_names[:3]:  # Try first 3 names
        parts = parse_name(name)
        if not parts['first'] or not parts['last']:
            continue
        
        # Search for this person's email (no quotes for broader match)
        query = f'{parts["first"]} {parts["last"]} "@{domain}" email'
        
        try:
            await page.goto(f"https://www.google.com/search?q={query}", timeout=15000)
            await asyncio.sleep(3)
            
            content = await page.content()
            
            pattern = rf'([a-zA-Z][a-zA-Z0-9._-]{{1,30}})@{re.escape(domain)}'
            matches = re.findall(pattern, content, re.IGNORECASE)
            
            for prefix in matches:
                prefix = prefix.lower()
                if is_valid_person_email(prefix, domain):
                    email = f"{prefix}@{domain}"
                    # Verify it matches the name
                    if parts['first'] in prefix or parts['last'] in prefix:
                        found_emails.append(email)
                        print(f"[EmailFinder] Found {name}'s email: {email}")
                        break  # Found one for this person
            
            await asyncio.sleep(2)
            
        except Exception:
            continue
    
    return found_emails


def analyze_pattern_from_samples(emails: List[str], domain: str) -> Optional[Tuple[str, float]]:
    """Analyze sample emails to determine the company's pattern."""
    if not emails:
        return None
    
    # Filter to only valid person emails
    valid_emails = [e for e in emails if is_valid_person_email(e.split('@')[0], domain)]
    
    if not valid_emails:
        return None
    
    pattern_counts = {}
    
    for email in valid_emails:
        prefix = email.split('@')[0].lower()
        
        # Try to identify pattern
        if '.' in prefix:
            parts = prefix.split('.')
            if len(parts) == 2:
                if len(parts[0]) > 1 and len(parts[1]) > 1:
                    # Looks like first.last
                    pattern_counts['{first}.{last}'] = pattern_counts.get('{first}.{last}', 0) + 1
                elif len(parts[0]) == 1 and len(parts[1]) > 1:
                    # Looks like f.last
                    pattern_counts['{f}.{last}'] = pattern_counts.get('{f}.{last}', 0) + 1
        elif '_' in prefix:
            parts = prefix.split('_')
            if len(parts) == 2 and len(parts[0]) > 1 and len(parts[1]) > 1:
                pattern_counts['{first}_{last}'] = pattern_counts.get('{first}_{last}', 0) + 1
        elif prefix.isalpha():
            if len(prefix) > 10:
                # Long prefix, probably firstlast
                pattern_counts['{first}{last}'] = pattern_counts.get('{first}{last}', 0) + 1
            elif len(prefix) > 4 and len(prefix) <= 10:
                # Medium prefix, could be flast
                pattern_counts['{f}{last}'] = pattern_counts.get('{f}{last}', 0) + 1
            elif len(prefix) <= 4:
                # Short, probably just first name
                pattern_counts['{first}'] = pattern_counts.get('{first}', 0) + 1
    
    if pattern_counts:
        best = max(pattern_counts, key=pattern_counts.get)
        # Higher confidence with more samples
        confidence = min(0.85, 0.5 + (pattern_counts[best] / len(valid_emails)) * 0.35)
        print(f"[EmailFinder] Pattern analysis: {best} from {len(valid_emails)} valid samples")
        return (best, confidence)
    
    return None


async def llm_analyze_pattern(domain: str, sample_emails: List[str], company_name: str = None) -> Optional[Tuple[str, float]]:
    """Use LLM to analyze email pattern based on company characteristics."""
    if not config.OPENAI_API_KEY:
        return None
    
    client = OpenAI(api_key=config.OPENAI_API_KEY)
    
    # Build context about the company
    context = f"Company: {company_name or domain}\nDomain: {domain}\n"
    
    # Try to infer company type from domain/name
    domain_lower = domain.lower()
    name_lower = (company_name or '').lower()
    
    company_hints = []
    if any(x in domain_lower or x in name_lower for x in ['bank', 'financial', 'insurance', 'invest']):
        company_hints.append("Financial/insurance company - typically use first.last")
    if any(x in domain_lower or x in name_lower for x in ['tech', 'software', 'digital', 'app', 'dev']):
        company_hints.append("Tech company - often use first or first.last")
    if any(x in domain_lower or x in name_lower for x in ['law', 'legal', 'attorney']):
        company_hints.append("Law firm - typically use flast or first.last")
    if any(x in domain_lower or x in name_lower for x in ['hospital', 'medical', 'health', 'clinic', 'dental']):
        company_hints.append("Healthcare - typically use first.last")
    if any(x in domain_lower or x in name_lower for x in ['university', 'college', 'school', 'edu']):
        company_hints.append("Education - typically use first.last or flast")
    if any(x in domain_lower or x in name_lower for x in ['construction', 'builder', 'contractor']):
        company_hints.append("Construction - often use first.last or firstlast")
    if any(x in domain_lower or x in name_lower for x in ['manufactur', 'industrial', 'engineering']):
        company_hints.append("Manufacturing/engineering - typically use first.last")
    
    if company_hints:
        context += f"Industry hints: {'; '.join(company_hints)}\n"
    
    if sample_emails:
        context += f"Sample emails found (may be generic): {', '.join(sample_emails[:3])}\n"
    
    prompt = f"""{context}
What email format does this company most likely use for employees?

Statistics by format:
- first.last (john.smith@company.com) - 60% of companies, especially corporate/professional
- flast (jsmith@company.com) - 20% of companies, common in larger organizations
- firstlast (johnsmith@company.com) - 10% of companies
- first_last (john_smith@company.com) - 5% of companies
- first (john@company.com) - 3% of companies, usually small businesses
- f.last (j.smith@company.com) - 2% of companies

Based on the company type and industry, respond with:
Format: <format_name>
Confidence: <0-100>"""

    try:
        response = client.chat.completions.create(
            model=config.LLM_MODEL,
            messages=[{"role": "user", "content": prompt}],
            max_tokens=50,
            temperature=0
        )
        
        text = response.choices[0].message.content.strip()
        
        # Parse response
        format_match = re.search(r'Format:\s*(\S+)', text)
        conf_match = re.search(r'Confidence:\s*(\d+)', text)
        
        if format_match:
            fmt = format_match.group(1).lower().strip()
            conf = int(conf_match.group(1)) / 100 if conf_match else 0.4
            
            # Map to our pattern format
            pattern_map = {
                'first.last': '{first}.{last}',
                'firstlast': '{first}{last}',
                'flast': '{f}{last}',
                'first_last': '{first}_{last}',
                'first': '{first}',
                'f.last': '{f}.{last}',
            }
            
            pattern = pattern_map.get(fmt, '{first}.{last}')
            return (pattern, min(conf, 0.7))  # Cap LLM confidence at 70%
            
    except Exception as e:
        print(f"[EmailFinder] LLM error: {e}")
    
    return None


async def find_email_for_contact(
    name: str, 
    domain: str, 
    company: str = None,
    known_pattern: str = None,
    pattern_confidence: float = 0
) -> List[Dict]:
    """
    Find possible emails for a contact with confidence scores.
    Returns list of {email, confidence, source}
    """
    results = []
    
    # If we have a known pattern with good confidence, use it
    if known_pattern and pattern_confidence > 0.5:
        parts = parse_name(name)
        try:
            prefix = known_pattern.format(**parts)
            email = f"{prefix}@{domain}"
            results.append({
                'email': email,
                'confidence': pattern_confidence,
                'source': 'pattern'
            })
        except:
            pass
    
    # Generate all variants
    variants = generate_email_variants(name, domain)
    
    # Add variants not already in results
    existing = {r['email'] for r in results}
    for v in variants:
        if v['email'] not in existing:
            results.append({
                'email': v['email'],
                'confidence': v['confidence'],
                'source': 'generated'
            })
    
    # Sort by confidence
    results.sort(key=lambda x: x['confidence'], reverse=True)
    
    return results


async def discover_company_pattern(domain: str, company_name: str = None, employee_names: List[str] = None) -> Dict:
    """
    Full discovery pipeline for a company's email pattern.
    Uses employee names to search for real emails.
    Returns {pattern, confidence, sample_emails, all_variants}
    """
    result = {
        'domain': domain,
        'pattern': '{first}.{last}',
        'confidence': 0.3,
        'sample_emails': [],
        'source': 'default',
        'mx_valid': False
    }
    
    # First: Verify domain can receive email (MX check like mxtoolbox.com)
    mx_result = verify_mx_records(domain)
    result['mx_valid'] = mx_result['has_mx']
    
    if mx_result['has_mx']:
        print(f"[EmailFinder] MX verified: {domain} -> {mx_result['mx_records'][0]['host']}")
    else:
        print(f"[EmailFinder] WARNING: No MX records for {domain} - {mx_result.get('error', 'unknown')}")
        # Still continue - some domains use A records for mail
    
    pw = await async_playwright().start()
    browser = await pw.chromium.launch(headless=True)
    
    # Use realistic browser context to avoid blocks
    context = await browser.new_context(
        user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        viewport={'width': 1920, 'height': 1080}
    )
    page = await context.new_page()
    
    try:
        # BEST APPROACH: Search for specific employees we know work there
        if employee_names:
            print(f"[EmailFinder] Searching for {len(employee_names)} known employees...")
            
            for name in employee_names[:5]:  # Try up to 5 employees
                parts = parse_name(name)
                if not parts['first'] or not parts['last']:
                    continue
                
                # Generate likely email patterns for this person
                likely_emails = [
                    f'{parts["first"]}.{parts["last"]}@{domain}',  # john.smith@
                    f'{parts["f"]}{parts["last"]}@{domain}',       # jsmith@
                    f'{parts["first"]}{parts["last"]}@{domain}',   # johnsmith@
                ]
                
                # Search for exact email patterns first (highest confidence)
                queries = [f'"{email}"' for email in likely_emails]
                # Then broader searches
                queries.extend([
                    f'{parts["first"]} {parts["last"]} "@{domain}" email',
                    f'{parts["first"]} {parts["last"]} {company_name or domain} email',
                ])
                
                for query in queries[:3]:  # Limit queries per person
                    try:
                        print(f"[EmailFinder] Searching: {query[:60]}...")
                        await page.goto(f"https://www.google.com/search?q={query}", timeout=15000)
                        await asyncio.sleep(2)
                        
                        # Extract actual result URLs from Google (not the Google page itself)
                        result_urls = await page.evaluate("""
                            () => {
                                const links = [];
                                document.querySelectorAll('a[href^="http"]').forEach(a => {
                                    const href = a.href;
                                    // Skip Google's own URLs
                                    if (href && 
                                        !href.includes('google.com') && 
                                        !href.includes('googleapis.com') &&
                                        !href.includes('youtube.com') &&
                                        !href.includes('gstatic.com')) {
                                        links.push(href);
                                    }
                                });
                                return [...new Set(links)].slice(0, 5);  // First 5 unique URLs
                            }
                        """)
                        
                        # Check if we searched for an exact email pattern
                        is_exact_search = query.startswith('"') and '@' in query
                        searched_email = query.strip('"').lower() if is_exact_search else None
                        
                        # Visit each result page and look for the email
                        for url in result_urls[:3]:  # Check first 3 results
                            try:
                                print(f"[EmailFinder]   Checking: {url[:50]}...")
                                await page.goto(url, timeout=10000)
                                await asyncio.sleep(1)
                                
                                page_text = await page.evaluate("document.body.innerText || ''")
                                page_html = await page.content()
                                
                                # Look for emails on this actual page
                                email_pattern = rf'([a-zA-Z][a-zA-Z0-9._-]{{1,30}})@{re.escape(domain)}'
                                found_emails = re.findall(email_pattern, page_html + page_text, re.IGNORECASE)
                                
                                for prefix in found_emails:
                                    prefix = prefix.lower()
                                    if not is_valid_person_email(prefix, domain):
                                        continue
                                    
                                    email = f"{prefix}@{domain}"
                                    
                                    # If we searched for a specific email and found it
                                    if searched_email and email == searched_email:
                                        print(f"[EmailFinder] VERIFIED on {url[:40]}: {email}")
                                        result['sample_emails'].append(email)
                                        detected_pattern = detect_pattern_from_email(prefix, parts)
                                        if detected_pattern:
                                            result['pattern'] = detected_pattern
                                            result['confidence'] = 0.90  # High - found on real page
                                            result['source'] = f'verified:{url[:50]}'
                                            return result
                                    
                                    # Found an email that matches this person's name
                                    elif parts['first'] in prefix or parts['last'] in prefix:
                                        print(f"[EmailFinder] FOUND on page: {name} -> {email}")
                                        result['sample_emails'].append(email)
                                        detected_pattern = detect_pattern_from_email(prefix, parts)
                                        if detected_pattern:
                                            result['pattern'] = detected_pattern
                                            result['confidence'] = 0.85
                                            result['source'] = f'found:{url[:50]}'
                                            return result
                                    
                                    # Found any valid email at this domain (pattern discovery)
                                    elif email not in result['sample_emails']:
                                        print(f"[EmailFinder]   Found email: {email}")
                                        result['sample_emails'].append(email)
                                
                            except Exception as e:
                                continue  # Skip this URL, try next
                        
                        await asyncio.sleep(1)
                        
                    except Exception as e:
                        continue
                
                await asyncio.sleep(1)  # Rate limiting between employees
        
        # If we found sample emails but no verified pattern, analyze them
        if result['confidence'] < 0.5 and result['sample_emails']:
            print(f"[EmailFinder] Analyzing {len(result['sample_emails'])} sample emails found...")
            # Try to detect pattern from samples
            for email in result['sample_emails']:
                prefix = email.split('@')[0]
                # Try to match against any employee name
                for emp_name in (employee_names or []):
                    emp_parts = parse_name(emp_name)
                    if emp_parts['first'] and emp_parts['last']:
                        detected = detect_pattern_from_email(prefix, emp_parts)
                        if detected:
                            result['pattern'] = detected
                            result['confidence'] = 0.70  # Medium - found email but not for specific person
                            result['source'] = 'pattern_from_samples'
                            print(f"[EmailFinder] Pattern from samples: {detected} (70%)")
                            break
                if result['confidence'] >= 0.5:
                    break
        
        # Fallback: LLM guess if still no pattern
        if result['confidence'] < 0.5:
            print(f"[EmailFinder] No verified emails found, using LLM guess...")
            llm_result = await llm_analyze_pattern(domain, result['sample_emails'], company_name)
            
            if llm_result:
                result['pattern'] = llm_result[0]
                result['confidence'] = llm_result[1] * 0.5  # Halve LLM confidence - it's just guessing
                result['source'] = 'llm_guess'
                print(f"[EmailFinder] LLM guess: {result['pattern']} ({result['confidence']:.0%})")
        
    finally:
        await context.close()
        await browser.close()
        await pw.stop()
    
    return result


def generate_email_with_confidence(name: str, domain: str, pattern: str, pattern_confidence: float) -> Dict:
    """Generate an email with adjusted confidence based on name quality."""
    parts = parse_name(name)
    
    # Base confidence from pattern
    confidence = pattern_confidence
    
    # Adjust based on name quality
    if not parts['first']:
        return None
    
    if not parts['last']:
        # Can only use first-name patterns
        if '{last}' in pattern or '{l}' in pattern:
            pattern = '{first}'
            confidence *= 0.5
    
    # Penalize unusual names slightly
    if len(parts['first']) < 2:
        confidence *= 0.8
    
    try:
        prefix = pattern.format(**parts)
        email = f"{prefix}@{domain}"
        
        return {
            'email': email,
            'confidence': round(confidence * 100),  # Return as percentage
            'pattern': pattern
        }
    except:
        return None


# Batch processing
async def process_all_contacts(contacts: List[Dict], progress_callback=None) -> List[Dict]:
    """
    Process all contacts and generate emails with confidence scores.
    
    contacts: List of {name, domain, company} dicts
    Returns: List of {name, domain, email, confidence, pattern} dicts
    """
    # Group by domain
    by_domain = {}
    for c in contacts:
        domain = c.get('domain')
        if domain:
            if domain not in by_domain:
                by_domain[domain] = []
            by_domain[domain].append(c)
    
    results = []
    patterns_cache = {}
    
    for i, (domain, domain_contacts) in enumerate(by_domain.items()):
        if progress_callback:
            progress_callback(i + 1, len(by_domain), domain)
        
        # Discover pattern for this domain
        pattern_data = await discover_company_pattern(
            domain, 
            domain_contacts[0].get('company')
        )
        patterns_cache[domain] = pattern_data
        
        # Generate emails for all contacts at this domain
        for contact in domain_contacts:
            email_data = generate_email_with_confidence(
                contact['name'],
                domain,
                pattern_data['pattern'],
                pattern_data['confidence']
            )
            
            if email_data:
                results.append({
                    'name': contact['name'],
                    'title': contact.get('title'),
                    'company': contact.get('company'),
                    'domain': domain,
                    'email': email_data['email'],
                    'confidence': email_data['confidence'],
                    'pattern': email_data['pattern'],
                    'sample_emails': pattern_data['sample_emails'][:3]
                })
        
        # Small delay between domains
        await asyncio.sleep(2)
    
    return results

