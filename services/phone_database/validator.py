"""
Phone Number Validator - Production Quality

Validates and enriches phone numbers using PhoneInfoga (FREE, prioritized) and optionally Twilio.
PhoneInfoga provides OSINT data including owner names, carrier info, and more.

PhoneInfoga Methods:
1. CLI tool (phoneinfoga scan -n <number>)
2. Web scraping known directories
3. API integrations (NumVerify, etc.)

Name Extraction Strategy:
- PhoneInfoga returns data from multiple sources
- We parse all available fields to extract owner names
- Cross-reference with known name patterns
"""
import re
import subprocess
import json
import tempfile
import os
import asyncio
import aiohttp
from typing import Optional, Dict, List, Tuple
from urllib.parse import quote

import config


# Common name patterns to identify real names vs spam/generic text
NAME_PATTERNS = [
    r'^[A-Z][a-z]+ [A-Z][a-z]+$',  # "John Smith"
    r'^[A-Z][a-z]+ [A-Z]\. [A-Z][a-z]+$',  # "John A. Smith"
    r'^[A-Z][a-z]+ [A-Z][a-z]+ [A-Z][a-z]+$',  # "John Michael Smith"
    r'^[A-Z][a-z]+, [A-Z][a-z]+$',  # "Smith, John"
]

# Skip these as they're not real names
SKIP_NAME_PATTERNS = [
    'unknown', 'not available', 'n/a', 'none', 'null', 'private', 
    'unlisted', 'restricted', 'caller', 'wireless', 'landline',
    'voip', 'mobile', 'cell', 'phone', 'number', 'contact',
    'business', 'company', 'corp', 'llc', 'inc',
]


def is_valid_name(name: str) -> bool:
    """Check if a string looks like a valid person name."""
    if not name or len(name) < 3:
        return False
    
    name_lower = name.lower().strip()
    
    # Skip known invalid patterns
    for skip in SKIP_NAME_PATTERNS:
        if skip in name_lower:
            return False
    
    # Must contain at least one space (first + last name)
    if ' ' not in name.strip():
        return False
    
    # Must start with a capital letter
    if not name[0].isupper():
        return False
    
    # Must be mostly letters and spaces
    clean = re.sub(r'[^a-zA-Z\s\.\-]', '', name)
    if len(clean) < len(name) * 0.8:
        return False
    
    return True


def clean_name(name: str) -> str:
    """Clean and normalize a name string."""
    if not name:
        return None
    
    name = name.strip()
    
    # Remove common prefixes/suffixes
    name = re.sub(r'^(Mr\.?|Mrs\.?|Ms\.?|Dr\.?|Prof\.?)\s+', '', name, flags=re.IGNORECASE)
    name = re.sub(r'\s+(Jr\.?|Sr\.?|II|III|IV)$', '', name, flags=re.IGNORECASE)
    
    # Remove extra whitespace
    name = ' '.join(name.split())
    
    # Title case normalization
    parts = name.split()
    normalized_parts = []
    for part in parts:
        if len(part) <= 2:  # Keep initials as-is
            normalized_parts.append(part.upper() if len(part) == 1 else part)
        else:
            normalized_parts.append(part.capitalize())
    
    return ' '.join(normalized_parts)


def extract_name_from_text(text: str) -> Optional[str]:
    """Extract a name from unstructured text."""
    if not text:
        return None
    
    # Try common patterns
    patterns = [
        r'(?:owner|subscriber|registered to|belongs to|name)[:\s]+([A-Z][a-z]+ [A-Z][a-z]+)',
        r'([A-Z][a-z]+ [A-Z][a-z]+)(?:\s+is the owner)',
        r'(?:contact|person)[:\s]+([A-Z][a-z]+ [A-Z][a-z]+)',
        r'^([A-Z][a-z]+ [A-Z][a-z]+)$',  # Just a name by itself
    ]
    
    for pattern in patterns:
        match = re.search(pattern, text, re.MULTILINE | re.IGNORECASE)
        if match:
            candidate = match.group(1)
            if is_valid_name(candidate):
                return clean_name(candidate)
    
    return None


