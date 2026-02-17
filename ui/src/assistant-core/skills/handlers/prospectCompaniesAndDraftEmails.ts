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
  const m = userMessage.match(/\bin\s+([a-z][a-z\s]+?)\s+that\s+have\s+raised\b/i);
  if (!m) return null;
  return m[1].trim();
}

function parseIndustry(userMessage: string): string | null {
  const m = userMessage.match(/\bin\s+the\s+([a-z][a-z\s]+?)\s+space\b/i);
  if (!m) return null;
  return m[1].trim();
}

export const prospectCompaniesAndDraftEmailsHandler: SkillHandler = ({ extractedParams, userMessage }) => {
  const parsedCount = parseCompanyCount(userMessage);
  const parsedDays = parseDaysFromNow(userMessage);
  const parsedFunding = parseFundingStage(userMessage);
  const parsedLocation = parseLocation(userMessage);
  const parsedIndustry = parseIndustry(userMessage);
  const bracketService = extractBracketService(userMessage);

  const companyCount = Math.min(toPositiveInt(extractedParams.company_count ?? parsedCount, 5), 20);
  const daysFromNow = Math.min(toPositiveInt(extractedParams.days_from_now ?? parsedDays, 3), 30);
  const industry = cleanText(extractedParams.industry ?? parsedIndustry, 'fintech');
  const location = cleanText(extractedParams.location ?? parsedLocation, 'New York City');
  const fundingStage = cleanText(extractedParams.funding_stage ?? parsedFunding, 'Series B');
  const specificService = cleanText(extractedParams.specific_service ?? bracketService, 'our service');

  const companyQuery = `${industry} companies in ${location} ${fundingStage} funding last year`;
  const peopleQuery = `Head of Marketing at ${industry} companies in ${location}`;
  const campaignName = `${industry} ${location} ${fundingStage} Intro Outreach`;
  const campaignDescription =
    `Auto-generated outreach campaign for ${industry} companies in ${location} (${fundingStage}). ` +
    `Personalization focus: ${specificService}.`;

  const plan: ExecutionPlan = {
    skillId: 'prospect-companies-and-draft-emails',
    extractedParams: {
      company_count: companyCount,
      days_from_now: daysFromNow,
      industry,
      location,
      funding_stage: fundingStage,
      specific_service: specificService,
    },
    steps: [
      {
        id: 'discover_companies',
        toolCall: {
          name: 'browser_search_and_extract',
          args: {
            task: 'salesnav_search_account',
            query: companyQuery,
            limit: companyCount,
          },
        },
        requiresConfirmation: false,
        description: `Discover ${companyCount} ${industry} companies in ${location} with ${fundingStage} signals`,
      },
      {
        id: 'discover_contacts',
        toolCall: {
          name: 'browser_search_and_extract',
          args: {
            task: 'salesnav_people_search',
            query: peopleQuery,
            limit: companyCount,
          },
        },
        requiresConfirmation: false,
        description: `Find Head of Marketing candidates for discovered companies`,
      },
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
            query: `${industry} ${location} head of marketing`,
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
    ],
  };

  return plan;
};
