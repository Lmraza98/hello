import { api, type EmailCampaign } from '../../api';
import type {
  ContactCardMessage,
  EmailPreviewMessage,
  StepResult,
  Workflow,
} from '../../types/chat';
import { buttonsMsg, msgId, statusMsg, textMsg } from './helpers';

// (ContactAction import not needed here — we use string literals which satisfy the type)

type CampaignForChat = EmailCampaign & {
  contact_count?: number;
  reply_rate?: number;
};

export function createContactOutreachWorkflow(
  personName: string,
  companyName: string
): Workflow {
  return {
    id: `wf-${Date.now()}`,
    intent: 'contact_outreach',
    currentStepIndex: 0,
    context: { personName, companyName },
    status: 'running',
    createdAt: new Date(),
    steps: [
      {
        id: 'resolve-contact',
        name: 'Find or fetch contact',
        type: 'api_call',
        execute: async (ctx): Promise<StepResult> => {
          try {
            const existing = await api.searchContacts({
              name: ctx.personName,
              company: ctx.companyName,
            });

            if (existing?.length) {
              return {
                success: true,
                data: { contact: existing[0] },
                messages: [
                  statusMsg('Found contact in your database', 'success'),
                  textMsg(`Great, I found ${ctx.personName}. I will get this outreach ready.`),
                ],
              };
            }
          } catch {
            // Keep going and try Sales Navigator fallback.
          }

          try {
            const openViewerResult: StepResult = {
              success: true,
              messages: [statusMsg('Searching Sales Navigator...', 'info')],
              openBrowserViewer: true,
            };

            const nameParts = String(ctx.personName).trim().split(/\s+/);
            const result = await api.salesnavSearch({
              first_name: nameParts[0] || '',
              last_name: nameParts.slice(1).join(' '),
              company: ctx.companyName,
            });

            if (!result?.profiles?.length) {
              return {
                success: false,
                messages: [
                  ...openViewerResult.messages,
                  statusMsg(
                    `I could not find ${ctx.personName} at ${ctx.companyName} in the database or Sales Navigator.`,
                    'error'
                  ),
                ],
                openBrowserViewer: true,
                done: true,
              };
            }

            const profile = result.profiles[0];
            const card: ContactCardMessage = {
              id: msgId(),
              type: 'contact_card',
              sender: 'bot',
              timestamp: new Date(),
              contact: {
                name: profile.name || ctx.personName,
                title: profile.title,
                company: profile.company || ctx.companyName,
                linkedin_url: profile.linkedin_url,
                location: profile.location,
                source: 'Sales Navigator',
              },
              actions: ['add_to_database'],
            };

            return {
              success: true,
              data: { salesnavProfile: profile },
              messages: [
                ...openViewerResult.messages,
                textMsg(`${ctx.personName} is not in your DB yet. I found this Sales Navigator profile:`),
                card,
                buttonsMsg('Add this contact so I can continue outreach?', [
                  { label: 'Add Contact', value: 'add_contact', variant: 'primary' },
                  { label: 'Cancel', value: 'cancel', variant: 'secondary' },
                ]),
              ],
              openBrowserViewer: true,
              closeBrowserViewer: true,
              waitForUser: true,
              nextStepIndex: 1,
            };
          } catch (err) {
            const errorMessage =
              err instanceof Error ? err.message : 'Sales Navigator search failed.';
            const isNotImplemented = /not implemented/i.test(errorMessage);
            return {
              success: false,
              messages: [
                statusMsg('Searching Sales Navigator...', 'info'),
                statusMsg(
                  isNotImplemented
                    ? 'Sales Navigator person search is not wired yet in this build.'
                    : `Sales Navigator search failed: ${errorMessage}`,
                  'error'
                ),
              ],
              openBrowserViewer: true,
              done: true,
            };
          }
        },
      },
      {
        id: 'create-contact-if-needed',
        name: 'Create contact from Sales Navigator profile',
        type: 'api_call',
        execute: async (ctx, userInput): Promise<StepResult> => {
          if (ctx.contact) {
            return { success: true, messages: [] };
          }

          if (userInput === 'cancel') {
            return {
              success: true,
              messages: [textMsg('No problem. I stopped this outreach flow.')],
              done: true,
            };
          }

          if (userInput !== 'add_contact') {
            return {
              success: true,
              messages: [
                buttonsMsg('Should I add this contact first?', [
                  { label: 'Add Contact', value: 'add_contact', variant: 'primary' },
                  { label: 'Cancel', value: 'cancel', variant: 'secondary' },
                ]),
              ],
              waitForUser: true,
              nextStepIndex: 1,
            };
          }

          try {
            const nameParts = String(ctx.personName).trim().split(/\s+/);
            const contact = await api.createContact({
              name: ctx.salesnavProfile?.name || ctx.personName,
              company_name: ctx.salesnavProfile?.company || ctx.companyName,
              title: ctx.salesnavProfile?.title,
              email: ctx.salesnavProfile?.email,
              linkedin_url: ctx.salesnavProfile?.linkedin_url,
              location: ctx.salesnavProfile?.location,
              first_name: ctx.salesnavProfile?.first_name || nameParts[0],
              last_name: ctx.salesnavProfile?.last_name || nameParts.slice(1).join(' '),
            });

            return {
              success: true,
              data: { contact },
              messages: [
                statusMsg('Contact created in database', 'success'),
                {
                  id: msgId(),
                  type: 'sf_url_prompt',
                  sender: 'bot',
                  timestamp: new Date(),
                  contact: { id: contact.id, name: contact.name },
                },
              ],
            };
          } catch {
            return {
              success: false,
              messages: [statusMsg('Failed to create contact.', 'error')],
              done: true,
            };
          }
        },
      },
      {
        id: 'select-campaign',
        name: 'Ask user to select campaign',
        type: 'user_prompt',
        execute: async (ctx): Promise<StepResult> => {
          try {
            const campaigns = await api.getCampaigns();
            const activeCampaigns = (campaigns as CampaignForChat[] | undefined || []).filter(
              (campaign) => campaign.status === 'active' || campaign.status === 'draft'
            );

            if (!activeCampaigns.length) {
              return {
                success: true,
                data: { campaigns: [] },
                messages: [
                  textMsg("You do not have any active campaigns yet."),
                  buttonsMsg('Would you like to create one?', [
                    { label: 'Create Campaign', value: 'create_campaign', variant: 'primary' },
                    { label: 'Skip', value: 'cancel', variant: 'secondary' },
                  ]),
                ],
                waitForUser: true,
                nextStepIndex: 3,
              };
            }

            return {
              success: true,
              data: { campaigns: activeCampaigns },
              messages: [
                {
                  id: msgId(),
                  type: 'campaign_list',
                  sender: 'bot',
                  timestamp: new Date(),
                  campaigns: activeCampaigns.map((campaign) => ({
                    id: campaign.id,
                    name: campaign.name,
                    status: campaign.status,
                    contact_count: campaign.contact_count || campaign.num_emails || 0,
                    reply_rate: campaign.reply_rate,
                  })),
                  prompt: `Which campaign should I add ${ctx.personName} to?`,
                  selectable: true,
                },
              ],
              waitForUser: true,
              nextStepIndex: 3,
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
      {
        id: 'register-to-campaign',
        name: 'Register contact to selected campaign',
        type: 'api_call',
        execute: async (ctx, userInput): Promise<StepResult> => {
          if (userInput === 'cancel') {
            return {
              success: true,
              messages: [textMsg(`${ctx.personName} is saved, but not registered to a campaign.`)],
              done: true,
            };
          }

          if (userInput === 'create_campaign') {
            return {
              success: true,
              messages: [
                textMsg(
                  'Campaign creation from chat is coming soon. Please create one on the Email page, then run this command again.'
                ),
              ],
              done: true,
            };
          }

          const campaignId = Number.parseInt(userInput || '', 10);
          if (Number.isNaN(campaignId)) {
            return {
              success: true,
              messages: [textMsg('I did not understand that selection. Please choose a campaign.')],
              waitForUser: true,
              nextStepIndex: 3,
            };
          }

          try {
            await api.registerToCampaign(campaignId, ctx.contact.id);
            const campaigns = ctx.campaigns as CampaignForChat[] | undefined;
            const campaign = campaigns?.find((c) => c.id === campaignId);

            return {
              success: true,
              data: { campaignId, campaignName: campaign?.name || 'Campaign' },
              messages: [statusMsg(`Registered to "${campaign?.name || 'campaign'}"`, 'success')],
            };
          } catch {
            return {
              success: false,
              messages: [statusMsg('Failed to register to campaign.', 'error')],
              done: true,
            };
          }
        },
      },
      {
        id: 'generate-email',
        name: 'Generate email draft',
        type: 'api_call',
        execute: async (ctx): Promise<StepResult> => {
          try {
            const email = await api.generateEmail(ctx.contact.id, ctx.campaignId);
            const preview: EmailPreviewMessage = {
              id: msgId(),
              type: 'email_preview',
              sender: 'bot',
              timestamp: new Date(),
              email: {
                id: email.id,
                to: ctx.contact.email || `${ctx.personName} (no email yet)`,
                subject: email.subject || email.rendered_subject || '(No subject)',
                body: email.body || email.rendered_body || '',
                campaign_name: ctx.campaignName,
                scheduled_time: email.scheduled_send_time || undefined,
              },
              actions: ['approve', 'edit', 'discard'],
            };

            return {
              success: true,
              data: { email },
              messages: [textMsg(`Here is the draft email for ${ctx.personName}:`), preview],
              waitForUser: true,
              nextStepIndex: 5,
            };
          } catch {
            return {
              success: false,
              messages: [statusMsg('Failed to generate email.', 'error')],
              done: true,
            };
          }
        },
      },
      {
        id: 'handle-email-action',
        name: 'Handle email approve/edit/discard',
        type: 'user_prompt',
        execute: async (ctx, userInput): Promise<StepResult> => {
          if (userInput === 'discard') {
            await api.discardEmail(ctx.email.id).catch(() => undefined);
            return {
              success: true,
              messages: [textMsg('Email discarded.')],
              done: true,
            };
          }

          if (userInput === 'edit') {
            return {
              success: true,
              messages: [
                textMsg('In-chat email editing is coming soon. You can edit from the Email page for now.'),
                buttonsMsg('What would you like to do?', [
                  { label: 'Approve as-is', value: 'approve', variant: 'primary' },
                  { label: 'Discard', value: 'discard', variant: 'danger' },
                ]),
              ],
              waitForUser: true,
              nextStepIndex: 5,
            };
          }

          if (userInput === 'approve') {
            try {
              await api.approveEmail(ctx.email.id);
              return {
                success: true,
                messages: [
                  statusMsg('Email approved and scheduled!', 'success'),
                  textMsg(
                    `${ctx.personName}'s email will be sent ${
                      ctx.email.scheduled_send_time
                        ? `at ${new Date(ctx.email.scheduled_send_time).toLocaleString()}`
                        : 'at the next scheduled time'
                    }.`
                  ),
                ],
                expandSection: 'scheduled',
                done: true,
              };
            } catch {
              return {
                success: false,
                messages: [statusMsg('Failed to approve email.', 'error')],
                done: true,
              };
            }
          }

          return {
            success: true,
            messages: [textMsg('I did not understand that. Choose approve, edit, or discard.')],
            waitForUser: true,
            nextStepIndex: 5,
          };
        },
      },
    ],
  };
}
