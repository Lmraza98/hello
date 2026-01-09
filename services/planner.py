"""
Planner Service: Scoring, deduplication, template generation, send-plan creation.
"""
import json
from datetime import datetime
from typing import List, Dict, Optional, Set
from dataclasses import dataclass

import config
import database as db
from services.extractor import generate_personalization
from services.crawler import is_personal_email


# ============ Deduplication ============

@dataclass
class DedupeKey:
    """Keys for deduplication, in priority order."""
    email: Optional[str] = None
    domain_person_title: Optional[str] = None  # domain|name|title
    domain: Optional[str] = None


def get_existing_emails() -> Set[str]:
    """Get all emails already in send queue or sent."""
    with db.get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT DISTINCT contact_email FROM send_queue 
            WHERE contact_email IS NOT NULL
        """)
        return {row['contact_email'].lower() for row in cursor.fetchall()}


def get_existing_domain_contacts() -> Set[str]:
    """Get domain|name|title combinations already contacted."""
    with db.get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT sq.contact_name, sq.contact_title, c.domain
            FROM send_queue sq
            JOIN candidates c ON sq.candidate_id = c.id
            WHERE sq.contact_name IS NOT NULL
        """)
        combinations = set()
        for row in cursor.fetchall():
            key = f"{row['domain']}|{row['contact_name']}|{row['contact_title']}".lower()
            combinations.add(key)
        return combinations


def is_duplicate(
    email: Optional[str],
    domain: str,
    contact_name: Optional[str],
    contact_title: Optional[str],
    existing_emails: Set[str],
    existing_combos: Set[str]
) -> bool:
    """Check if this contact is a duplicate."""
    # Email is the strongest dedupe key
    if email and email.lower() in existing_emails:
        return True
    
    # Domain + person + title combo
    if contact_name:
        key = f"{domain}|{contact_name}|{contact_title}".lower()
        if key in existing_combos:
            return True
    
    return False


def dedupe_candidates(candidates: List[Dict]) -> List[Dict]:
    """
    Deduplicate candidates and their contacts.
    Returns filtered list with duplicate contacts removed.
    """
    existing_emails = get_existing_emails()
    existing_combos = get_existing_domain_contacts()
    
    # Also track within this batch
    batch_emails = set()
    batch_combos = set()
    
    deduped = []
    
    for candidate in candidates:
        domain = candidate['domain']
        contacts = candidate.get('contacts', [])
        
        # Filter contacts
        filtered_contacts = []
        for contact in contacts:
            email = contact.get('email')
            name = contact.get('name')
            title = contact.get('title')
            
            # Check both existing and batch duplicates
            if is_duplicate(email, domain, name, title, existing_emails, existing_combos):
                continue
            if is_duplicate(email, domain, name, title, batch_emails, batch_combos):
                continue
            
            # Add to batch tracking
            if email:
                batch_emails.add(email.lower())
            if name:
                batch_combos.add(f"{domain}|{name}|{title}".lower())
            
            filtered_contacts.append(contact)
        
        if filtered_contacts:
            candidate['contacts'] = filtered_contacts
            deduped.append(candidate)
    
    return deduped


# ============ Scoring ============

def score_contact(contact: Dict, candidate: Dict) -> float:
    """
    Score an individual contact for prioritization.
    Higher = better to contact.
    Returns -1 to indicate contact should be SKIPPED entirely.
    """
    score = 0.5  # Base score
    
    # Email quality
    email = contact.get('email')
    if email:
        if is_personal_email(email):
            score += 0.3  # Personal email is great
        else:
            # Generic email - SKIP entirely
            return -1.0
    else:
        score -= 0.3  # No email is bad
    
    # Name quality
    if contact.get('name'):
        score += 0.15
    
    # Title quality (prioritize decision-makers)
    title = (contact.get('title') or '').lower()
    executive_keywords = ['ceo', 'cto', 'cfo', 'founder', 'president', 'owner', 'chief', 'director', 'vp', 'head']
    manager_keywords = ['manager', 'lead', 'senior']
    skip_keywords = ['intern', 'assistant', 'coordinator', 'receptionist', 'student']
    
    if any(kw in title for kw in executive_keywords):
        score += 0.25
    elif any(kw in title for kw in manager_keywords):
        score += 0.1
    elif any(kw in title for kw in skip_keywords):
        score -= 0.4  # Skip interns etc.
    
    # Evidence quality
    if contact.get('evidence') and len(contact.get('evidence', '')) > 30:
        score += 0.1
    
    return max(0, min(1, score))  # Clamp to 0-1


