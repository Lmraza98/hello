/**
 * Research service — Tavily web search + LLM ICP assessment.
 * Used by the company vetting workflow to enrich company data.
 */

const API_BASE = '/api/research';

async function fetchJson<T>(url: string, body: Record<string, any>): Promise<T> {
  const res = await fetch(API_BASE + url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Research API error: ${res.status}`);
  return res.json();
}

/**
 * Quick research on a company — overview + recent news + ICP assessment.
 */
export async function researchCompany(
  company: {
    name: string;
    industry?: string;
    headcount?: string;
    location?: string;
  },
  icpContext?: { industry?: string; location?: string }
): Promise<Record<string, any>> {
  try {
    // Step 1: Web research via Tavily
    const webData = await fetchJson<{
      company: string;
      research: Array<{
        query: string;
        answer?: string;
        results?: Array<{ title: string; url: string; content: string }>;
        error?: string;
      }>;
    }>('/company', {
      company_name: company.name,
      industry: company.industry || icpContext?.industry,
      context: 'software development services custom apps technology partner',
    });

    // Step 2: ICP fit assessment via LLM
    const researchSummary = webData.research
      ?.map((r) => r.answer || '')
      .filter(Boolean)
      .join('\n');

    const icpData = await fetchJson<{
      score: number;
      reasoning: string;
      services_relevance: string;
      talking_points: string[];
      error?: string;
    }>('/icp-assess', {
      company_name: company.name,
      industry: company.industry || icpContext?.industry || '',
      headcount: company.headcount || '',
      location: company.location || icpContext?.location || '',
      research_summary: researchSummary,
    });

    // Collect all unique source links from Tavily results
    const sources: Array<{ title: string; url: string; snippet?: string }> = [];
    const seenUrls = new Set<string>();
    for (const r of webData.research || []) {
      for (const result of r.results || []) {
        if (result.url && !seenUrls.has(result.url)) {
          seenUrls.add(result.url);
          sources.push({
            title: result.title,
            url: result.url,
            snippet: result.content?.slice(0, 150),
          });
        }
      }
    }

    return {
      website_summary: webData.research?.[0]?.answer,
      recent_news: webData.research?.[1]?.results?.map((r) => r.title) || [],
      services_relevance: icpData.services_relevance,
      icp_fit_score: icpData.score,
      icp_fit_reasoning: icpData.reasoning,
      talking_points: icpData.talking_points,
      sources,
    };
  } catch (err) {
    console.error('Company research failed:', err);
    return {};
  }
}

/**
 * Deep research — more detailed search for "More Info" button.
 */
export async function deepResearchCompany(
  company: { name: string; industry?: string },
  _icpContext?: { industry?: string }
): Promise<Record<string, any>> {
  try {
    const [techRes, competitorRes, linkedinRes] = await Promise.all([
      fetchJson<{ answer?: string; results?: any[] }>('/search', {
        query: `${company.name} technology stack software digital transformation`,
        max_results: 5,
        search_depth: 'advanced',
      }),
      fetchJson<{ answer?: string; results?: any[] }>('/search', {
        query: `${company.name} competitors market position ${company.industry || ''}`,
        max_results: 3,
      }),
      fetchJson<{ answer?: string; results?: any[] }>('/search', {
        query: `site:linkedin.com "${company.name}" posts technology hiring`,
        max_results: 3,
      }),
    ]);

    return {
      tech_signals: techRes.answer,
      tech_sources: techRes.results?.slice(0, 3),
      market_position: competitorRes.answer,
      linkedin_activity: linkedinRes.answer,
      linkedin_sources: linkedinRes.results?.slice(0, 3),
    };
  } catch (err) {
    console.error('Deep research failed:', err);
    return {};
  }
}

/**
 * Format deep research results into a readable message.
 */
export function formatDeepResearch(research: Record<string, any>, companyName: string): string {
  const sections: string[] = [];

  if (research.tech_signals) {
    sections.push(`**Tech Signals:**\n${research.tech_signals}`);
  }
  if (research.market_position) {
    sections.push(`**Market Position:**\n${research.market_position}`);
  }
  if (research.linkedin_activity) {
    sections.push(`**LinkedIn Activity:**\n${research.linkedin_activity}`);
  }

  return sections.length > 0
    ? `Here's what I found about **${companyName}**:\n\n${sections.join('\n\n')}`
    : `Couldn't find additional information about ${companyName}.`;
}