async def validate_phone_via_twilio(phone: str) -> Optional[Dict]:
    """
    Validate phone and get carrier info using Twilio Lookup API.
    NOTE: Costs money (~$0.005/lookup). Disabled by default.
    
    Free tier: ~1000 lookups/month for new accounts.
    
    Args:
        phone: Phone number in any format
    
    Returns:
        Dictionary with phone validation data or None
    """
    if not config.TWILIO_ACCOUNT_SID or not config.TWILIO_AUTH_TOKEN:
        return None
    
    try:
        from twilio.rest import Client
        
        client = Client(config.TWILIO_ACCOUNT_SID, config.TWILIO_AUTH_TOKEN)
        
        # Clean phone number for Twilio (E.164 format)
        clean_phone = re.sub(r'[^\d]', '', phone)
        if len(clean_phone) == 10:
            clean_phone = f"+1{clean_phone}"  # Add US country code
        elif len(clean_phone) == 11 and clean_phone[0] == '1':
            clean_phone = f"+{clean_phone}"
        elif not clean_phone.startswith('+'):
            clean_phone = f"+{clean_phone}"
        
        # Twilio Lookup API
        phone_number = client.lookups.v1.phone_numbers(clean_phone).fetch(
            type=['carrier']  # Include carrier info
        )
        
        return {
            'phone': phone,
            'carrier': phone_number.carrier.get('name') if phone_number.carrier else None,
            'line_type': phone_number.carrier.get('type') if phone_number.carrier else None,
            'country': phone_number.country_code,
            'valid': phone_number.phone_number is not None,
            'source': 'twilio_lookup',
            'confidence': 0.95 if phone_number.phone_number else 0.3
        }
    except Exception as e:
        error_str = str(e)
        if '20003' in error_str or '20001' in error_str:
            # Invalid credentials
            pass
        elif '20404' in error_str:
            # Number not found
            return {
                'phone': phone,
                'valid': False,
                'source': 'twilio_lookup',
                'confidence': 0.3
            }
        return None


async def enrich_phone_via_phoneinfoga_cli(phone: str) -> Optional[Dict]:
    """
    Use PhoneInfoga via Docker for phone validation and OSINT.
    This is the PRIMARY method - FREE and provides name data.
    
    Docker command: docker run --rm sundowndev/phoneinfoga scan -n <phone>
    
    PhoneInfoga scans multiple sources:
    - Google dorks
    - NumVerify API
    - Local directories
    - Social media
    
    Returns name, carrier, line type, and validation info.
    """
    tmp_path = None
    try:
        # Clean phone for PhoneInfoga (prefers E.164 or 10-digit)
        clean_phone = re.sub(r'[^\d]', '', phone)
        if len(clean_phone) == 11 and clean_phone[0] == '1':
            # Keep the 1 prefix for PhoneInfoga
            pass
        elif len(clean_phone) == 10:
            # Add US prefix
            clean_phone = f"1{clean_phone}"
        
        # Format for PhoneInfoga: +1XXXXXXXXXX
        formatted_phone = f"+{clean_phone}"
        
        # Run PhoneInfoga via Docker
        # Using asyncio subprocess for non-blocking
        process = await asyncio.create_subprocess_exec(
            'docker', 'run', '--rm',
            'sundowndev/phoneinfoga',
            'scan', '-n', formatted_phone,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )
        
        stdout, stderr = await asyncio.wait_for(process.communicate(), timeout=120)
        
        # Parse results from stdout
        result = {
            'phone': phone,
            'source': 'phoneinfoga',
            'valid': False,
            'confidence': 0.3
        }
        
        stdout_text = stdout.decode('utf-8', errors='ignore') if stdout else ''
        stderr_text = stderr.decode('utf-8', errors='ignore') if stderr else ''
        
        # Debug: print raw output for first few numbers
        if stdout_text or stderr_text:
            # Parse the stdout for PhoneInfoga results
            result = _parse_phoneinfoga_stdout(stdout_text, phone)
            
            # Check if number was found valid
            if 'valid' in stdout_text.lower() or 'country' in stdout_text.lower():
                result['valid'] = True
                result['confidence'] = 0.6
            
            # If we found a name, increase confidence
            if result.get('name'):
                result['confidence'] = 0.85
                result['valid'] = True
        
        return result
        
    except FileNotFoundError:
        # Docker not installed
        print(f"[PhoneValidator] Docker not found - install Docker to use PhoneInfoga")
        return None
    except asyncio.TimeoutError:
        print(f"[PhoneValidator] PhoneInfoga timeout for {phone}")
        return None
    except Exception as e:
        print(f"[PhoneValidator] PhoneInfoga Docker error: {e}")
        return None


