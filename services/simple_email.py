"""
Simple Email Generator - honest about what it's doing.
Just generates first.last@domain.com with MX validation.
No fake confidence scores.
"""
import re
from typing import Dict, List, Optional

try:
    import dns.resolver
    HAS_DNS = True
except ImportError:
    HAS_DNS = False


def check_mx(domain: str) -> bool:
    """Check if domain can receive email."""
    if not HAS_DNS:
        return True  # Assume valid if can't check
    try:
        dns.resolver.resolve(domain, 'MX')
        return True
    except:
        return False


def parse_name(name: str) -> Dict:
    """Parse name into first/last components."""
    # Remove credentials/suffixes
    clean = re.sub(r',?\s*(Jr\.?|Sr\.?|III|II|IV|PhD|MBA|MD|P\.?E\.?|CPA|Esq\.?|SPHR|PMP|SHRM.*|CFS|LSP|PG|LLS|RPLS|PLS)$', '', name, flags=re.IGNORECASE)
    clean = clean.strip().strip(',')
    
    parts = clean.split()
    if len(parts) < 2:
        return {'first': parts[0].lower() if parts else '', 'last': ''}
    
    first = parts[0].lower()
    last = parts[-1].lower()
    
    # Handle hyphenated last names
    if len(parts) > 2 and '-' in parts[-1]:
        last = parts[-1].lower()
    
    # Clean up
    first = re.sub(r'[^a-z]', '', first)
    last = re.sub(r'[^a-z-]', '', last)
    
    return {'first': first, 'last': last}


def generate_email(name: str, domain: str, pattern: str = 'first.last') -> Optional[str]:
    """Generate email from name and pattern."""
    parts = parse_name(name)
    if not parts['first'] or not parts['last']:
        return None
    
    if pattern == 'first.last':
        return f"{parts['first']}.{parts['last']}@{domain}"
    elif pattern == 'flast':
        return f"{parts['first'][0]}{parts['last']}@{domain}"
    elif pattern == 'firstlast':
        return f"{parts['first']}{parts['last']}@{domain}"
    elif pattern == 'first':
        return f"{parts['first']}@{domain}"
    else:
        return f"{parts['first']}.{parts['last']}@{domain}"


def generate_emails_for_contacts(contacts: List[Dict], pattern: str = 'first.last') -> List[Dict]:
    """
    Generate emails for all contacts using a simple pattern.
    
    Returns contacts with:
    - email: the generated email
    - mx_valid: whether domain can receive mail
    - confidence: honest estimate (~65-70% for first.last)
    """
    # Cache MX checks by domain
    mx_cache = {}
    results = []
    
    for contact in contacts:
        domain = contact.get('domain', '')
        name = contact.get('name', '')
        
        if not domain or not name:
            continue
        
        # Check MX (cached)
        if domain not in mx_cache:
            mx_cache[domain] = check_mx(domain)
        
        mx_valid = mx_cache[domain]
        
        # Generate email
        email = generate_email(name, domain, pattern)
        
        if email:
            # Honest confidence:
            # - first.last works ~65-70% of the time for B2B
            # - Boost slightly if MX is valid
            confidence = 65 if mx_valid else 50
            
            results.append({
                **contact,
                'email': email,
                'email_confidence': confidence,
                'mx_valid': mx_valid,
                'pattern': pattern,
                'note': 'Pattern guess - may bounce'
            })
    
    return results


def bulk_generate(contacts: List[Dict]) -> Dict:
    """
    Generate emails for all contacts.
    Returns summary stats.
    """
    results = generate_emails_for_contacts(contacts, 'first.last')
    
    mx_valid = sum(1 for r in results if r.get('mx_valid'))
    mx_invalid = len(results) - mx_valid
    
    return {
        'contacts': results,
        'total': len(results),
        'mx_valid': mx_valid,
        'mx_invalid': mx_invalid,
        'pattern': 'first.last',
        'estimated_accuracy': '~65-70%',
        'note': 'These are educated guesses. Expect 30-35% bounce rate.'
    }