def score_candidate(candidate: Dict) -> Dict:
    """
    Calculate overall candidate score and contact priorities.
    """
    # Start with database scores
    fit_score = candidate.get('fit_score', 0.5)
    contact_quality = candidate.get('contact_quality_score', 0.5)
    evidence_score = candidate.get('evidence_score', 0.5)
    confidence = candidate.get('confidence', 0.5)
    
    # Score each contact
    contacts = candidate.get('contacts', [])
    scored_contacts = []
    for contact in contacts:
        contact_score = score_contact(contact, candidate)
        scored_contacts.append({
            **contact,
            'contact_score': contact_score
        })
    
    # Sort by contact score
    scored_contacts.sort(key=lambda c: c['contact_score'], reverse=True)
    
    # Overall score (weighted)
    overall = (
        fit_score * 0.35 +
        contact_quality * 0.30 +
        evidence_score * 0.15 +
        confidence * 0.20
    )
    
    return {
        **candidate,
        'contacts': scored_contacts,
        'overall_score': overall,
        'fit_score': fit_score,
        'contact_quality_score': contact_quality,
        'evidence_score': evidence_score,
        'confidence': confidence
    }


def filter_by_threshold(candidates: List[Dict]) -> List[Dict]:
    """Filter candidates by minimum score thresholds."""
    filtered = []
    
    for candidate in candidates:
        if candidate['overall_score'] < config.MIN_FIT_SCORE_TO_SEND:
            continue
        if candidate['confidence'] < config.MIN_CONFIDENCE_TO_SEND:
            continue
        
        # Must have at least one contactable person with PERSONAL email
        valid_contacts = [
            c for c in candidate.get('contacts', [])
            if c.get('email') 
            and c.get('contact_score', 0) > 0  # -1 means generic email, skip
            and is_personal_email(c.get('email', ''))  # Double-check
        ]
        
        if not valid_contacts:
            continue
        
        candidate['contacts'] = valid_contacts
        filtered.append(candidate)
    
    return filtered


# ============ Email Template Generation ============

def generate_subject(candidate: Dict, contact: Dict) -> str:
    """Generate email subject line."""
    company = candidate.get('company', {})
    company_name = company.get('name') or candidate.get('company_name') or candidate['domain']
    
    return config.DEFAULT_SUBJECT_TEMPLATE.format(
        company=company_name,
        first_name=contact.get('name', '').split()[0] if contact.get('name') else ''
    )


def generate_body(
    candidate: Dict, 
    contact: Dict,
    personalization: Optional[str] = None
) -> str:
    """Generate email body with optional personalization."""
    company = candidate.get('company', {})
    company_name = company.get('name') or candidate.get('company_name') or candidate['domain']
    
    # Use personalization if provided, otherwise generic opener
    if not personalization:
        personalization = f"I came across {company_name} and was impressed by what you're building."
    
    return config.DEFAULT_BODY_TEMPLATE.format(
        personalization=personalization,
        company=company_name,
        value_prop=config.VALUE_PROP,
        sender_name=config.SENDER_NAME,
        opt_out_line=config.OPT_OUT_LINE
    )


# ============ Send Plan Generation ============

def create_send_queue_item(
    candidate: Dict,
    contact: Dict,
    priority: int,
    generate_personalized: bool = False
) -> Dict:
    """Create a send queue item for a contact."""
    company = candidate.get('company', {})
    company_name = company.get('name') or candidate.get('company_name') or candidate['domain']
    company_info = candidate.get('domain_summary', '')
    
    # Generate personalization if requested and under budget
    personalization = None
    if generate_personalized and contact.get('name'):
        personalization = generate_personalization(
            contact_name=contact.get('name', 'there'),
            contact_title=contact.get('title', ''),
            company_name=company_name,
            company_info=company_info
        )
    
    subject = generate_subject(candidate, contact)
    body = generate_body(candidate, contact, personalization)
    
    # Determine if we should skip
    do_not_send = False
    do_not_send_reason = None
    
    if not contact.get('email'):
        do_not_send = True
        do_not_send_reason = "no_email"
    elif not is_personal_email(contact.get('email', '')):
        # Allow generic emails but lower priority
        priority -= 5
    
    # Check for skip indicators in title
    title_lower = (contact.get('title') or '').lower()
    if any(kw in title_lower for kw in ['intern', 'student']):
        do_not_send = True
        do_not_send_reason = "irrelevant_role"
    
    return {
        'candidate_id': candidate['id'],
        'contact_name': contact.get('name'),
        'contact_email': contact.get('email'),
        'contact_title': contact.get('title'),
        'planned_subject': subject,
        'planned_body': body,
        'personalization': personalization,
        'priority': priority,
        'do_not_send': do_not_send,
        'do_not_send_reason': do_not_send_reason
    }