def _parse_phoneinfoga_json(data: dict, phone: str) -> Dict:
    """Parse PhoneInfoga JSON output to extract all useful data."""
    result = {
        'phone': phone,
        'source': 'phoneinfoga',
        'valid': True,
        'confidence': 0.6
    }
    
    if not isinstance(data, dict):
        return result
    
    # Extract name from various possible fields
    name = None
    name_fields = [
        'name', 'owner', 'subscriber', 'person', 'full_name',
        'subscriber_name', 'owner_name', 'registered_name',
        'contact_name', 'holder', 'holder_name'
    ]
    
    for field in name_fields:
        if data.get(field):
            candidate = str(data[field])
            if is_valid_name(candidate):
                name = clean_name(candidate)
                result['confidence'] = 0.85
                break
    
    # Check nested structures
    if not name:
        for section in ['general', 'local', 'social', 'numverify', 'google']:
            if section in data and isinstance(data[section], dict):
                for field in name_fields:
                    if data[section].get(field):
                        candidate = str(data[section][field])
                        if is_valid_name(candidate):
                            name = clean_name(candidate)
                            result['confidence'] = 0.8
                            break
                if name:
                    break
    
    # Check scanners results (PhoneInfoga v2 format)
    if not name and 'scanners' in data:
        for scanner_name, scanner_data in data.get('scanners', {}).items():
            if isinstance(scanner_data, dict):
                for field in name_fields:
                    if scanner_data.get(field):
                        candidate = str(scanner_data[field])
                        if is_valid_name(candidate):
                            name = clean_name(candidate)
                            result['confidence'] = 0.75
                            break
                if name:
                    break
    
    result['name'] = name
    
    # Extract carrier info
    carrier_fields = ['carrier', 'carrier_name', 'network', 'operator', 'provider']
    for field in carrier_fields:
        if data.get(field):
            result['carrier'] = str(data[field])
            break
    
    # Extract line type
    type_fields = ['line_type', 'type', 'phone_type', 'number_type']
    for field in type_fields:
        if data.get(field):
            result['line_type'] = str(data[field]).lower()
            break
    
    # Extract country/location
    if data.get('country') or data.get('country_code'):
        result['country'] = data.get('country') or data.get('country_code')
    if data.get('location') or data.get('city') or data.get('state'):
        parts = [data.get('city'), data.get('state'), data.get('country')]
        result['location'] = ', '.join(p for p in parts if p)
    
    # Validity
    if data.get('valid') is not None:
        result['valid'] = bool(data['valid'])
    
    return result


def _parse_phoneinfoga_stdout(stdout: str, phone: str) -> Dict:
    """
    Parse PhoneInfoga Docker stdout output.
    
    PhoneInfoga output format:
    - Results for local: Country, Local format, E164, etc.
    - Results for googlesearch: URLs for manual lookup
    - Results for numverify (if API key set): Carrier, line type, name
    """
    result = {
        'phone': phone,
        'source': 'phoneinfoga',
        'valid': False,
        'confidence': 0.3
    }
    
    # Check if scan ran successfully
    if 'Running scan' in stdout:
        result['valid'] = True
        result['confidence'] = 0.4
    
    # Parse "Results for local" section - this tells us if the number is valid
    if 'Results for local' in stdout:
        result['valid'] = True
        result['confidence'] = 0.6
        
        # Extract country
        country_match = re.search(r'Country:\s*(\w+)', stdout)
        if country_match:
            result['country'] = country_match.group(1).strip()
        
        # Extract local format (tells us the number is properly formatted)
        local_match = re.search(r'Local:\s*\((\d{3})\)\s*(\d{3})-(\d{4})', stdout)
        if local_match:
            # Valid US phone number format confirmed
            result['valid'] = True
            result['confidence'] = 0.7
    
    # Check scanner success count
    scanner_match = re.search(r'(\d+)\s*scanner\(s\)\s*succeeded', stdout)
    if scanner_match:
        num_scanners = int(scanner_match.group(1))
        if num_scanners > 0:
            result['valid'] = True
            result['scanners_succeeded'] = num_scanners
    
    # Parse "Results for numverify" section (if present - requires API key)
    if 'Results for numverify' in stdout:
        # Carrier
        carrier_match = re.search(r'Carrier:\s*([^\n\r]+)', stdout)
        if carrier_match:
            carrier = carrier_match.group(1).strip()
            if carrier and carrier.lower() not in ['unknown', 'n/a', 'none', '']:
                result['carrier'] = carrier
                result['confidence'] = 0.8
        
        # Line type
        type_match = re.search(r'Line\s*[Tt]ype:\s*(mobile|landline|voip|wireless|fixed|cell)', stdout, re.IGNORECASE)
        if type_match:
            result['line_type'] = type_match.group(1).lower()
        
        # Location
        location_match = re.search(r'Location:\s*([^\n\r]+)', stdout)
        if location_match:
            result['location'] = location_match.group(1).strip()
    
    # Look for name patterns anywhere in output (most valuable)
    name_patterns = [
        r'Owner[:\s]+([A-Z][a-z]+ [A-Z][a-z]+)',
        r'Name[:\s]+([A-Z][a-z]+ [A-Z][a-z]+)',
        r'Subscriber[:\s]+([A-Z][a-z]+ [A-Z][a-z]+)',
        r'Registered\s*to[:\s]+([A-Z][a-z]+ [A-Z][a-z]+)',
        r'Belongs\s*to[:\s]+([A-Z][a-z]+ [A-Z][a-z]+)',
    ]
    
    for pattern in name_patterns:
        match = re.search(pattern, stdout, re.IGNORECASE | re.MULTILINE)
        if match:
            candidate = match.group(1)
            if is_valid_name(candidate):
                result['name'] = clean_name(candidate)
                result['confidence'] = 0.9
                result['valid'] = True
                break
    
    # Skip Google dork URLs entirely - they're almost always empty
    # PhoneInfoga generates dozens of URLs but they rarely have actual results
    # Checking each URL is slow and Google often blocks automated requests
    # If needed, users can run PhoneInfoga manually for specific numbers
    
    return result


