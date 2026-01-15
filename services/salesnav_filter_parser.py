"""
GPT-4 Filter Parser: Converts natural language queries into LinkedIn Sales Navigator filter specifications.
"""
import json
from typing import Dict, List, Optional
from openai import OpenAI

import config


class SalesNavFilterParser:
    """
    Uses GPT-4 to parse natural language queries into structured Sales Navigator filters.
    
    Example:
        Input: "Construction companies in New England"
        Output: {
            "industry": ["Construction"],
            "headquarters_location": [
                "Massachusetts, United States",
                "New Hampshire, United States",
                "Vermont, United States",
                "Maine, United States",
                "Connecticut, United States",
                "Rhode Island, United States"
            ],
            "company_headcount": None,
            "annual_revenue": None,
            ...
        }
    """
    
    def __init__(self):
        if not config.OPENAI_API_KEY:
            raise ValueError("OPENAI_API_KEY not configured in config.py")
        self.client = OpenAI(api_key=config.OPENAI_API_KEY)
    
    def parse_query(self, query: str) -> Dict:
        """
        Parse a natural language query into Sales Navigator filter specifications.
        
        Args:
            query: Natural language query like "Construction companies in New England"
            
        Returns:
            Dictionary with filter specifications
        """
        prompt = f"""You are a LinkedIn Sales Navigator filter expert. Convert the following natural language query into structured filter specifications for LinkedIn Sales Navigator Account search.

Query: "{query}"

Available filter categories:
1. Industry - Standard LinkedIn industry names (e.g., "Construction", "Technology", "Healthcare")
2. Headquarters Location - Format: "State, United States" or "City, State, United States" or "Country"
3. Company Headcount - Ranges like "1-10", "11-50", "51-200", "201-500", "501-1000", "1001-5000", "5001-10000", "10001+"
4. Annual Revenue - Ranges like "0-1M", "1M-10M", "10M-50M", "50M-100M", "100M-500M", "500M-1B", "1B+"
5. Company Headcount Growth - "Growing", "Stable", "Declining"
6. Number of Followers - Ranges like "0-100", "101-1000", "1001-10000", "10000+"

Special handling:
- Regional names like "New England" should expand to all states: Massachusetts, New Hampshire, Vermont, Maine, Connecticut, Rhode Island
- "West Coast" = California, Oregon, Washington
- "East Coast" = Maine, New Hampshire, Massachusetts, Rhode Island, Connecticut, New York, New Jersey, Pennsylvania, Delaware, Maryland, Virginia, North Carolina, South Carolina, Georgia, Florida
- "Midwest" = Illinois, Indiana, Michigan, Ohio, Wisconsin, Iowa, Kansas, Minnesota, Missouri, Nebraska, North Dakota, South Dakota
- "Southwest" = Arizona, New Mexico, Oklahoma, Texas
- "Southeast" = Alabama, Arkansas, Florida, Georgia, Kentucky, Louisiana, Mississippi, North Carolina, South Carolina, Tennessee, Virginia, West Virginia

Return a JSON object with this structure:
{{
    "industry": ["Industry Name 1", "Industry Name 2"],
    "headquarters_location": ["State, United States", ...],
    "company_headcount": "1-10" or null,
    "annual_revenue": "1M-10M" or null,
    "company_headcount_growth": "Growing" or null,
    "number_of_followers": "1000+" or null,
    "keywords": ["optional", "search", "keywords"]
}}

If a filter category is not specified in the query, set it to null.
Return ONLY valid JSON, no additional text."""

        try:
            response = self.client.chat.completions.create(
                model=config.LLM_MODEL_SMART,  # Use GPT-4o for better reasoning
                messages=[
                    {
                        "role": "system",
                        "content": "You are a LinkedIn Sales Navigator filter expert. Always return valid JSON only."
                    },
                    {
                        "role": "user",
                        "content": prompt
                    }
                ],
                response_format={"type": "json_object"},
                temperature=0.1  # Low temperature for consistent parsing
            )
            
            result_text = response.choices[0].message.content.strip()
            filters = json.loads(result_text)
            
            # Validate and clean the filters
            return self._validate_filters(filters)
            
        except json.JSONDecodeError as e:
            print(f"[Filter Parser] JSON decode error: {e}")
            print(f"[Filter Parser] Response was: {result_text}")
            raise ValueError(f"Failed to parse GPT-4 response as JSON: {e}")
        except Exception as e:
            print(f"[Filter Parser] Error: {e}")
            raise
    
    def _validate_filters(self, filters: Dict) -> Dict:
        """Validate and clean filter specifications."""
        validated = {
            "industry": filters.get("industry") or [],
            "headquarters_location": filters.get("headquarters_location") or [],
            "company_headcount": filters.get("company_headcount"),
            "annual_revenue": filters.get("annual_revenue"),
            "company_headcount_growth": filters.get("company_headcount_growth"),
            "number_of_followers": filters.get("number_of_followers"),
            "keywords": filters.get("keywords") or []
        }
        
        # Ensure lists are actually lists
        if not isinstance(validated["industry"], list):
            validated["industry"] = [validated["industry"]] if validated["industry"] else []
        if not isinstance(validated["headquarters_location"], list):
            validated["headquarters_location"] = [validated["headquarters_location"]] if validated["headquarters_location"] else []
        if not isinstance(validated["keywords"], list):
            validated["keywords"] = [validated["keywords"]] if validated["keywords"] else []
        
        return validated


def parse_salesnav_query(query: str) -> Dict:
    """
    Convenience function to parse a query.
    
    Args:
        query: Natural language query
        
    Returns:
        Filter specifications dictionary
    """
    parser = SalesNavFilterParser()
    return parser.parse_query(query)


