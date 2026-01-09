"""
Email Pattern Discovery: Use Google search + LLM to discover company email patterns.
Then generate emails for employee names.
"""
import asyncio
import re
import json
from typing import List, Dict, Optional, Tuple
from playwright.async_api import async_playwright, Page
from openai import OpenAI

import config
import database as db
from services.name_normalizer import parse_name_for_email


# Common email patterns to try
EMAIL_PATTERNS = [
    '{first}.{last}',           # john.smith
    '{first}{last}',            # johnsmith
    '{f}{last}',                # jsmith
    '{first}_{last}',           # john_smith
    '{first}-{last}',           # john-smith
    '{last}.{first}',           # smith.john
    '{last}{first}',            # smithjohn
    '{last}{f}',                # smithj
    '{first}',                  # john
    '{last}',                   # smith
    '{f}.{last}',               # j.smith
    '{first}{l}',               # johns
    '{f}{l}',                   # js
]


def parse_name(full_name: str) -> Tuple[str, str, str, str]:
    """
    Parse a full name into components for email generation.
    Uses particle-aware normalization (De Jesus -> dejesus, San Miguel -> sanmiguel).
    
    Returns: (first, last, first_initial, last_initial)
    
    Note: Last name has spaces removed for email generation.
    """
    return parse_name_for_email(full_name)


def generate_email_variants(name: str, domain: str) -> List[str]:
    """
    Generate all possible email variants for a name at a domain.
    """
    first, last, f, l = parse_name(name)
    
    if not first:
        return []
    
    emails = []
    for pattern in EMAIL_PATTERNS:
        try:
            email_prefix = pattern.format(
                first=first,
                last=last,
                f=f,
                l=l
            )
            # Skip patterns that didn't fully resolve
            if '{' not in email_prefix and email_prefix:
                emails.append(f"{email_prefix}@{domain}")
        except (KeyError, IndexError):
            continue
    
    return list(set(emails))  # Dedupe


async def search_google_for_emails(domain: str, page: Page) -> List[str]:
    """
    Search Google for known emails from a domain.
    """
    emails = []
    
    # Search queries to find email patterns
    queries = [
        f'site:{domain} email',
        f'"{domain}" email contact',
        f'@{domain}',
    ]
    
    for query in queries[:2]:  # Limit to avoid rate limiting
        try:
            search_url = f"https://www.google.com/search?q={query}"
            await page.goto(search_url, timeout=15000)
            await asyncio.sleep(2)
            
            # Get page text
            content = await page.content()
            
            # Find emails in the results
            email_pattern = rf'\b[\w.+-]+@{re.escape(domain)}\b'
            found = re.findall(email_pattern, content.lower())
            emails.extend(found)
            
            await asyncio.sleep(1)  # Rate limit
            
        except Exception as e:
            print(f"[EmailPattern] Google search error: {e}")
            continue
    
    return list(set(emails))


def analyze_email_pattern(emails: List[str], domain: str) -> Optional[str]:
    """
    Analyze found emails to determine the company's email pattern.
    Returns the pattern string or None.
    """
    if not emails:
        return None
    
    patterns_found = {}
    
    for email in emails:
        prefix = email.split('@')[0].lower()
        
        # Try to match against known patterns
        # Check for firstname.lastname pattern
        if '.' in prefix:
            parts = prefix.split('.')
            if len(parts) == 2:
                if len(parts[0]) > 1 and len(parts[1]) > 1:
                    patterns_found['{first}.{last}'] = patterns_found.get('{first}.{last}', 0) + 1
                elif len(parts[0]) == 1:
                    patterns_found['{f}.{last}'] = patterns_found.get('{f}.{last}', 0) + 1
        
        # Check for firstlast pattern
        elif len(prefix) > 5 and prefix.isalpha():
            patterns_found['{first}{last}'] = patterns_found.get('{first}{last}', 0) + 1
        
        # Check for flast pattern
        elif len(prefix) > 2 and len(prefix) < 10 and prefix.isalpha():
            patterns_found['{f}{last}'] = patterns_found.get('{f}{last}', 0) + 1
    
    if patterns_found:
        # Return most common pattern
        return max(patterns_found, key=patterns_found.get)
    
    return None


