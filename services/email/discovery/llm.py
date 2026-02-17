"""LLM analysis helpers for email discovery."""

import json
import re
from typing import Dict

from openai import OpenAI

import config
from api.observability import compute_openai_cost_usd, record_cost
from services.email.discovery.constants import VALID_PATTERNS


def analyze_pattern_with_llm(company_name: str, domain: str, search_results: Dict) -> Dict:
    """
    Use GPT-4o to analyze search results and determine email pattern.
    """
    if not config.OPENAI_API_KEY:
        return {"pattern": "first.last", "confidence": 0.3, "reasoning": "No API key"}

    context_parts = []
    if search_results.get("answer"):
        context_parts.append(f"Summary: {search_results['answer']}")

    for result in search_results.get("results", [])[:5]:
        content = result.get("content", "")[:500]
        context_parts.append(f"- {result.get('title', '')}: {content}")

    context = "\n".join(context_parts) if context_parts else "No search results found."
    patterns_list = "\n".join([f"- {p}" for p in VALID_PATTERNS])

    prompt = f"""Analyze the email pattern and domain used by {company_name}.

Web search results:
{context}

Your task:
1. Find the ACTUAL email domain this company uses (e.g., @accesscorp.com, NOT a guess like @accessinformationmanagement.com)
2. Determine the email format/pattern

You MUST choose the pattern from ONLY these options:
{patterns_list}

Pattern examples:
- first.last = john.smith@company.com
- firstlast = johnsmith@company.com
- flast = jsmith@company.com (first initial + last name)
- f.last = j.smith@company.com
- first_last = john_smith@company.com

Respond in JSON format:
{{
    "domain": "accesscorp.com",
    "pattern": "flast",
    "confidence": 0.8,
    "examples_found": ["jsmith@accesscorp.com", "mwilliams@accesscorp.com"],
    "reasoning": "Found real emails showing domain is accesscorp.com with flast pattern"
}}

IMPORTANT:
- The "domain" field should be the ACTUAL email domain found in examples, not a guess
- If you can't find the real domain, use null for domain
- The "pattern" field MUST be exactly one of: {', '.join(VALID_PATTERNS)}
Respond ONLY with the JSON, no other text."""

    try:
        client = OpenAI(api_key=config.OPENAI_API_KEY)
        response = client.chat.completions.create(
            model=config.LLM_MODEL_SMART,
            messages=[{"role": "user", "content": prompt}],
            max_tokens=300,
            temperature=0,
        )
        usage = response.usage
        prompt_tokens = usage.prompt_tokens if usage else 0
        completion_tokens = usage.completion_tokens if usage else 0
        record_cost(
            provider="openai",
            model=config.LLM_MODEL_SMART,
            feature="email_discovery",
            endpoint="services.email.discovery.llm.analyze_pattern_with_llm",
            usd=compute_openai_cost_usd(config.LLM_MODEL_SMART, prompt_tokens, completion_tokens),
            input_tokens=prompt_tokens,
            output_tokens=completion_tokens,
        )

        result_text = response.choices[0].message.content.strip()
        result_text = re.sub(r"^```json\s*", "", result_text)
        result_text = re.sub(r"\s*```$", "", result_text)
        result = json.loads(result_text)

        pattern = result.get("pattern", "first.last").lower().replace(" ", "").replace("_", "_")
        pattern_aliases = {
            "firstname.lastname": "first.last",
            "firstnamelastname": "firstlast",
            "firstinitiallastname": "flast",
            "firstnameinitial.lastnameinitial": "fl",
            "f_last": "f.last",
            "last_name": "last",
            "first_name": "first",
        }
        pattern = pattern_aliases.get(pattern, pattern)

        if pattern not in VALID_PATTERNS:
            print(f"[EmailDiscoverer] Invalid pattern '{pattern}' returned, defaulting to first.last")
            pattern = "first.last"
            result["confidence"] = min(result.get("confidence", 0.5), 0.5)

        result["pattern"] = pattern
        return result
    except Exception as e:
        print(f"[EmailDiscoverer] LLM error for {company_name}: {e}")
        return {
            "pattern": "first.last",
            "confidence": 0.3,
            "reasoning": f"LLM error: {str(e)}",
        }
