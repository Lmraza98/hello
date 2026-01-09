"""
Extractor Service: LLM-based schema extraction with evidence.
Minimizes LLM calls by using deterministic extraction first.
"""
import json
import re
from typing import List, Dict, Optional, Tuple
from openai import OpenAI
from tenacity import retry, stop_after_attempt, wait_exponential

import config
import database as db
from services.crawler import is_personal_email


# ============ LLM Client ============

def get_llm_client() -> OpenAI:
    """Get OpenAI client."""
    return OpenAI(api_key=config.OPENAI_API_KEY)


# ============ Text Trimming (Stay Under Token Budget) ============

def trim_text(text: str, max_chars: int = 2500) -> str:
    """
    Aggressively trim text to stay under token budget.
    ~4 chars per token, so 2500 chars ≈ 625 tokens.
    """
    if len(text) <= max_chars:
        return text
    
    # Take beginning and end
    half = max_chars // 2
    return text[:half] + "\n\n[...content trimmed...]\n\n" + text[-half:]


def prepare_extraction_input(crawl_data: Dict) -> str:
    """
    Prepare minimal, bounded input for LLM extraction.
    Target: ~600-900 tokens input.
    """
    sections = []
    
    # Homepage summary (trimmed)
    homepage = next((p for p in crawl_data.get('pages', []) if 'homepage' in p.get('url', '').lower() or p == crawl_data['pages'][0]), None)
    if homepage:
        title = homepage.get('title', '')
        text = homepage.get('text', '')[:1500]
        sections.append(f"HOMEPAGE ({homepage.get('url', '')}):\nTitle: {title}\n{trim_text(text, 1000)}")
    
    # Contact/Team page snippets
    contact_pages = [p for p in crawl_data.get('pages', []) if p != homepage][:2]
    for page in contact_pages:
        text = page.get('text', '')[:800]
        sections.append(f"PAGE ({page.get('url', '')}):\n{trim_text(text, 600)}")
    
    # Email evidence
    email_contexts = crawl_data.get('email_contexts', {})
    if email_contexts:
        evidence_lines = []
        for email, context in list(email_contexts.items())[:5]:
            evidence_lines.append(f"Email: {email}\nContext: {context[:200]}")
        sections.append("EMAIL EVIDENCE:\n" + "\n---\n".join(evidence_lines))
    
    # All found emails/phones
    all_emails = crawl_data.get('all_emails', [])
    all_phones = crawl_data.get('all_phones', [])
    if all_emails:
        sections.append(f"ALL EMAILS FOUND: {', '.join(all_emails[:10])}")
    if all_phones:
        sections.append(f"ALL PHONES FOUND: {', '.join(all_phones[:5])}")
    
    return "\n\n---\n\n".join(sections)


# ============ LLM Extraction ============

EXTRACTION_SYSTEM_PROMPT = """You are a data extraction assistant. Extract structured information from website content.

RULES:
1. Only include facts explicitly present in the provided text
2. If information is not present, use null
3. Include evidence snippets (brief quotes) for key facts
4. Be conservative - prefer null over guessing
5. For contacts, only include people with clear roles/titles found in the text"""

EXTRACTION_USER_TEMPLATE = """Extract company and contact information from this website content for domain: {domain}

{content}

Respond with valid JSON matching this schema:
{{
  "company": {{
    "name": "string or null",
    "domain": "{domain}",
    "industry_keywords": ["string"],
    "location": "string or null",
    "what_they_do": "brief description, null if unclear",
    "evidence": "quote from text supporting company description"
  }},
  "contacts": [
    {{
      "name": "string",
      "title": "string or null", 
      "email": "string or null (only if found in text)",
      "linkedin": "string or null (only if URL found)",
      "evidence": "quote showing this person exists with their role"
    }}
  ],
  "fit": {{
    "is_fit": true/false,
    "reason": "why this company might or might not be a fit",
    "confidence": 0.0-1.0
  }}
}}

Only include contacts where you have clear evidence of a real person. JSON only, no explanation."""


@retry(stop=stop_after_attempt(3), wait=wait_exponential(min=1, max=10))
def call_llm_extraction(domain: str, content: str) -> Optional[Dict]:
    """
    Call LLM for extraction. Returns parsed JSON or None.
    """
    if not db.can_make_llm_call():
        print(f"  [LLM] Daily cap reached, skipping {domain}")
        return None
    
    client = get_llm_client()
    
    prompt = EXTRACTION_USER_TEMPLATE.format(domain=domain, content=content)
    
    try:
        response = client.chat.completions.create(
            model=config.LLM_MODEL,
            messages=[
                {"role": "system", "content": EXTRACTION_SYSTEM_PROMPT},
                {"role": "user", "content": prompt}
            ],
            max_tokens=config.LLM_MAX_OUTPUT_TOKENS,
            temperature=0.1  # Low temp for consistent extraction
        )
        
        # Log usage
        usage = response.usage
        db.log_llm_usage(
            domain=domain,
            call_type='extraction',
            input_tokens=usage.prompt_tokens,
            output_tokens=usage.completion_tokens
        )
        
        # Parse response
        content = response.choices[0].message.content.strip()
        # Handle markdown code blocks
        if content.startswith('```'):
            content = re.sub(r'^```(?:json)?\n?', '', content)
            content = re.sub(r'\n?```$', '', content)
        
        return json.loads(content)
        
    except json.JSONDecodeError as e:
        print(f"  [LLM] JSON parse error for {domain}: {e}")
        return None
    except Exception as e:
        print(f"  [LLM] Error for {domain}: {e}")
        raise


