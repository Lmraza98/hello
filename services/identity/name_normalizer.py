"""
Name Normalizer: Standardize names for email generation and Salesforce import.

Handles:
- Credential/suffix removal (PhD, MBA, Jr., etc.)
- Particle-aware last name parsing (de, van, san, etc.)
- Flagging complex names for manual review
- Separate First, Middle, Last extraction
"""
import re
from typing import Dict, Optional, Tuple
from dataclasses import dataclass


# Name particles that combine with the following word to form the last name
# e.g., "De Jesus" -> last_name = "De Jesus"
NAME_PARTICLES = frozenset([
    'de', 'del', 'da', 'di', 'la', 'le', 'las', 'los',
    'van', 'von', 'der', 'den', 'ter',
    'san', 'st', 'saint',
    'el', 'al', 'bin', 'ibn',
    'mac', 'mc',  # Scottish/Irish prefixes
])

# Credentials and suffixes to remove
CREDENTIALS_PATTERNS = [
    # After comma
    r',\s*Jr\.?$', r',\s*Sr\.?$', r',\s*III$', r',\s*II$', r',\s*IV$', r',\s*V$',
    r',\s*Ph\.?D\.?$', r',\s*MBA$', r',\s*IMBA$', r',\s*M\.?D\.?$', r',\s*D\.?O\.?$',
    r',\s*J\.?D\.?$', r',\s*Ed\.?D\.?$', r',\s*D\.?D\.?S\.?$', r',\s*D\.?M\.?D\.?$',
    r',\s*P\.?E\.?$', r',\s*CPA$', r',\s*Esq\.?$', r',\s*SPHR$', r',\s*PHR$',
    r',\s*PMP$', r',\s*SHRM-\w+$', r',\s*CFS$', r',\s*LSP$', r',\s*PG$',
    r',\s*LLS$', r',\s*RPLS$', r',\s*PLS$', r',\s*CMQ/OE$', r',\s*CQE$',
    r',\s*LSSBB$', r',\s*CISSP$', r',\s*CISA$', r',\s*CFP$', r',\s*CFA$',
    r',\s*RN$', r',\s*BSN$', r',\s*MSN$', r',\s*NP$', r',\s*PA-C$',
    r',\s*FACHE$', r',\s*FACEP$', r',\s*FACS$',
    # After space (no comma)
    r'\s+Jr\.?$', r'\s+Sr\.?$', r'\s+III$', r'\s+II$', r'\s+IV$', r'\s+V$',
    r'\s+Ph\.?D\.?$', r'\s+MBA$', r'\s+IMBA$', r'\s+M\.?D\.?$', r'\s+D\.?O\.?$',
    r'\s+P\.?E\.?$', r'\s+CPA$', r'\s+SPHR$', r'\s+PMP$', r'\s+SHRM-\w+$',
    r'\s+Esq\.?$', r'\s+CISSP$', r'\s+CFA$', r'\s+CFP$',
    # Honorifics at the start
    r'^Dr\.?\s+', r'^Prof\.?\s+', r'^Mr\.?\s+', r'^Mrs\.?\s+', r'^Ms\.?\s+',
    r'^Miss\s+', r'^Rev\.?\s+', r'^Hon\.?\s+', r'^Sir\s+', r'^Dame\s+',
]


@dataclass
class NormalizedName:
    """Result of name normalization."""
    original: str
    cleaned: str
    first: str
    middle: str
    last: str
    first_initial: str
    last_initial: str
    needs_review: bool
    review_reason: Optional[str]
    
    def full_name(self) -> str:
        """Reconstruct cleaned full name."""
        parts = [self.first]
        if self.middle:
            parts.append(self.middle)
        if self.last:
            parts.append(self.last)
        return ' '.join(parts)
    
    def to_dict(self) -> Dict:
        """Convert to dictionary."""
        return {
            'original': self.original,
            'cleaned': self.cleaned,
            'first': self.first,
            'middle': self.middle,
            'last': self.last,
            'first_initial': self.first_initial,
            'last_initial': self.last_initial,
            'needs_review': self.needs_review,
            'review_reason': self.review_reason,
        }


