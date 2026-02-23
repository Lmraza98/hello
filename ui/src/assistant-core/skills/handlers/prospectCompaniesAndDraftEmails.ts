/**
 * Deterministic handler for prospecting + decision-maker + draft/schedule flow.
 *
 * Designed for requests like:
 * - find N companies in industry/location/funding window
 * - find Head of Marketing at each
 * - draft intro emails
 * - schedule sends N days from now
 */

import type { ExecutionPlan, SkillHandler } from '../../domain/types';

function toPositiveInt(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return Math.floor(value);
  if (typeof value === 'string' && value.trim()) {
    const n = Number.parseInt(value, 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return fallback;
}

function cleanText(value: unknown, fallback: string): string {
  const text = typeof value === 'string' ? value.trim() : '';
  return text || fallback;
}

function extractBracketService(userMessage: string): string | null {
  const match = userMessage.match(/\[([^\]]+)\]/);
  if (!match) return null;
  const out = (match[1] || '').trim();
  return out || null;
}

function parseCompanyCount(userMessage: string): number | null {
  const m = userMessage.match(/\bfind\s+(\d{1,2})\s+companies\b/i);
  if (!m) return null;
  const n = Number.parseInt(m[1], 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function parseDaysFromNow(userMessage: string): number | null {
  const m = userMessage.match(/\b(\d{1,2})\s+days?\s+from\s+now\b/i);
  if (!m) return null;
  const n = Number.parseInt(m[1], 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function parseFundingStage(userMessage: string): string | null {
  const m = userMessage.match(/\b(series\s+[a-z])\b/i);
  if (!m) return null;
  return m[1].replace(/\s+/g, ' ').trim();
}

function parseLocation(userMessage: string): string | null {
  const raised = userMessage.match(/\bin\s+([a-z][a-z\s]+?)\s+that\s+have\s+raised\b/i);
  if (raised) return raised[1].trim();
  const based = userMessage.match(/\b(?:based|located)\s+in\s+([a-z][a-z\s,.-]{1,60})\b/i);
  if (based) return based[1].trim();
  const simple = userMessage.match(/\bin\s+([a-z][a-z\s,.-]{1,60})\b/i);
  if (simple) return simple[1].trim();
  return null;
}

function parseIndustry(userMessage: string): string | null {
  const m = userMessage.match(/\bin\s+the\s+([a-z][a-z\s&-]+?)\s+(?:space|industry|sector)\b/i);
  if (!m) return null;
  return m[1].trim();
}

function parseDecisionMakerTitle(userMessage: string): string | null {
  const m = userMessage.match(/\b(?:identify|find)\s+(?:key\s+)?([a-z][a-z\s/&-]{3,60}?)\s+(?:for|at)\s+companies\b/i);
  if (!m) return null;
  return m[1].trim();
}

function parseMinRevenueMillions(userMessage: string): number | null {
  const m = userMessage.match(/\brevenue\s+(?:of\s+)?(?:over|above|greater\s+than|>=?)\s*\$?\s*([\d,.]+)\s*(million|m|billion|bn|b)?\b/i);
  if (!m) return null;
  const base = Number.parseFloat((m[1] || '').replace(/,/g, ''));
  if (!Number.isFinite(base) || base <= 0) return null;
  const unit = (m[2] || '').toLowerCase();
  if (unit === 'billion' || unit === 'bn' || unit === 'b') return Math.round(base * 1000);
  return Math.round(base);
}

function parseMinYearsInBusiness(userMessage: string): number | null {
  const m = userMessage.match(/\b(?:at\s+least|minimum|min(?:imum)?\s+of)?\s*(\d{1,3})\s+years?\s+(?:in\s+business|old)\b/i);
  if (!m) return null;
  const n = Number.parseInt(m[1], 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function canonicalIndustryForSalesNav(industry: string): string | null {
  const lower = industry.trim().toLowerCase();
  if (!lower) return null;
  // Keep this strictly limited to values currently URL-mapped in query_builder.
  if (lower.includes('health')) return 'Hospitals and Health Care';
  if (lower.includes('construction')) return 'Construction';
  if (lower.includes('optometr')) return 'Optometrists';
  if (lower.includes('chiropract')) return 'Chiropractors';
  return null;
}

function buildAccountLocationFilter(location: string): string | null {
  const text = location.trim();
  if (!text) return null;
  // Current URL mapping supports United States only.
  if (/california/i.test(text)) return 'United States';
  if (/united states|usa|u\.s\./i.test(text)) return 'United States';
  return null;
}

export const prospectCompaniesAndDraftEmailsHandler: SkillHandler = ({ extractedParams, userMessage }) => {
  const parsedCount = parseCompanyCount(userMessage);
  const parsedDays = parseDaysFromNow(userMessage);
  const parsedFunding = parseFundingStage(userMessage);
  const parsedLocation = parseLocation(userMessage);
  const parsedIndustry = parseIndustry(userMessage);
  const parsedDecisionMakerTitle = parseDecisionMakerTitle(userMessage);
  const parsedMinRevenueMillions = parseMinRevenueMillions(userMessage);
  const parsedMinYearsInBusiness = parseMinYearsInBusiness(userMessage);
  const bracketService = extractBracketService(userMessage);

  const companyCount = Math.min(toPositiveInt(extractedParams.company_count ?? parsedCount, 5), 20);
  const daysFromNow = Math.min(toPositiveInt(extractedParams.days_from_now ?? parsedDays, 3), 30);
  const industry = cleanText(extractedParams.industry ?? parsedIndustry, 'fintech');
  const location = cleanText(extractedParams.location ?? parsedLocation, 'New York City');
  const decisionMakerTitle = cleanText(extractedParams.decision_maker_title ?? parsedDecisionMakerTitle, 'Head of Marketing');
  const minRevenueMillions = Math.max(1, toPositiveInt(extractedParams.min_revenue_millions ?? parsedMinRevenueMillions, 100));
  const minYearsInBusiness = Math.max(1, toPositiveInt(extractedParams.min_years_in_business ?? parsedMinYearsInBusiness, 5));
  const fundingStage = cleanText(extractedParams.funding_stage ?? parsedFunding, 'Series B');
  const specificService = cleanText(extractedParams.specific_service ?? bracketService, 'our service');
  const wantsCampaignWorkflow = /\b(campaign|outreach|email|sequence|draft|send|schedule|enroll)\b/i.test(userMessage);

  const companyQuery = `${industry} companies in ${location} revenue over $${minRevenueMillions}M in business at least ${minYearsInBusiness} years`;
  const peopleQuery = `${decisionMakerTitle} ${industry} ${location} revenue over ${minRevenueMillions}m`;
  const salesNavCompanyQuery = userMessage;
  const salesNavPeopleQuery = userMessage;
  const salesNavIndustry = canonicalIndustryForSalesNav(industry);
  const salesNavLocation = buildAccountLocationFilter(location);
  const salesNavRevenue = `${minRevenueMillions}+`;
  const campaignName = `${industry} ${location} ${fundingStage} Intro Outreach`;
  const campaignDescription =
    `Auto-generated outreach campaign for ${industry} companies in ${location} (${fundingStage}, revenue>${minRevenueMillions}M, age>=${minYearsInBusiness}y). ` +
    `Personalization focus: ${specificService}.`;

  const discoverySteps: ExecutionPlan['steps'] = [
    {
      id: 'discover_companies_local',
      toolCall: {
        name: 'search_companies',
        args: {
          q: companyQuery,
          vertical: industry,
        },
      },
      requiresConfirmation: false,
      description: `Search local companies for ${industry} in ${location} with revenue/age constraints`,
    },
    {
      id: 'discover_contacts_local',
      toolCall: {
        name: 'search_contacts',
        args: {
          query: peopleQuery,
          has_email: true,
        },
      },
      requiresConfirmation: false,
      description: `Find local ${decisionMakerTitle} contacts with email for outreach`,
    },
    {
      id: 'escalate_salesnav_background',
      toolCall: {
        name: 'compound_workflow_run',
        args: {
          spec: {
            name: `Background SalesNav Lead Search - ${industry} ${location}`,
            description: `Search Sales Navigator for ${decisionMakerTitle} leads at ${industry} companies in ${location} matching revenue/age constraints.`,
            original_query: userMessage,
            constraints: {
              max_results: Math.max(companyCount * 5, 25),
              max_runtime_minutes: 45,
              max_browser_calls: 250,
              concurrency: 2,
            },
            phases: [
              {
                id: 'phase_1_discover_target_companies',
                name: 'Discover target companies on SalesNav',
                type: 'search',
                operation: {
                  tool: 'browser_search_and_extract',
                  task: 'salesnav_search_account',
                  base_params: {
                    query: salesNavCompanyQuery,
                    // Let backend NL decomposition + query_builder (salesnav-filters*.json)
                    // derive canonical filter_values instead of UI-side hardcoded heuristics.
                    ...(salesNavIndustry || salesNavLocation
                      ? {
                          filter_values: {
                            ...(salesNavIndustry ? { industry: [salesNavIndustry] } : {}),
                            ...(salesNavLocation ? { headquarters_location: salesNavLocation } : {}),
                            annual_revenue: salesNavRevenue,
                          },
                        }
                      : {}),
                    limit: Math.max(companyCount, 25),
                    extract_type: 'company',
                  },
                },
                post_process: { limit: Math.max(companyCount, 25) },
              },
              {
                id: 'phase_2_discover_decision_makers',
                name: 'Discover decision-makers on SalesNav',
                type: 'search',
                operation: {
                  tool: 'browser_search_and_extract',
                  task: 'salesnav_people_search',
                  base_params: {
                    query: salesNavPeopleQuery,
                    ...(salesNavIndustry
                      ? {
                          filter_values: {
                            industry: [salesNavIndustry],
                            annual_revenue: salesNavRevenue,
                          },
                        }
                      : {}),
                    limit: Math.max(companyCount * 5, 25),
                    extract_type: 'lead',
                  },
                },
                iteration: {
                  over: 'phase_1_discover_target_companies',
                  as: 'company',
                  max_items: Math.max(companyCount, 25),
                  concurrency: 2,
                },
                param_templates: {
                  current_company: '{{company.title}}',
                  current_company_sales_nav_url: '{{company.url}}',
                },
                post_process: { limit: Math.max(companyCount * 5, 25) },
                depends_on: ['phase_1_discover_target_companies'],
              },
            ],
          },
        },
      },
      requiresConfirmation: true,
      description: 'Start background Sales Navigator lead search if local matches are insufficient',
    },
  ];

  const campaignSteps: ExecutionPlan['steps'] = wantsCampaignWorkflow
    ? [
        {
          id: 'create_campaign',
          toolCall: {
            name: 'create_campaign',
            args: {
              name: campaignName,
              description: campaignDescription,
              num_emails: 1,
              days_between_emails: 1,
            },
          },
          requiresConfirmation: true,
          description: `Create campaign "${campaignName}"`,
        },
        {
          id: 'enroll_contacts',
          toolCall: {
            name: 'enroll_contacts_by_filter',
            args: {
              campaign_id: '$prev.create_campaign.id',
              query: `${industry} ${location} ${decisionMakerTitle.toLowerCase()} revenue over ${minRevenueMillions}m`,
              has_email: true,
            },
          },
          requiresConfirmation: true,
          description: `Enroll matching head-of-marketing contacts into campaign`,
        },
        {
          id: 'prepare_drafts',
          toolCall: {
            name: 'prepare_email_batch',
            args: {},
          },
          requiresConfirmation: true,
          description: `Prepare personalized draft emails`,
        },
        {
          id: 'approve_campaign_queue',
          toolCall: {
            name: 'approve_campaign_review_queue',
            args: {
              campaign_id: '$prev.create_campaign.id',
              limit: companyCount,
            },
          },
          requiresConfirmation: true,
          description: `Approve prepared drafts for this campaign`,
        },
        {
          id: 'schedule_campaign',
          toolCall: {
            name: 'reschedule_campaign_emails',
            args: {
              campaign_id: '$prev.create_campaign.id',
              days_from_now: daysFromNow,
              limit: companyCount,
            },
          },
          requiresConfirmation: true,
          description: `Schedule campaign emails for ${daysFromNow} day(s) from now`,
        },
        {
          id: 'verify_schedule',
          toolCall: {
            name: 'get_scheduled_emails',
            args: {
              campaign_id: '$prev.create_campaign.id',
              limit: companyCount,
            },
          },
          requiresConfirmation: false,
          description: `Verify scheduled emails for campaign`,
        },
      ]
    : [];

  const plan: ExecutionPlan = {
    skillId: 'prospect-companies-and-draft-emails',
    extractedParams: {
      company_count: companyCount,
      days_from_now: daysFromNow,
      industry,
      location,
      decision_maker_title: decisionMakerTitle,
      min_revenue_millions: minRevenueMillions,
      min_years_in_business: minYearsInBusiness,
      funding_stage: fundingStage,
      specific_service: specificService,
    },
    steps: [...discoverySteps, ...campaignSteps],
  };

  return plan;
};