async def enrich_phone_via_web_directories(phone: str) -> Optional[Dict]:
    """
    Fallback method: Search public phone directories for name/info.
    FREE - scrapes publicly available data.
    
    Note: May be rate-limited. Use sparingly.
    """
    # Clean phone
    clean_phone = re.sub(r'[^\d]', '', phone)
    if len(clean_phone) == 11 and clean_phone[0] == '1':
        clean_phone = clean_phone[1:]
    
    if len(clean_phone) != 10:
        return None
    
    area_code = clean_phone[:3]
    exchange = clean_phone[3:6]
    subscriber = clean_phone[6:]
    
    result = {
        'phone': phone,
        'source': 'web_directory',
        'valid': True,
        'confidence': 0.4
    }
    
    # Try multiple directory services (these are examples - actual URLs may vary)
    directories = [
        # Free public directories
        f"https://www.whitepages.com/phone/{area_code}-{exchange}-{subscriber}",
        f"https://www.truepeoplesearch.com/results?phoneno={clean_phone}",
        f"https://www.fastpeoplesearch.com/phone/{clean_phone}",
    ]
    
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    }
    
    try:
        async with aiohttp.ClientSession() as session:
            for url in directories[:1]:  # Only try first one to avoid rate limits
                try:
                    async with session.get(url, headers=headers, timeout=aiohttp.ClientTimeout(total=10)) as response:
                        if response.status == 200:
                            html = await response.text()
                            
                            # Try to extract name from HTML
                            # Different sites have different structures
                            name_patterns = [
                                r'<h1[^>]*>([A-Z][a-z]+ [A-Z][a-z]+)</h1>',
                                r'"name"[:\s]*"([A-Z][a-z]+ [A-Z][a-z]+)"',
                                r'class="[^"]*name[^"]*"[^>]*>([A-Z][a-z]+ [A-Z][a-z]+)<',
                            ]
                            
                            for pattern in name_patterns:
                                match = re.search(pattern, html)
                                if match:
                                    candidate = match.group(1)
                                    if is_valid_name(candidate):
                                        result['name'] = clean_name(candidate)
                                        result['confidence'] = 0.65
                                        return result
                except:
                    continue
    except:
        pass
    
    return None if not result.get('name') else result


async def enrich_phone_via_phoneinfoga(phone: str) -> Optional[Dict]:
    """
    Primary PhoneInfoga enrichment function.
    Tries CLI first, then falls back to web directories.
    
    This is the MAIN method - FREE and provides name data.
    
    Args:
        phone: Phone number in any format
    
    Returns:
        Dictionary with phone OSINT data including name if found, or None
    """
    # Try CLI tool first (most reliable)
    result = await enrich_phone_via_phoneinfoga_cli(phone)
    
    if result and result.get('name'):
        print(f"[PhoneValidator] [+] PhoneInfoga found name: {result['name']} for {phone}")
        return result
    
    # If no name found, try web directories as fallback
    if not result or not result.get('name'):
        web_result = await enrich_phone_via_web_directories(phone)
        if web_result and web_result.get('name'):
            if result:
                # Merge with existing data
                result['name'] = web_result['name']
                result['confidence'] = max(result.get('confidence', 0), web_result.get('confidence', 0))
                result['source'] = 'phoneinfoga_web'
            else:
                result = web_result
            print(f"[PhoneValidator] [+] Web directory found name: {result['name']} for {phone}")
    
    return result