def _remove_credentials(name: str) -> str:
    """Remove credentials, suffixes, and honorifics from name."""
    clean = name.strip()
    
    # Remove anything in parentheses
    clean = re.sub(r'\s*\([^)]+\)\s*', ' ', clean)
    
    # Remove anything in brackets
    clean = re.sub(r'\s*\[[^\]]+\]\s*', ' ', clean)
    
    # Key fix: Strip everything after first comma if it looks like credentials
    # e.g., "Garret Grajek, CEH, CISSP, CGEIT, CISM" -> "Garret Grajek"
    # e.g., "Dave Clayman, CEPA┬«, CMT┬«, C(k)P┬«, AIF┬«" -> "Dave Clayman"
    if ',' in clean:
        parts = clean.split(',', 1)
        after_comma = parts[1].strip() if len(parts) > 1 else ''
        
        # Check if what's after the comma looks like credentials:
        # - Contains mostly uppercase letters, numbers, special chars
        # - Or contains common credential markers like ┬«, ┬⌐
        # - Or is a common suffix (Jr, Sr, III, etc.)
        is_suffix = after_comma.lower() in ['jr', 'jr.', 'sr', 'sr.', 'ii', 'iii', 'iv', 'v']
        
        if after_comma:
            # Remove special chars and check if mostly uppercase/acronyms
            letters_only = re.sub(r'[^a-zA-Z]', '', after_comma)
            is_credential_like = (
                len(letters_only) == 0 or  # Only special chars
                letters_only.isupper() or  # All caps like "CEH CISSP"
                '┬«' in after_comma or
                '┬⌐' in after_comma or
                re.search(r'\b[A-Z]{2,}\b', after_comma)  # Has 2+ letter acronym
            )
            
            if is_credential_like and not is_suffix:
                clean = parts[0].strip()
            elif is_suffix:
                # Keep suffixes like Jr, Sr for now - will be handled by patterns below
                pass
    
    # Apply credential patterns for remaining cases (Jr., Sr., PhD without comma, etc.)
    for pattern in CREDENTIALS_PATTERNS:
        clean = re.sub(pattern, '', clean, flags=re.IGNORECASE)
    
    # Clean up extra spaces and trailing punctuation
    clean = re.sub(r'\s+', ' ', clean).strip()
    clean = clean.strip(',').strip('.').strip()
    
    return clean


def _is_particle(word: str) -> bool:
    """Check if a word is a name particle."""
    return word.lower() in NAME_PARTICLES


def _extract_last_name_with_particles(words: list) -> Tuple[str, int]:
    """
    Extract last name considering particles.
    Returns (last_name, num_words_consumed).
    
    Rules:
    - Default: last word only
    - If second-to-last is a particle: combine (e.g., "De Jesus", "Van Der Berg")
    """
    n = len(words)
    if n == 0:
        return ('', 0)
    if n == 1:
        return (words[0], 1)
    
    # Check for particles in second-to-last position
    # Handle multi-word particles like "van der"
    consumed = 1
    last_name_parts = [words[-1]]
    
    # Walk backwards to find particles
    for i in range(n - 2, -1, -1):
        if _is_particle(words[i]):
            last_name_parts.insert(0, words[i])
            consumed += 1
        else:
            break
    
    # Title case the last name properly
    last_name = ' '.join(last_name_parts)
    return (last_name, consumed)


def normalize_name(raw_name: str) -> NormalizedName:
    """
    Normalize a full name into components.
    
    Returns NormalizedName with:
    - first: First name
    - middle: Middle name(s), empty if none
    - last: Last name (particle-aware)
    - needs_review: True if name has 3+ parts (possible multi-word surname)
    - review_reason: Why it needs review
    """
    if not raw_name or not raw_name.strip():
        return NormalizedName(
            original=raw_name or '',
            cleaned='',
            first='',
            middle='',
            last='',
            first_initial='',
            last_initial='',
            needs_review=True,
            review_reason='Empty name'
        )
    
    # Store original
    original = raw_name.strip()
    
    # Remove credentials and honorifics
    cleaned = _remove_credentials(original)
    
    # Remove non-letter characters except spaces and hyphens
    # Keep accented characters (unicode letters)
    cleaned = re.sub(r'[^\w\s\-]', '', cleaned, flags=re.UNICODE)
    cleaned = re.sub(r'\s+', ' ', cleaned).strip()
    
    if not cleaned:
        return NormalizedName(
            original=original,
            cleaned='',
            first='',
            middle='',
            last='',
            first_initial='',
            last_initial='',
            needs_review=True,
            review_reason='Name reduced to empty after cleaning'
        )
    
    # Split into words
    words = cleaned.split()
    n = len(words)
    
    # Initialize
    first = ''
    middle = ''
    last = ''
    needs_review = False
    review_reason = None
    
    if n == 1:
        # Single word - use as first name, no last name
        first = words[0].title()
        last = ''
        needs_review = True
        review_reason = 'Single name - no last name'
        
    elif n == 2:
        # Standard: First Last
        first = words[0].title()
        last = words[1].title()
        
        # Flag if last name is just a single letter (initial like "M" or "L")
        if len(words[1]) == 1:
            needs_review = True
            review_reason = 'Last name is single letter (initial only)'
        
    else:
        # 3+ words - need to determine first, middle, last
        first = words[0].title()
        
        # Extract last name with particle awareness
        last_name, consumed = _extract_last_name_with_particles(words)
        last = last_name.title()
        
        # Everything between first and last is middle
        if consumed < n - 1:
            middle_words = words[1:n - consumed]
            middle = ' '.join(w.title() for w in middle_words)
        
        # Flag for review if:
        # - 4+ names (could be Hispanic/Portuguese compound surname)
        # - No particle detected and 3+ names (ambiguous)
        if n >= 4:
            needs_review = True
            review_reason = f'{n}-word name - possible compound surname (e.g., Garcia Betancur)'
        elif n == 3 and consumed == 1:
            # 3 words but no particle - middle name or compound surname?
            # Flag for review but less urgent
            needs_review = True
            review_reason = '3-word name - verify last name assignment'
    
    # Extract initials
    first_initial = first[0].lower() if first else ''
    # For last initial, use first char of first word in last name
    last_initial = last.split()[0][0].lower() if last else ''
    
    return NormalizedName(
        original=original,
        cleaned=cleaned.title(),
        first=first,
        middle=middle,
        last=last,
        first_initial=first_initial,
        last_initial=last_initial,
        needs_review=needs_review,
        review_reason=review_reason
    )


