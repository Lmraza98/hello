import { api } from '../../api';
import type { StepResult, Workflow } from '../../types/chat';
import { msgId, statusMsg, textMsg } from './helpers';

export function createCampaignListWorkflow(): Workflow {
  return {
    id: `wf-${Date.now()}`,
    intent: 'campaign_list',
    currentStepIndex: 0,
    context: {},
    status: 'running',
    createdAt: new Date(),
    steps: [
      {
        id: 'fetch-campaigns',
        name: 'Fetch all campaigns',
        type: 'api_call',
        execute: async (): Promise<StepResult> => {
          try {
            const campaigns = await api.getCampaigns();

            if (!campaigns?.length) {
              return {
                success: true,
                messages: [
                  textMsg(
                    'You do not have any campaigns yet. Would you like to create one from the Email page?'
                  ),
                ],
                done: true,
              };
            }

            return {
              success: true,
              messages: [
                {
                  id: msgId(),
                  type: 'campaign_list',
                  sender: 'bot',
                  timestamp: new Date(),
                  campaigns: campaigns.map((campaign: any) => ({
                    id: campaign.id,
                    name: campaign.name,
                    status: campaign.status,
                    contact_count: campaign.contact_count || campaign.num_emails || 0,
                    reply_rate: campaign.reply_rate,
                  })),
                  prompt: `You have ${campaigns.length} campaign${campaigns.length === 1 ? '' : 's'}:`,
                  selectable: false,
                },
              ],
              done: true,
            };
          } catch {
            return {
              success: false,
              messages: [statusMsg('Failed to load campaigns.', 'error')],
              done: true,
            };
          }
        },
      },
    ],
  };
}
