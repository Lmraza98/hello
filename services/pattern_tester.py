"""
Pattern Tester: Send test emails to discover which pattern works per domain.
Pick one person per company, try all patterns, see what bounces.
"""
from typing import Dict, List
import database as db


def get_test_candidates() -> List[Dict]:
    """
    Get one person per company to use as a test recipient.
    Prefers CEO/President/Owner types since they're most public.
    """
    with db.get_db() as conn:
        cursor = conn.cursor()
        # Get one person per domain, preferring executives
        cursor.execute("""
            SELECT 
                id, domain, company, name, title,
                CASE 
                    WHEN LOWER(title) LIKE '%ceo%' THEN 1
                    WHEN LOWER(title) LIKE '%president%' THEN 2
                    WHEN LOWER(title) LIKE '%owner%' THEN 3
                    WHEN LOWER(title) LIKE '%founder%' THEN 4
                    WHEN LOWER(title) LIKE '%chief%' THEN 5
                    ELSE 10
                END as rank
            FROM linkedin_contacts
            ORDER BY domain, rank, id
        """)
        
        rows = cursor.fetchall()
    
    # Take first (best ranked) person per domain
    seen_domains = set()
    candidates = []
    
    for row in rows:
        d = dict(row)
        if d['domain'] not in seen_domains:
            seen_domains.add(d['domain'])
            candidates.append(d)
    
    return candidates


def generate_test_emails(name: str, domain: str) -> List[Dict]:
    """
    Generate all pattern variants for one person.
    Returns list of {pattern, email} dicts.
    """
    import re
    
    # Parse name
    clean = re.sub(r',?\s*(Jr\.?|Sr\.?|III|II|PhD|MBA|MD|P\.?E\.?)$', '', name, flags=re.IGNORECASE)
    parts = clean.strip().split()
    
    if len(parts) < 2:
        return []
    
    first = re.sub(r'[^a-z]', '', parts[0].lower())
    last = re.sub(r'[^a-z-]', '', parts[-1].lower())
    
    if not first or not last:
        return []
    
    patterns = [
        {'pattern': 'first.last', 'email': f'{first}.{last}@{domain}'},
        {'pattern': 'flast', 'email': f'{first[0]}{last}@{domain}'},
        {'pattern': 'firstlast', 'email': f'{first}{last}@{domain}'},
        {'pattern': 'first_last', 'email': f'{first}_{last}@{domain}'},
        {'pattern': 'first', 'email': f'{first}@{domain}'},
    ]
    
    return patterns


def create_test_queue() -> List[Dict]:
    """
    Create a queue of test emails to send.
    One person per company, all patterns.
    """
    candidates = get_test_candidates()
    test_queue = []
    
    for person in candidates:
        variants = generate_test_emails(person['name'], person['domain'])
        
        for v in variants:
            test_queue.append({
                'domain': person['domain'],
                'company': person['company'],
                'name': person['name'],
                'title': person['title'],
                'pattern': v['pattern'],
                'email': v['email'],
                'status': 'pending'  # pending -> sent -> bounced/delivered
            })
    
    return test_queue


def get_test_email_body(name: str, company: str) -> str:
    """Generate a simple test email that looks legitimate."""
    first_name = name.split()[0] if name else "there"
    
    return f"""Hi {first_name},

I hope this email finds you well. I'm reaching out to connect with the right person at {company or 'your company'} regarding a business opportunity.

If you're not the best contact, I'd appreciate being pointed in the right direction.

Best regards"""


def print_test_summary(test_queue: List[Dict]):
    """Print summary of test queue."""
    domains = set(t['domain'] for t in test_queue)
    
    print(f"\nTest Email Plan:")
    print(f"  Companies: {len(domains)}")
    print(f"  Test emails: {len(test_queue)}")
    print(f"  Patterns per company: ~{len(test_queue) // len(domains) if domains else 0}")
    
    print(f"\nSample (first company):")
    first_domain = list(domains)[0] if domains else None
    if first_domain:
        for t in test_queue:
            if t['domain'] == first_domain:
                print(f"    {t['pattern']:12} -> {t['email']}")


async def check_bounce_status_salesforce(page, email: str) -> Dict:
    """
    Check if an email bounced in Salesforce.
    Searches for the Lead and checks bounce indicators.
    Returns {bounced: bool, reason: str}
    """
    result = {'email': email, 'bounced': None, 'reason': None}
    
    try:
        # Search for the Lead by email
        search_url = f"https://your-instance.lightning.force.com/lightning/o/Lead/list?filterName=Recent"
        
        # Use global search
        await page.get_by_placeholder("Search").click()
        await page.get_by_placeholder("Search").fill(email)
        await page.keyboard.press("Enter")
        await page.wait_for_timeout(3000)
        
        # Look for bounce indicators in the page
        page_text = await page.evaluate("document.body.innerText")
        
        # Common bounce indicators in Salesforce
        bounce_indicators = [
            'email bounced',
            'invalid email',
            'undeliverable',
            'bounce',
            'hard bounce',
            'soft bounce'
        ]
        
        for indicator in bounce_indicators:
            if indicator in page_text.lower():
                result['bounced'] = True
                result['reason'] = indicator
                return result
        
        # If we found the record but no bounce indicator
        result['bounced'] = False
        
    except Exception as e:
        result['reason'] = f'Error checking: {str(e)}'
    
    return result


def determine_winning_pattern(test_results: List[Dict]) -> Dict[str, str]:
    """
    Analyze test results to find the winning pattern per domain.
    Returns {domain: winning_pattern}
    """
    from collections import defaultdict
    
    # Group by domain
    by_domain = defaultdict(list)
    for r in test_results:
        by_domain[r['domain']].append(r)
    
    winners = {}
    
    for domain, results in by_domain.items():
        # Find patterns that didn't bounce
        non_bounced = [r for r in results if r.get('bounced') == False]
        
        if len(non_bounced) == 1:
            # Perfect - exactly one pattern worked
            winners[domain] = non_bounced[0]['pattern']
        elif len(non_bounced) > 1:
            # Multiple worked - prefer first.last (most common)
            for preferred in ['first.last', 'flast', 'firstlast']:
                for r in non_bounced:
                    if r['pattern'] == preferred:
                        winners[domain] = preferred
                        break
                if domain in winners:
                    break
        else:
            # All bounced - person might not exist or domain is wrong
            winners[domain] = None
    
    return winners

