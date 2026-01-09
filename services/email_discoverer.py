"""
Email Pattern Discovery using Web Search + LLM.

Uses Tavily for web search and GPT-4o to analyze and determine
the email pattern for each company.
"""
import re
import json
from typing import Optional, Dict, List
from openai import OpenAI
import requests

import config
from services.name_normalizer import normalize_name


def search_company_emails(company_name: str, domain: str = None) -> Dict:
    """
    Search the web for email pattern information about a company.
    
    Args:
        company_name: Company name to search for
        domain: Optional domain to include in search
        
    Returns:
        Dict with search results
    """
    if not config.TAVILY_API_KEY:
        return {'error': 'TAVILY_API_KEY not configured', 'results': []}
    
    # Build search query
    if domain and '.' in domain:
        query = f"{company_name} email format @{domain} contact"
    else:
        query = f"{company_name} employee email format pattern contact"
    
    try:
        response = requests.post(
            "https://api.tavily.com/search",
            json={
                "api_key": config.TAVILY_API_KEY,
                "query": query,
                "search_depth": "basic",
                "include_answer": True,
                "max_results": 5
            },
            timeout=30
        )
        response.raise_for_status()
        return response.json()
    except Exception as e:
        print(f"[EmailDiscoverer] Search error for {company_name}: {e}")
        return {'error': str(e), 'results': []}


VALID_PATTERNS = [
    'first.last',   # john.smith@
    'firstlast',    # johnsmith@
    'flast',        # jsmith@
    'first_last',   # john_smith@
    'first-last',   # john-last@
    'first',        # john@
    'f.last',       # j.smith@
    'last.first',   # smith.john@
    'lastfirst',    # smithjohn@
    'last_first',   # smith_john@
    'last',         # smith@
    'lfirst',       # sjohn@
    'fl',           # js@
]


def analyze_pattern_with_llm(company_name: str, domain: str, search_results: Dict) -> Dict:
    """
    Use GPT-4o to analyze search results and determine email pattern.
    
    Returns:
        Dict with pattern info: {pattern, confidence, examples, reasoning}
    """
    if not config.OPENAI_API_KEY:
        return {'pattern': 'first.last', 'confidence': 0.3, 'reasoning': 'No API key'}
    
    # Build context from search results
    context_parts = []
    if search_results.get('answer'):
        context_parts.append(f"Summary: {search_results['answer']}")
    
    for result in search_results.get('results', [])[:5]:
        content = result.get('content', '')[:500]
        context_parts.append(f"- {result.get('title', '')}: {content}")
    
    context = "\n".join(context_parts) if context_parts else "No search results found."
    
    patterns_list = "\n".join([f"- {p}" for p in VALID_PATTERNS])
    
    prompt = f"""Analyze the email pattern and domain used by {company_name}.

Web search results:
{context}

Your task:
1. Find the ACTUAL email domain this company uses (e.g., @accesscorp.com, NOT a guess like @accessinformationmanagement.com)
2. Determine the email format/pattern

You MUST choose the pattern from ONLY these options:
{patterns_list}

Pattern examples:
- first.last = john.smith@company.com
- firstlast = johnsmith@company.com  
- flast = jsmith@company.com (first initial + last name)
- f.last = j.smith@company.com
- first_last = john_smith@company.com

Respond in JSON format:
{{
    "domain": "accesscorp.com",
    "pattern": "flast",
    "confidence": 0.8,
    "examples_found": ["jsmith@accesscorp.com", "mwilliams@accesscorp.com"],
    "reasoning": "Found real emails showing domain is accesscorp.com with flast pattern"
}}

IMPORTANT: 
- The "domain" field should be the ACTUAL email domain found in examples, not a guess
- If you can't find the real domain, use null for domain
- The "pattern" field MUST be exactly one of: {', '.join(VALID_PATTERNS)}
Respond ONLY with the JSON, no other text."""

    try:
        client = OpenAI(api_key=config.OPENAI_API_KEY)
        response = client.chat.completions.create(
            model=config.LLM_MODEL_SMART,
            messages=[{"role": "user", "content": prompt}],
            max_tokens=300,
            temperature=0
        )
        
        result_text = response.choices[0].message.content.strip()
        # Clean up markdown if present
        result_text = re.sub(r'^```json\s*', '', result_text)
        result_text = re.sub(r'\s*```$', '', result_text)
        
        result = json.loads(result_text)
        
        # Validate and normalize the pattern
        pattern = result.get('pattern', 'first.last').lower().replace(' ', '').replace('_', '_')
        
        # Map common variations to valid patterns
        pattern_aliases = {
            'firstname.lastname': 'first.last',
            'firstnamelastname': 'firstlast',
            'firstinitiallastname': 'flast',
            'firstnameinitiallastnameInitial': 'fl',
            'firstnameinitial.lastnameinitial': 'fl',
            'f_last': 'f.last',
            'last_name': 'last',
            'first_name': 'first',
        }
        pattern = pattern_aliases.get(pattern, pattern)
        
        # If still not valid, default to first.last
        if pattern not in VALID_PATTERNS:
            print(f"[EmailDiscoverer] Invalid pattern '{pattern}' returned, defaulting to first.last")
            pattern = 'first.last'
            result['confidence'] = min(result.get('confidence', 0.5), 0.5)
        
        result['pattern'] = pattern
        return result
        
    except Exception as e:
        print(f"[EmailDiscoverer] LLM error for {company_name}: {e}")
        return {
            'pattern': 'first.last',
            'confidence': 0.3,
            'reasoning': f'LLM error: {str(e)}'
        }


