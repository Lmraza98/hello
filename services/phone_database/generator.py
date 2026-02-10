"""
Phone Number Generator

Generates all possible US phone numbers for given area codes.
Uses efficient generators to avoid memory issues.
"""
import reF
from typing import Generator, List, Dict


def generate_phone_numbers_for_area_code(area_code: str, limit: int = None) -> Generator[str, None, None]:
    """
    Generate all possible phone numbers for a given area code.
    Yields numbers in format: XXX-XXX-XXXX
    
    Args:
        area_code: 3-digit area code (e.g., "617")
        limit: Maximum numbers to generate (None = all ~8 million)
    
    Yields:
        Phone numbers in format XXX-XXX-XXXX
    """
    # Validate area code format
    if not re.match(r'^\d{3}$', area_code):
        raise ValueError(f"Invalid area code format: {area_code}")
    
    # Exchange codes (200-999, but middle digit can't be 0 or 1 in some cases)
    # Simplified: generate 200-999 (some may be invalid, but we'll validate later)
    exchange_codes = range(200, 1000)
    subscriber_numbers = range(0, 10000)
    
    count = 0
    for exchange in exchange_codes:
        for subscriber in subscriber_numbers:
            if limit and count >= limit:
                return
            
            # Format: XXX-XXX-XXXX
            phone = f"{area_code}-{exchange:03d}-{subscriber:04d}"
            yield phone
            count += 1


def generate_phone_numbers_for_region(
    area_codes: List[str], 
    max_per_area: int = None
) -> Generator[str, None, None]:
    """
    Generate phone numbers for multiple area codes.
    Useful for targeting specific regions (e.g., New England area codes).
    
    Args:
        area_codes: List of 3-digit area codes (e.g., ["617", "781", "857"])
        max_per_area: Maximum numbers per area code (None = all ~8 million each)
    
    Yields:
        Phone numbers in format XXX-XXX-XXXX
    """
    for area_code in area_codes:
        for phone in generate_phone_numbers_for_area_code(area_code, limit=max_per_area):
            yield phone


def get_us_area_codes_by_region() -> Dict[str, List[str]]:
    """
    Get common US area codes organized by region.
    Useful for targeted database building.
    
    Returns:
        Dictionary mapping region names to area code lists
    """
    return {
        'new_england': [
            # Massachusetts
            "617", "781", "857", "339", "508", "774", "978", "351",
            # New Hampshire
            "603",
            # Maine
            "207",
            # Vermont
            "802",
            # Rhode Island
            "401",
            # Connecticut
            "203", "860", "959"
        ],
        'california': [
            "209", "213", "310", "323", "408", "415", "510", "530",
            "559", "562", "619", "626", "650", "661", "707", "714",
            "760", "805", "818", "831", "858", "909", "916", "925",
            "949", "951"
        ],
        'new_york': [
            "212", "315", "347", "516", "518", "585", "607", "631",
            "646", "716", "718", "845", "914", "917", "929"
        ],
        'texas': [
            "210", "214", "254", "281", "325", "361", "409", "430",
            "432", "469", "512", "713", "726", "737", "806", "817",
            "830", "832", "903", "915", "936", "940", "956", "972",
            "979"
        ],
        'florida': [
            "239", "305", "321", "352", "386", "407", "561", "689",
            "727", "754", "772", "786", "813", "850", "863", "904",
            "941", "954"
        ]
    }


def get_all_us_area_codes() -> List[str]:
    """
    Get a comprehensive list of all US area codes.
    Note: This includes ~350+ active area codes.
    
    Returns:
        List of all US area codes
    """
    # This is a simplified list - in production, you'd want to get this from
    # a more authoritative source or validate against NANPA database
    area_codes = []
    
    # Generate all possible 200-999, but filter known invalid ones
    # Area codes can't start with 0 or 1, and second digit can't be 9
    for first in range(2, 10):  # 2-9
        for second in range(0, 9):  # 0-8 (can't be 9)
            for third in range(0, 10):  # 0-9
                area_code = f"{first}{second}{third}"
                # Skip known invalid patterns
                if area_code not in ["211", "311", "411", "511", "611", "711", "811", "911"]:
                    area_codes.append(area_code)
    
    return area_codes