# ============ Personalization Generation ============

PERSONALIZATION_SYSTEM_PROMPT = """You write brief, personalized email opening lines for B2B outreach.

RULES:
1. Be specific to the company - reference something concrete
2. Keep it to 1-2 sentences max
3. Sound human, not salesy
4. Don't make claims you can't support from the evidence"""

PERSONALIZATION_USER_TEMPLATE = """Write a personalized opening line for an email to {contact_name} at {company_name}.

Company info: {company_info}
Contact role: {contact_title}

Write ONLY the opening line (1-2 sentences). No greeting, no signature."""


@retry(stop=stop_after_attempt(2), wait=wait_exponential(min=1, max=5))
def generate_personalization(
    contact_name: str,
    contact_title: str,
    company_name: str,
    company_info: str
) -> Optional[str]:
    """
    Generate a personalized opening line for an email.
    Returns personalization text or None.
    """
    if not db.can_make_llm_call():
        return None
    
    client = get_llm_client()
    
    prompt = PERSONALIZATION_USER_TEMPLATE.format(
        contact_name=contact_name,
        company_name=company_name,
        company_info=company_info[:500],  # Trim company info
        contact_title=contact_title or "their role"
    )
    
    try:
        response = client.chat.completions.create(
            model=config.LLM_MODEL,
            messages=[
                {"role": "system", "content": PERSONALIZATION_SYSTEM_PROMPT},
                {"role": "user", "content": prompt}
            ],
            max_tokens=80,  # Very short output
            temperature=0.7  # Slightly higher for variety
        )
        
        # Log usage
        usage = response.usage
        db.log_llm_usage(
            domain=company_name,
            call_type='personalization',
            input_tokens=usage.prompt_tokens,
            output_tokens=usage.completion_tokens
        )
        
        return response.choices[0].message.content.strip()
        
    except Exception as e:
        print(f"  [LLM] Personalization error: {e}")
        return None


# ============ Domain Summary (Cached) ============