def discover_email_pattern(company_name: str, domain_hint: str = None) -> Dict:
    """
    Full pipeline: search web + analyze with LLM to discover email pattern AND domain.
    
    Args:
        company_name: Company name
        domain_hint: Optional domain hint (may be overridden by discovered domain)
        
    Returns:
        Dict with pattern, discovered domain, and metadata
    """
    print(f"[EmailDiscoverer] Discovering pattern for {company_name}...")
    
    # Step 1: Web search
    search_results = search_company_emails(company_name, domain_hint)
    
    if search_results.get('error'):
        print(f"[EmailDiscoverer] Search failed: {search_results['error']}")
        # Fall back to default
        return {
            'company': company_name,
            'domain': domain_hint,
            'domain_discovered': False,
            'pattern': 'first.last',
            'confidence': 0.3,
            'reasoning': 'Search failed, using default'
        }
    
    # Step 2: Analyze with LLM - discovers BOTH pattern AND actual domain
    analysis = analyze_pattern_with_llm(company_name, domain_hint or company_name, search_results)
    
    # Use discovered domain if found, otherwise fall back to hint
    discovered_domain = analysis.get('domain')
    if discovered_domain and isinstance(discovered_domain, str) and '.' in discovered_domain:
        # Clean up domain
        discovered_domain = discovered_domain.lower().strip()
        if discovered_domain.startswith('@'):
            discovered_domain = discovered_domain[1:]
        final_domain = discovered_domain
        domain_discovered = True
    else:
        final_domain = domain_hint
        domain_discovered = False
    
    result = {
        'company': company_name,
        'domain': final_domain,
        'domain_discovered': domain_discovered,
        'pattern': analysis.get('pattern', 'first.last'),
        'confidence': analysis.get('confidence', 0.5),
        'examples': analysis.get('examples_found', []),
        'reasoning': analysis.get('reasoning', '')
    }
    
    domain_status = "✓" if domain_discovered else "?"
    print(f"[EmailDiscoverer] {company_name}: {result['pattern']} @ {final_domain} [{domain_status}] (confidence: {result['confidence']})")
    return result


def generate_email(name: str, pattern: str, domain: str) -> str:
    """
    Generate email address from name using discovered pattern.
    
    Args:
        name: Full name (e.g., "John Smith")
        pattern: Pattern string (e.g., "first.last", "flast")
        domain: Email domain (e.g., "acme.com")
    """
    normalized = normalize_name(name)
    
    first = normalized.first.lower() if normalized.first else ''
    # Remove spaces from last name for email
    last = re.sub(r'\s+', '', normalized.last.lower()) if normalized.last else ''
    f = normalized.first_initial
    l = normalized.last_initial
    
    if not first:
        return ''
    
    # Map pattern string to format
    pattern_map = {
        'first.last': f'{first}.{last}',
        'firstlast': f'{first}{last}',
        'flast': f'{f}{last}',
        'first_last': f'{first}_{last}',
        'first-last': f'{first}-{last}',
        'first': first,
        'f.last': f'{f}.{last}',
        'lastfirst': f'{last}{first}',
        'last.first': f'{last}.{first}',
        'last_first': f'{last}_{first}',
        'last': last,
        'lfirst': f'{l}{first}',
        'fl': f'{f}{l}',
    }
    
    prefix = pattern_map.get(pattern, f'{first}.{last}')
    
    # Clean up any double dots, underscores, or empty parts
    prefix = re.sub(r'\.+', '.', prefix)
    prefix = re.sub(r'_+', '_', prefix)
    prefix = re.sub(r'-+', '-', prefix)
    prefix = prefix.strip('.').strip('_').strip('-')
    
    if prefix and domain:
        return f'{prefix}@{domain}'
    return ''