def generate_send_plan(
    candidates: List[Dict],
    daily_limit: int = None,
    personalize_top_n: int = 50
) -> List[Dict]:
    """
    Generate the send plan for a batch of candidates.
    
    Args:
        candidates: Scored and deduped candidates
        daily_limit: Max sends to plan (defaults to config)
        personalize_top_n: Number of top contacts to personalize with LLM
    
    Returns:
        List of send queue items
    """
    if daily_limit is None:
        daily_limit = config.DAILY_SEND_LIMIT
    
    # Score all candidates
    scored = [score_candidate(c) for c in candidates]
    
    # Filter by thresholds
    filtered = filter_by_threshold(scored)
    
    # Sort by overall score
    filtered.sort(key=lambda c: c['overall_score'], reverse=True)
    
    # Generate send items
    send_items = []
    contacts_added = 0
    personalized_count = 0
    
    for candidate in filtered:
        if contacts_added >= daily_limit:
            break
        
        for contact in candidate.get('contacts', []):
            if contacts_added >= daily_limit:
                break
            
            # Personalize top N contacts
            generate_personalized = personalized_count < personalize_top_n
            
            item = create_send_queue_item(
                candidate=candidate,
                contact=contact,
                priority=int(candidate['overall_score'] * 100),
                generate_personalized=generate_personalized
            )
            
            send_items.append(item)
            contacts_added += 1
            
            if generate_personalized and item.get('personalization'):
                personalized_count += 1
    
    return send_items


def save_send_plan(send_items: List[Dict], scheduled_date: str = None) -> int:
    """
    Save send plan items to database.
    Returns count of items added.
    """
    if scheduled_date is None:
        scheduled_date = datetime.now().strftime("%Y-%m-%d")
    
    added = 0
    for item in send_items:
        result = db.add_to_send_queue(
            candidate_id=item['candidate_id'],
            contact_name=item['contact_name'],
            contact_email=item['contact_email'],
            contact_title=item['contact_title'],
            planned_subject=item['planned_subject'],
            planned_body=item['planned_body'],
            personalization=item.get('personalization'),
            priority=item['priority'],
            scheduled_date=scheduled_date
        )
        
        if result > 0:
            added += 1
            
            # Mark do_not_send if applicable
            if item.get('do_not_send'):
                db.mark_do_not_send(result, item.get('do_not_send_reason', 'unknown'))
    
    print(f"[Planner] Added {added} items to send queue for {scheduled_date}")
    return added


# ============ Main Pipeline Function ============

def plan_daily_sends(limit: int = None) -> int:
    """
    Main function to generate today's send plan from available candidates.
    Returns number of sends planned.
    """
    if limit is None:
        limit = config.DAILY_SEND_LIMIT
    
    print(f"[Planner] Generating send plan (limit: {limit})")
    
    # Get candidates ready for sending
    candidates = db.get_candidates_for_sending(limit=limit * 2)  # Get extra for filtering
    
    if not candidates:
        print("[Planner] No candidates ready for sending")
        return 0
    
    print(f"[Planner] Found {len(candidates)} potential candidates")
    
    # Parse contacts from JSON
    for candidate in candidates:
        if candidate.get('contacts_json'):
            candidate['contacts'] = json.loads(candidate['contacts_json'])
        if candidate.get('company_info'):
            try:
                candidate['company'] = json.loads(candidate['company_info'])
            except:
                candidate['company'] = {}
    
    # Dedupe
    deduped = dedupe_candidates(candidates)
    print(f"[Planner] After dedup: {len(deduped)} candidates")
    
    # Generate send plan
    send_items = generate_send_plan(deduped, daily_limit=limit)
    print(f"[Planner] Generated {len(send_items)} send items")
    
    # Save to database
    added = save_send_plan(send_items)
    
    return added


def get_todays_send_queue() -> List[Dict]:
    """Get today's pending sends."""
    return db.get_pending_sends(limit=config.DAILY_SEND_LIMIT)

