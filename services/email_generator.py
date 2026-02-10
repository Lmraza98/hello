"""
Email generation service using GPT-4o for campaign-based messaging.
"""
import json
from typing import Dict, Optional, Tuple
from openai import OpenAI

import config
import database as db


def generate_email_with_gpt4o(campaign: Dict, contact: Dict) -> Tuple[str, str]:
    """
    Generate email subject and body using GPT-4o based on campaign template.
    
    The LLM's ONLY job is to replace {placeholder} variables in the template.
    It must NOT rewrite, rephrase, or add content beyond what the template specifies.
    The special {personalization} variable is the one place the LLM adds a custom sentence.
    
    Args:
        campaign: Campaign dict with title, subject_template, body_template
        contact: Contact dict with name, title, company_name, etc.
    
    Returns:
        Tuple of (subject, body)
    """
    if not config.OPENAI_API_KEY:
        raise ValueError("OPENAI_API_KEY not configured")
    
    client = OpenAI(api_key=config.OPENAI_API_KEY)
    
    # Build context for personalization
    contact_name = contact.get('name', 'there')
    first_name = contact_name.split()[0] if contact_name else 'there'
    contact_title = contact.get('title', '')
    company_name = contact.get('company_name', '')
    domain = contact.get('domain', '')
    
    # Get subject template or use default
    subject_template = campaign.get('subject_template') or config.DEFAULT_SUBJECT_TEMPLATE
    body_template = campaign.get('body_template') or config.DEFAULT_BODY_TEMPLATE
    
    # Check if the template even has placeholders that need LLM help.
    # If it only has simple variables like {name}, {company}, skip the LLM entirely.
    simple_vars = {'{name}', '{Name}', '{FirstName}', '{company}', '{Company}',
                   '{title}', '{domain}', '{sender_name}', '{value_prop}', '{opt_out_line}'}
    
    # Find all {placeholder} patterns in the template
    import re
    all_placeholders = set(re.findall(r'\{[^}]+\}', subject_template + body_template))
    needs_llm = bool(all_placeholders - simple_vars)  # Has placeholders beyond simple ones
    
    if not needs_llm:
        # No LLM needed — just do variable replacement
        return _generate_from_template(subject_template, body_template, contact, company_name)
    
    # Build prompt — strict template-following instructions
    prompt = f"""You are filling in placeholders in an email template. Your job is to REPLACE the {{placeholders}} with appropriate content while keeping EVERYTHING ELSE exactly as written.

TEMPLATE (Subject):
{subject_template}

TEMPLATE (Body):
{body_template}

CONTACT INFO:
- Name: {contact_name}
- First Name: {first_name}
- Title: {contact_title}
- Company: {company_name}
- Domain: {domain}

CAMPAIGN CONTEXT:
- Campaign: {campaign.get('title', 'Outreach')}
- Description: {campaign.get('description', 'N/A')}

VARIABLE REPLACEMENT RULES:
- {{name}} or {{Name}} → "{contact_name}"
- {{FirstName}} → "{first_name}"
- {{company}} or {{Company}} → "{company_name}"
- {{title}} → "{contact_title}"
- {{personalization}} → Write 1-2 short sentences referencing the contact's role/company. Keep it natural and brief.
- {{value_prop}} → A brief value proposition relevant to the contact.
- Any other {{placeholder}} → Replace with contextually appropriate content.

CRITICAL RULES:
1. DO NOT rewrite, rephrase, or restructure the template. Keep the EXACT wording.
2. DO NOT add greetings, sign-offs, or content that isn't in the template.
3. DO NOT add "Best regards", "[Your Name]", or signature blocks unless the template has them.
4. ONLY replace the {{placeholder}} text. Everything else stays IDENTICAL.
5. If a line has no placeholders, output it exactly as-is.

Return JSON:
{{
  "subject": "subject with placeholders filled in",
  "body": "body with placeholders filled in"
}}"""

    try:
        response = client.chat.completions.create(
            model=config.LLM_MODEL_SMART,
            messages=[
                {
                    "role": "system",
                    "content": "You are a template variable replacement engine. You fill in {placeholders} in email templates. You NEVER rewrite, rephrase, or add to the template. You ONLY replace {placeholder} variables with appropriate values. Output the template exactly as written, with only the {placeholders} replaced."
                },
                {
                    "role": "user",
                    "content": prompt
                }
            ],
            max_tokens=800,
            temperature=0.3  # Low temperature for faithful reproduction
        )
        
        content = response.choices[0].message.content.strip()
        
        # Parse JSON response
        if content.startswith('```'):
            content = content.replace('```json', '').replace('```', '').strip()
        
        result = json.loads(content)
        
        subject = result.get('subject')
        body = result.get('body')
        
        if not subject:
            subject = subject_template.replace('{company}', company_name).replace('{Company}', company_name)
        if not body:
            body = body_template.replace('{company}', company_name).replace('{Company}', company_name)
            body = body.replace('{name}', contact_name).replace('{Name}', contact_name)
        
        # Log LLM usage
        usage = response.usage
        db.log_llm_usage(
            domain=domain,
            call_type='email_generation',
            input_tokens=usage.prompt_tokens,
            output_tokens=usage.completion_tokens
        )
        
        return subject, body
        
    except json.JSONDecodeError as e:
        print(f"[EmailGenerator] JSON parse error: {e}")
        return _generate_from_template(subject_template, body_template, contact, company_name)
    except Exception as e:
        print(f"[EmailGenerator] Error: {e}")
        return _generate_from_template(subject_template, body_template, contact, company_name)


def _generate_from_template(subject_template: str, body_template: str, contact: Dict, company_name: str) -> Tuple[str, str]:
    """Fallback template-based generation if GPT-4o fails."""
    contact_name = contact.get('name', 'there')
    
    # Build replacements dict with both cases for common variables
    replacements = {
        'company': company_name,
        'Company': company_name,
        'name': contact_name,
        'Name': contact_name,
        'personalization': f"Hi {contact_name},",
        'value_prop': config.VALUE_PROP,
        'sender_name': config.SENDER_NAME,
        'opt_out_line': config.OPT_OUT_LINE
    }
    
    # Try to format, handle missing keys gracefully
    try:
        subject = subject_template.format(**replacements)
    except KeyError as e:
        print(f"[EmailGenerator] Subject template has unknown variable: {e}")
        subject = subject_template.replace('{company}', company_name).replace('{Company}', company_name)
    
    try:
        body = body_template.format(**replacements)
    except KeyError as e:
        print(f"[EmailGenerator] Body template has unknown variable: {e}")
        body = body_template.replace('{company}', company_name).replace('{Company}', company_name)
        body = body.replace('{name}', contact_name).replace('{Name}', contact_name)
    
    return subject, body