async def validate_and_enrich_phone(
    phone: str, 
    existing_data: Dict = None,
    use_twilio: bool = False,
    target_name: str = None
) -> Dict:
    """
    Validate and enrich a phone number using PhoneInfoga FIRST (free), then optionally Twilio.
    
    Priority Order:
    1. PhoneInfoga CLI (free, best for names)
    2. Web directories (free, fallback)
    3. Twilio (paid, only if enabled)
    
    Args:
        phone: Phone number to validate
        existing_data: Existing phone data to enrich
        use_twilio: Whether to use Twilio (default: False to avoid costs)
        target_name: Name to match against results (for validation)
    
    Returns:
        Enriched phone data dictionary with name if found
    """
    if not phone:
        return existing_data or {}
    
    result = existing_data.copy() if existing_data else {'phone': phone}
    
    # ========== PhoneInfoga FIRST (FREE) ==========
    phoneinfoga_data = await enrich_phone_via_phoneinfoga(phone)
    
    if phoneinfoga_data:
        # Merge PhoneInfoga data (prioritize it as our primary source)
        result.update(phoneinfoga_data)
        
        # If we found a name, check if it matches target name
        if target_name and phoneinfoga_data.get('name'):
            found_name = phoneinfoga_data.get('name', '').lower()
            target_name_lower = target_name.lower()
            
            # Check for name match (fuzzy)
            target_parts = [p for p in target_name_lower.split() if len(p) > 2]
            found_parts = [p for p in found_name.split() if len(p) > 2]
            
            # Calculate match score
            matching_parts = sum(1 for p in target_parts if p in found_name)
            if matching_parts > 0:
                match_ratio = matching_parts / len(target_parts) if target_parts else 0
                
                if match_ratio >= 0.5:  # At least half the name parts match
                    result['name_match'] = True
                    result['name_match_score'] = match_ratio
                    result['confidence'] = min(result.get('confidence', 0.5) + (0.2 * match_ratio), 0.98)
                    print(f"[PhoneValidator] [+] Name match! '{phoneinfoga_data.get('name')}' ~ '{target_name}' (score: {match_ratio:.2f})")
                else:
                    result['name_match'] = False
                    result['name_match_score'] = match_ratio
            else:
                result['name_match'] = False
                result['name_match_score'] = 0
        
        # If PhoneInfoga found good data, return early unless Twilio is explicitly requested
        if phoneinfoga_data.get('valid') and phoneinfoga_data.get('name') and not use_twilio:
            return result
    
    # ========== Twilio (OPTIONAL - Costs Money) ==========
    if use_twilio:
        twilio_data = await validate_phone_via_twilio(phone)
        if twilio_data:
            # Merge Twilio data (don't overwrite name from PhoneInfoga)
            for key in ['carrier', 'line_type', 'country', 'valid']:
                if key not in result or not result.get(key):
                    result[key] = twilio_data.get(key)
            
            # Update source
            if result.get('source') == 'phoneinfoga':
                result['source'] = 'phoneinfoga_twilio'
            elif not result.get('source'):
                result['source'] = 'twilio_lookup'
    
    return result


async def reverse_lookup_phone(phone: str) -> Optional[Dict]:
    """
    Reverse phone lookup - find the owner name for a phone number.
    Uses PhoneInfoga (free) exclusively.
    
    Args:
        phone: Phone number to lookup
    
    Returns:
        Dictionary with owner information or None
    """
    result = await enrich_phone_via_phoneinfoga(phone)
    
    if result and result.get('name'):
        return {
            'phone': phone,
            'name': result['name'],
            'carrier': result.get('carrier'),
            'line_type': result.get('line_type'),
            'location': result.get('location'),
            'confidence': result.get('confidence', 0.5),
            'source': result.get('source', 'phoneinfoga')
        }
    
    return None


async def batch_reverse_lookup(phones: List[str], max_workers: int = 4) -> List[Dict]:
    """
    Batch reverse lookup for multiple phone numbers.
    
    Args:
        phones: List of phone numbers
        max_workers: Parallel workers (keep low to avoid rate limits)
    
    Returns:
        List of lookup results
    """
    semaphore = asyncio.Semaphore(max_workers)
    results = []
    
    async def lookup_one(phone: str):
        async with semaphore:
            result = await reverse_lookup_phone(phone)
            if result:
                print(f"[PhoneValidator] {phone} -> {result.get('name', 'Unknown')}")
            return result
    
    tasks = [lookup_one(p) for p in phones]
    results = await asyncio.gather(*tasks)
    
    return [r for r in results if r]
