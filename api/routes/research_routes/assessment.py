"""Assessment endpoints for research routes."""

from fastapi import APIRouter

from api.routes._helpers import COMMON_ERROR_RESPONSES
from api.routes.research_routes.llm import llm_assess
from api.routes.research_routes.models import ICPAssessRequest, ICPAssessResponse

router = APIRouter()


@router.post("/icp-assess", response_model=ICPAssessResponse, responses=COMMON_ERROR_RESPONSES)
async def assess_icp_fit(request: ICPAssessRequest):
    """Use LLM to assess ICP fit given research data."""
    prompt = f"""You are evaluating whether a company is a good sales target for Zco Corporation,
a software development services company that builds custom web apps, mobile apps,
IoT solutions, and enterprise software.

Company: {request.company_name}
Industry: {request.industry or 'Unknown'}
Headcount: {request.headcount or 'Unknown'}
Location: {request.location or 'Unknown'}

Research:
{request.research_summary or 'No research available'}

Evaluate this company as a potential Zco client on a scale of 1-10.

Consider:
- Do they likely need custom software development?
- Are they big enough to afford outsourced dev ($50K+ projects)?
- Are they in a growth phase or modernizing?
- Is their industry one that benefits from custom software?
- Any signals they're looking for tech partners?

Respond with ONLY JSON:
{{
  "score": 7,
  "reasoning": "Brief 1-2 sentence explanation",
  "services_relevance": "What Zco services they might need",
  "talking_points": ["Point 1 for outreach", "Point 2"]
}}"""

    result = await llm_assess(prompt, max_tokens=300)

    if "error" in result:
        return {
            "score": 5,
            "reasoning": "Could not assess - using neutral score.",
            "services_relevance": "",
            "talking_points": [],
            "error": result["error"],
        }
    return result