def generate_email_prefix(
    name: NormalizedName, 
    pattern: str = '{first}.{last}'
) -> Optional[str]:
    """
    Generate email prefix from normalized name using given pattern.
    
    Supported pattern tokens:
    - {first}: full first name
    - {last}: full last name (without spaces for multi-word)
    - {f}: first initial
    - {l}: last initial
    - {middle}: full middle name
    - {m}: middle initial
    
    Returns None if required components are missing.
    """
    if not name.first:
        return None
    
    # For last name in emails, remove spaces (e.g., "De Jesus" -> "dejesus")
    last_for_email = re.sub(r'\s+', '', name.last.lower()) if name.last else ''
    middle_for_email = re.sub(r'\s+', '', name.middle.lower()) if name.middle else ''
    
    tokens = {
        'first': name.first.lower(),
        'last': last_for_email,
        'f': name.first_initial,
        'l': name.last_initial,
        'middle': middle_for_email,
        'm': name.middle[0].lower() if name.middle else '',
    }
    
    try:
        prefix = pattern.format(**tokens)
        # Remove any empty segments that resulted from missing tokens
        prefix = re.sub(r'\.+', '.', prefix)  # Collapse multiple dots
        prefix = prefix.strip('.')  # Remove leading/trailing dots
        return prefix if prefix else None
    except (KeyError, IndexError):
        return None


def parse_name_for_email(full_name: str) -> Tuple[str, str, str, str]:
    """
    Legacy-compatible function for email_pattern.py.
    Returns: (first, last, first_initial, last_initial)
    
    Last name has spaces removed for email generation.
    """
    normalized = normalize_name(full_name)
    
    first = normalized.first.lower() if normalized.first else ''
    # Remove spaces from last name for email (De Jesus -> dejesus)
    last = re.sub(r'\s+', '', normalized.last.lower()) if normalized.last else ''
    f = normalized.first_initial
    l = normalized.last_initial
    
    return (first, last, f, l)


def clean_name_for_salesforce(raw_name: str) -> Dict[str, str]:
    """
    Legacy-compatible function for format_for_salesforce.py.
    Returns: {first_name, last_name, middle_name, needs_review, review_reason}
    """
    normalized = normalize_name(raw_name)
    
    return {
        'first_name': normalized.first or 'Unknown',
        'last_name': normalized.last or 'Contact',
        'middle_name': normalized.middle,
        'needs_review': 'REVIEW' if normalized.needs_review else '',
        'review_reason': normalized.review_reason or '',
    }


# Self-test / examples
if __name__ == '__main__':
    test_names = [
        "John Smith",
        "Rory San Miguel",
        "Jess De Jesus",
        "Jorge Mauricio Garcia Betancur",
        "Maria Van Der Berg",
        "Tim O'Brien",
        "Dr. Sebastian Vogel, PhD",
        "Christina Dr H├╢fner",
        "N.Ragavanandhaa N.Ragavanandhaa",
        "Paul H.",
        "Shivani D.",
        "Maansi S D.",
        "Robert De Niro",
        "Vincent Van Gogh",
        "Leonardo Da Vinci",
        "Rosa De La Cruz",
        "Juan Carlos Garc├¡a L├│pez",
    ]
    
    print("Name Normalization Test Results")
    print("=" * 80)
    
    for name in test_names:
        result = normalize_name(name)
        email = generate_email_prefix(result, '{first}.{last}')
        
        print(f"\nOriginal: {name}")
        print(f"  First: '{result.first}' | Middle: '{result.middle}' | Last: '{result.last}'")
        print(f"  Email prefix: {email}")
        if result.needs_review:
            print(f"  [!] REVIEW: {result.review_reason}")