def get_or_create_domain_summary(domain: str, crawl_data: Dict) -> str:
    """
    Get cached domain summary or create new one.
    Summary is stored in candidates table.
    """
    # Check if we have a cached summary
    with db.get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT domain_summary FROM candidates 
            WHERE domain = ? AND domain_summary IS NOT NULL
            AND llm_extracted_at > datetime('now', '-30 days')
        """, (domain,))
        row = cursor.fetchone()
        if row and row['domain_summary']:
            return row['domain_summary']
    
    # Generate new summary from extraction
    content = prepare_extraction_input(crawl_data)
    extraction = call_llm_extraction(domain, content)
    
    if extraction and extraction.get('company'):
        company = extraction['company']
        summary = f"{company.get('name', domain)}: {company.get('what_they_do', 'Unknown business')}"
        if company.get('industry_keywords'):
            summary += f" (Keywords: {', '.join(company['industry_keywords'][:3])})"
        return summary
    
    return f"{domain}: Unable to extract summary"


# ============ Main Extraction Pipeline ============

def extract_candidate(domain: str, crawl_data: Dict) -> Optional[Dict]:
    """
    Full extraction pipeline for a domain.
    Returns candidate data or None.
    """
    print(f"[Extractor] Processing: {domain}")
    
    # Prepare bounded input
    content = prepare_extraction_input(crawl_data)
    print(f"  Input prepared: {len(content)} chars")
    
    # Call LLM for extraction
    extraction = call_llm_extraction(domain, content)
    
    if not extraction:
        print(f"  Extraction failed for {domain}")
        return None
    
    # Process results
    company = extraction.get('company', {})
    contacts = extraction.get('contacts', [])
    fit = extraction.get('fit', {})
    
    # Enhance contacts with emails from crawl data
    crawl_emails = set(crawl_data.get('all_emails', []))
    for contact in contacts:
        if contact.get('email'):
            continue  # Already has email
        # Try to match by name in email
        name_parts = contact.get('name', '').lower().split()
        for email in crawl_emails:
            prefix = email.split('@')[0].lower()
            if any(part in prefix for part in name_parts if len(part) > 2):
                contact['email'] = email
                crawl_emails.discard(email)
                break
    
    # Add any remaining personal emails as unknown contacts
    personal_emails = [e for e in crawl_emails if is_personal_email(e)]
    email_contexts = crawl_data.get('email_contexts', {})
    for email in personal_emails[:3]:  # Max 3 unknown contacts
        if not any(c.get('email') == email for c in contacts):
            contacts.append({
                'name': None,
                'title': None,
                'email': email,
                'evidence': email_contexts.get(email, 'Found on website')
            })
    
    # Calculate scores
    fit_score = 0.7 if fit.get('is_fit', False) else 0.3
    
    # Contact quality score
    named_contacts_with_email = sum(1 for c in contacts if c.get('name') and c.get('email'))
    unnamed_emails = sum(1 for c in contacts if c.get('email') and not c.get('name'))
    if named_contacts_with_email > 0:
        contact_quality = 0.9
    elif unnamed_emails > 0:
        contact_quality = 0.6
    elif contacts:
        contact_quality = 0.3
    else:
        contact_quality = 0.1
    
    # Evidence score
    has_company_evidence = bool(company.get('evidence'))
    has_contact_evidence = any(c.get('evidence') for c in contacts)
    evidence_score = 0.5
    if has_company_evidence:
        evidence_score += 0.25
    if has_contact_evidence:
        evidence_score += 0.25
    
    confidence = fit.get('confidence', 0.5)
    
    # Build domain summary
    domain_summary = f"{company.get('name', domain)}: {company.get('what_they_do', 'N/A')}"
    
    # Store in database
    candidate_id = db.add_candidate(
        domain=domain,
        company_name=company.get('name'),
        company_info=json.dumps(company),
        contacts=contacts,
        fit_score=fit_score,
        contact_quality_score=contact_quality,
        evidence_score=evidence_score,
        confidence=confidence,
        fit_reason=fit.get('reason'),
        domain_summary=domain_summary
    )
    
    db.update_target_status(domain, 'extracted')
    
    print(f"  Extracted: {company.get('name', domain)}, {len(contacts)} contacts, scores: fit={fit_score:.2f}, contact={contact_quality:.2f}, evidence={evidence_score:.2f}")
    
    return {
        'id': candidate_id,
        'domain': domain,
        'company': company,
        'contacts': contacts,
        'fit_score': fit_score,
        'contact_quality_score': contact_quality,
        'evidence_score': evidence_score,
        'confidence': confidence,
        'domain_summary': domain_summary
    }


def extract_from_crawl_results(crawl_results: List[Dict]) -> List[Dict]:
    """
    Process crawl results through extraction.
    """
    candidates = []
    
    for crawl_data in crawl_results:
        if crawl_data.get('status') != 'success':
            continue
        
        try:
            candidate = extract_candidate(crawl_data['domain'], crawl_data)
            if candidate:
                candidates.append(candidate)
        except Exception as e:
            print(f"[Extractor] Error for {crawl_data['domain']}: {e}")
            db.update_target_status(crawl_data['domain'], 'extraction_error')
    
    return candidates


# ============ Batch Processing ============

def process_crawled_domains(limit: int = 50) -> List[Dict]:
    """
    Process domains that have been crawled but not extracted.
    """
    with db.get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT t.domain, t.source_url
            FROM targets t
            WHERE t.status = 'crawled'
            AND NOT EXISTS (
                SELECT 1 FROM candidates c WHERE c.domain = t.domain
            )
            LIMIT ?
        """, (limit,))
        domains = [dict(row) for row in cursor.fetchall()]
    
    candidates = []
    
    for domain_info in domains:
        domain = domain_info['domain']
        
        # Reconstruct crawl data from stored pages
        pages = db.get_pages_for_domain(domain)
        
        crawl_data = {
            'domain': domain,
            'status': 'success',
            'pages': [],
            'all_emails': [],
            'all_phones': [],
            'email_contexts': {}
        }
        
        for page in pages:
            page_data = {
                'url': page['url'],
                'title': '',
                'text': ''
            }
            
            # Load text content
            if page.get('text_path'):
                try:
                    with open(page['text_path'], 'r', encoding='utf-8') as f:
                        page_data['text'] = f.read()
                except Exception:
                    pass
            
            # Load metadata
            if page.get('meta_json'):
                try:
                    meta = json.loads(page['meta_json'])
                    page_data['title'] = meta.get('title', '')
                except Exception:
                    pass
            
            # Collect emails/phones
            if page.get('emails_found'):
                emails = json.loads(page['emails_found'])
                crawl_data['all_emails'].extend(emails)
                # Build context from text
                for email in emails:
                    if is_personal_email(email) and page_data['text']:
                        idx = page_data['text'].lower().find(email.lower())
                        if idx >= 0:
                            start = max(0, idx - 150)
                            end = min(len(page_data['text']), idx + len(email) + 150)
                            crawl_data['email_contexts'][email] = page_data['text'][start:end]
            
            if page.get('phones_found'):
                crawl_data['all_phones'].extend(json.loads(page['phones_found']))
            
            crawl_data['pages'].append(page_data)
        
        # Dedupe
        crawl_data['all_emails'] = list(set(crawl_data['all_emails']))
        crawl_data['all_phones'] = list(set(crawl_data['all_phones']))
        
        try:
            candidate = extract_candidate(domain, crawl_data)
            if candidate:
                candidates.append(candidate)
        except Exception as e:
            print(f"[Extractor] Error for {domain}: {e}")
            db.update_target_status(domain, 'extraction_error')
    
    return candidates