async def discover_pattern_with_llm(domain: str, sample_emails: List[str]) -> Optional[str]:
    """
    Use LLM to analyze email samples and determine the pattern.
    """
    if not sample_emails or not config.OPENAI_API_KEY:
        return None
    
    client = OpenAI(api_key=config.OPENAI_API_KEY)
    
    prompt = f"""Analyze these email addresses from {domain} and determine the naming pattern:

Emails found:
{chr(10).join(sample_emails[:10])}

What pattern does this company use? Respond with ONLY one of these patterns:
- first.last (e.g., john.smith@company.com)
- firstlast (e.g., johnsmith@company.com)  
- flast (e.g., jsmith@company.com)
- first_last (e.g., john_smith@company.com)
- first (e.g., john@company.com)
- f.last (e.g., j.smith@company.com)
- lastfirst (e.g., smithjohn@company.com)
- unknown (if you can't determine)

Pattern:"""

    try:
        response = client.chat.completions.create(
            model=config.LLM_MODEL,
            messages=[{"role": "user", "content": prompt}],
            max_tokens=20,
            temperature=0
        )
        
        pattern = response.choices[0].message.content.strip().lower()
        
        # Map response to our pattern format
        pattern_map = {
            'first.last': '{first}.{last}',
            'firstlast': '{first}{last}',
            'flast': '{f}{last}',
            'first_last': '{first}_{last}',
            'first': '{first}',
            'f.last': '{f}.{last}',
            'lastfirst': '{last}{first}',
        }
        
        return pattern_map.get(pattern)
        
    except Exception as e:
        print(f"[EmailPattern] LLM error: {e}")
        return None


async def discover_email_pattern(domain: str) -> Dict:
    """
    Full pipeline to discover a company's email pattern.
    Uses Google search + optional LLM analysis.
    """
    result = {
        'domain': domain,
        'pattern': None,
        'sample_emails': [],
        'confidence': 0
    }
    
    playwright = await async_playwright().start()
    browser = await playwright.chromium.launch(headless=True)
    page = await browser.new_page()
    
    try:
        # Search Google for existing emails
        print(f"[EmailPattern] Searching for emails at {domain}...")
        emails = await search_google_for_emails(domain, page)
        result['sample_emails'] = emails[:10]
        
        if emails:
            print(f"[EmailPattern] Found {len(emails)} sample emails")
            
            # Try rule-based analysis first
            pattern = analyze_email_pattern(emails, domain)
            
            if pattern:
                result['pattern'] = pattern
                result['confidence'] = 0.8
            else:
                # Fall back to LLM
                pattern = await discover_pattern_with_llm(domain, emails)
                if pattern:
                    result['pattern'] = pattern
                    result['confidence'] = 0.6
        
        if not result['pattern']:
            # Default to most common pattern
            result['pattern'] = '{first}.{last}'
            result['confidence'] = 0.3
            print(f"[EmailPattern] No pattern found, defaulting to first.last")
        else:
            print(f"[EmailPattern] Detected pattern: {result['pattern']} (confidence: {result['confidence']})")
        
    finally:
        await browser.close()
        await playwright.stop()
    
    return result


def generate_email_for_contact(name: str, domain: str, pattern: str = None) -> str:
    """
    Generate an email for a contact using the discovered pattern.
    """
    if not pattern:
        pattern = '{first}.{last}'
    
    first, last, f, l = parse_name(name)
    
    if not first:
        return None
    
    # If no last name, use simpler pattern
    if not last:
        pattern = '{first}'
    
    try:
        prefix = pattern.format(first=first, last=last, f=f, l=l)
        return f"{prefix}@{domain}"
    except (KeyError, IndexError):
        return f"{first}@{domain}"


# Database functions for patterns

def save_email_pattern(domain: str, pattern: str, confidence: float, sample_emails: List[str]):
    """Save discovered email pattern to database."""
    with db.get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            INSERT OR REPLACE INTO email_patterns 
            (domain, pattern, confidence, sample_emails, discovered_at)
            VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
        """, (domain, pattern, confidence, json.dumps(sample_emails)))


def get_email_pattern(domain: str) -> Optional[Dict]:
    """Get stored email pattern for a domain."""
    with db.get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT pattern, confidence, sample_emails FROM email_patterns
            WHERE domain = ?
        """, (domain,))
        row = cursor.fetchone()
        if row:
            return {
                'pattern': row['pattern'],
                'confidence': row['confidence'],
                'sample_emails': json.loads(row['sample_emails']) if row['sample_emails'] else []
            }
    return None


def init_patterns_table():
    """Initialize email patterns table."""
    with db.get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS email_patterns (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                domain TEXT NOT NULL UNIQUE,
                pattern TEXT,
                confidence REAL,
                sample_emails TEXT,
                discovered_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_patterns_domain ON email_patterns(domain)")


# Initialize table on import
init_patterns_table()


