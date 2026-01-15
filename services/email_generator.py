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
    contact_title = contact.get('title', '')
    company_name = contact.get('company_name', '')
    domain = contact.get('domain', '')
    
    # Get subject template or use default
    subject_template = campaign.get('subject_template') or config.DEFAULT_SUBJECT_TEMPLATE
    body_template = campaign.get('body_template') or config.DEFAULT_BODY_TEMPLATE
    
    # Build prompt for GPT-4o
    prompt = f"""Generate a personalized email for an outreach campaign.

Campaign: {campaign.get('title', 'Outreach')}
Campaign Description: {campaign.get('description', '')}

Contact Information:
- Name: {contact_name}
- Title: {contact_title}
- Company: {company_name}
- Domain: {domain}

Subject Template: {subject_template}
Body Template: {body_template}

Instructions:
1. Personalize the subject line using the template. Make it specific to the contact and company.
2. Personalize the email body using the template. Include relevant details about the contact's role and company.
3. Keep the tone professional but friendly.
4. Ensure the email is concise and actionable.

Return your response as JSON with this exact format:
{{
  "subject": "personalized subject line",
  "body": "personalized email body"
}}"""

    try:
        response = client.chat.completions.create(
            model=config.LLM_MODEL_SMART,  # GPT-4o
            messages=[
                {
                    "role": "system",
                    "content": "You are an expert B2B sales email writer. Generate personalized, professional outreach emails that are concise and actionable."
                },
                {
                    "role": "user",
                    "content": prompt
                }
            ],
            max_tokens=800,
            temperature=0.7
        )
        
        content = response.choices[0].message.content.strip()
        
        # Parse JSON response
        if content.startswith('```'):
            content = content.replace('```json', '').replace('```', '').strip()
        
        result = json.loads(content)
        
        # Get subject/body from GPT result, or use template as fallback
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
        # Fallback to template-based generation
        return _generate_from_template(subject_template, body_template, contact, company_name)
    except Exception as e:
        print(f"[EmailGenerator] Error: {e}")
        # Fallback to template-based generation
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


