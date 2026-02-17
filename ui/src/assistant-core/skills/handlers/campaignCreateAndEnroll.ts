/**
 * Deterministic handler for the "campaign-create-and-enroll" skill.
 *
 * Given extracted params (industry keyword, optional campaign name), produces
 * an execution plan with exactly two steps:
 *   1. create_campaign
 *   2. enroll_contacts_by_filter (using query, NOT contact_id arrays)
 */

import type { ExecutionPlan, SkillHandler } from '../../domain/types';

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export const campaignCreateAndEnrollHandler: SkillHandler = (params) => {
  const { extractedParams } = params;

  const industry = String(extractedParams.industry || '').trim();
  if (!industry) {
    throw new Error('Industry keyword is required for campaign-create-and-enroll skill.');
  }

  const campaignName = extractedParams.campaign_name
    ? String(extractedParams.campaign_name).trim()
    : `${capitalize(industry)} Outreach`;

  const description = `Email campaign targeting ${industry}`;
  const numEmails = typeof extractedParams.num_emails === 'number'
    ? extractedParams.num_emails
    : undefined;
  const daysBetween = typeof extractedParams.days_between_emails === 'number'
    ? extractedParams.days_between_emails
    : undefined;

  const createArgs: Record<string, unknown> = {
    name: campaignName,
    description,
  };
  if (numEmails != null) createArgs.num_emails = numEmails;
  if (daysBetween != null) createArgs.days_between_emails = daysBetween;

  const plan: ExecutionPlan = {
    skillId: 'campaign-create-and-enroll',
    extractedParams: { industry, campaignName },
    steps: [
      {
        id: 'create',
        toolCall: { name: 'create_campaign', args: createArgs },
        requiresConfirmation: true,
        description: `Create campaign "${campaignName}"`,
      },
      {
        id: 'enroll',
        toolCall: {
          name: 'enroll_contacts_by_filter',
          args: {
            campaign_id: '$prev.create.id',  // resolved at execution time
            query: industry,
          },
        },
        requiresConfirmation: true,
        description: `Enroll all ${industry}-related contacts`,
      },
    ],
  };

  return plan;
};