def process_linkedin_contacts_with_patterns(output_path: str = None, today_only: bool = False) -> Dict:
    """
    Process LinkedIn contacts: discover patterns and generate emails.
    
    Args:
        output_path: Path for output CSV
        today_only: If True, only process contacts scraped today
    
    Returns summary of processing.
    """
    import csv
    from datetime import datetime
    import database as db
    
    if output_path is None:
        if today_only:
            date_str = datetime.now().strftime('%Y-%m-%d')
            output_path = str(config.DATA_DIR / f"linkedin_contacts_{date_str}.csv")
        else:
            output_path = str(config.DATA_DIR / "linkedin_contacts_with_emails.csv")
    
    # Get all contacts grouped by company
    conn = db.get_connection()
    cursor = conn.cursor()
    
    # Build date filter
    date_filter = ""
    if today_only:
        today = datetime.now().strftime('%Y-%m-%d')
        date_filter = f"AND DATE(scraped_at) = '{today}'"
        print(f"[EmailDiscoverer] Filtering for contacts scraped on {today}")
    
    # Get unique companies
    cursor.execute(f'''
        SELECT DISTINCT 
            COALESCE(company_name, domain) as company,
            domain
        FROM linkedin_contacts 
        WHERE name IS NOT NULL {date_filter}
    ''')
    companies = cursor.fetchall()
    
    if not companies:
        print(f"[EmailDiscoverer] No contacts found{' for today' if today_only else ''}")
        return {'contacts': 0, 'companies': 0, 'output_path': output_path, 'patterns': {}}
    
    print(f"[EmailDiscoverer] Processing {len(companies)} companies...")
    
    # Discover pattern AND domain for each company
    patterns = {}
    for row in companies:
        company = row['company']
        domain_slug = row['domain']
        
        # Convert slug to a domain hint (may be overridden by discovery)
        if domain_slug and '.' not in domain_slug:
            domain_hint = domain_slug.replace('-', '') + '.com'
        else:
            domain_hint = domain_slug
        
        if company not in patterns:
            result = discover_email_pattern(company, domain_hint)
            patterns[company] = {
                'pattern': result['pattern'],
                'domain': result['domain'],  # Use discovered domain
                'domain_discovered': result.get('domain_discovered', False),
                'confidence': result['confidence']
            }
    
    # Get all contacts and generate emails
    cursor.execute(f'''
        SELECT 
            COALESCE(company_name, domain) as company,
            domain,
            name,
            title,
            scraped_at
        FROM linkedin_contacts 
        WHERE name IS NOT NULL {date_filter}
        ORDER BY company, name
    ''')
    contacts = cursor.fetchall()
    
    # Write to CSV
    with open(output_path, 'w', newline='', encoding='utf-8') as f:
        writer = csv.writer(f)
        writer.writerow([
            'Company', 'Name', 'First_Name', 'Last_Name', 'Title', 
            'Email', 'Email_Pattern', 'Pattern_Confidence', 'Domain', 'Domain_Verified'
        ])
        
        for contact in contacts:
            company = contact['company']
            name = contact['name']
            
            # Get pattern for this company
            pattern_info = patterns.get(company, {'pattern': 'first.last', 'domain': None, 'confidence': 0.3, 'domain_discovered': False})
            
            # Normalize name
            normalized = normalize_name(name)
            
            # Use discovered domain, or fall back to guessed domain
            domain = pattern_info.get('domain')
            domain_verified = pattern_info.get('domain_discovered', False)
            
            if not domain:
                domain_slug = contact['domain']
                domain = domain_slug.replace('-', '') + '.com' if domain_slug and '.' not in domain_slug else domain_slug
                domain_verified = False
            
            email = generate_email(name, pattern_info['pattern'], domain)
            
            writer.writerow([
                company,
                name,
                normalized.first,
                normalized.last,
                contact['title'],
                email,
                pattern_info['pattern'],
                pattern_info['confidence'],
                domain,
                'Yes' if domain_verified else 'No'
            ])
    
    print(f"\n[EmailDiscoverer] Exported {len(contacts)} contacts to {output_path}")
    print(f"[EmailDiscoverer] Discovered patterns for {len(patterns)} companies")
    
    return {
        'contacts': len(contacts),
        'companies': len(patterns),
        'output_path': output_path,
        'patterns': patterns
    }


if __name__ == '__main__':
    # Test with a single company
    result = discover_email_pattern("Haley & Aldrich", "haleyaldrich.com")
    print(json.dumps(result, indent=2))

