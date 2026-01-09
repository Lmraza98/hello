"""
Format LinkedIn contacts for Salesforce Data Import Wizard.
One lead per person with first.last@domain.com email pattern.

Uses particle-aware name normalization to handle names like:
- Rory San Miguel -> Last: San Miguel
- Jess De Jesus -> Last: De Jesus
- Jorge Mauricio Garcia Betancur -> Flagged for review
"""
import csv
import re
import sys
from datetime import datetime
from pathlib import Path

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

from services.name_normalizer import normalize_name, generate_email_prefix


def clean_name(name: str) -> dict:
    """
    Clean name using particle-aware normalization.
    Returns {first_name, last_name, middle_name, needs_review, review_reason}
    
    Particle rules:
    - de, del, da, di, la, le, van, von, san, st combine with following word
    - Names with 3+ parts flagged for manual review
    """
    result = normalize_name(name)
    
    return {
        'first_name': result.first or 'Unknown',
        'last_name': result.last or 'Contact',
        'middle_name': result.middle,
        'needs_review': 'REVIEW' if result.needs_review else '',
        'review_reason': result.review_reason or '',
    }


def generate_email(first_name: str, last_name: str, domain: str, pattern: str = None) -> str:
    """
    Generate email from name components.
    Last name with spaces is collapsed (De Jesus -> dejesus).
    
    Args:
        first_name: First name
        last_name: Last name (can include particles like "De Jesus")
        domain: Email domain
        pattern: Optional pattern like '{first}.{last}', '{f}{last}', etc.
    """
    if not pattern:
        pattern = '{first}.{last}'
    
    # Clean the name components
    first = re.sub(r'[^a-z]', '', first_name.lower())
    # Remove spaces and non-alpha from last name (De Jesus -> dejesus)
    last = re.sub(r'[^a-z]', '', last_name.lower())
    
    # Generate based on pattern
    f = first[0] if first else ''
    l = last[0] if last else ''
    
    try:
        prefix = pattern.format(first=first, last=last, f=f, l=l)
        prefix = re.sub(r'\.+', '.', prefix).strip('.')
        return f"{prefix}@{domain}" if prefix else f"{first}@{domain}"
    except (KeyError, IndexError):
        return f"{first}.{last}@{domain}"


def format_company(company: str) -> str:
    """Format company name properly."""
    if not company:
        return ''
    return company.title()


def convert_linkedin_to_salesforce(input_path: str, output_path: str, email_pattern: str = None):
    """
    Convert LinkedIn contacts to Salesforce import format.
    One row per person with particle-aware name parsing.
    
    Args:
        input_path: Path to LinkedIn contacts CSV
        output_path: Path for Salesforce import CSV
        email_pattern: Optional email pattern (default: '{first}.{last}')
    """
    with open(input_path, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        rows = list(reader)
    
    sf_rows = []
    review_count = 0
    
    for row in rows:
        # Get name from CSV (column is "Name")
        raw_name = row.get('Name', row.get('name', ''))
        name_parts = clean_name(raw_name)
        
        # Track review flags
        if name_parts['needs_review']:
            review_count += 1
        
        # Build the full name for display
        name_display_parts = [name_parts['first_name']]
        if name_parts['middle_name']:
            name_display_parts.append(name_parts['middle_name'])
        if name_parts['last_name'] and name_parts['last_name'] != 'Contact':
            name_display_parts.append(name_parts['last_name'])
        display_name = ' '.join(name_display_parts)
        
        # Use existing email from CSV, or generate if missing
        email = row.get('Email', row.get('email', ''))
        if not email:
            domain = row.get('Domain', row.get('domain', ''))
            if domain:
                email = generate_email(
                    name_parts['first_name'], 
                    name_parts['last_name'], 
                    domain,
                    pattern=email_pattern
                )
        
        sf_row = {
            'Name': display_name,
            'First_Name': name_parts['first_name'],
            'Middle_Name': name_parts['middle_name'],
            'Last_Name': name_parts['last_name'],
            'Email': email,
            'Title': row.get('Title', row.get('title', '')),
            'Company': format_company(row.get('Company', row.get('company', ''))),
            'Geography': '',  # Leave blank or fill as needed
            'Date': datetime.now().strftime('%m/%d/%Y'),
            'Lead_CountryCountry': 'United States',
            'Review_Flag': name_parts['needs_review'],
            'Review_Reason': name_parts['review_reason'],
        }
        
        sf_rows.append(sf_row)
    
    # Write output
    fieldnames = [
        'Name', 'First_Name', 'Middle_Name', 'Last_Name', 'Email', 
        'Title', 'Company', 'Geography', 'Date', 'Lead_CountryCountry',
        'Review_Flag', 'Review_Reason'
    ]
    
    with open(output_path, 'w', newline='', encoding='utf-8') as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(sf_rows)
    
    print(f"Converted {len(sf_rows)} contacts (1 per person)")
    print(f"Output: {output_path}")
    print(f"Names needing review: {review_count}")
    
    # Show sample
    print("\nSample rows:")
    for row in sf_rows[:5]:
        review_marker = " ⚠️" if row['Review_Flag'] else ""
        print(f"  {row['Name']}{review_marker} | {row['Email']} | {row['Company']}")
    
    # Show review items if any
    if review_count > 0:
        print(f"\n⚠️  Names flagged for review ({review_count}):")
        for row in sf_rows:
            if row['Review_Flag']:
                print(f"  {row['Name']} -> Last: '{row['Last_Name']}' | {row['Review_Reason']}")


if __name__ == '__main__':
    input_file = Path('data/linkedin_contacts.csv')
    output_file = Path('data/salesforce_import.csv')
    
    if input_file.exists():
        convert_linkedin_to_salesforce(str(input_file), str(output_file))
    else:
        print(f"Input file not found: {input_file}")
