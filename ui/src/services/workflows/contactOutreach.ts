import { api } from '../../api';
import type { EmailCampaign } from '../../types/email';
import type {
  ContactCardMessage,
  EmailPreviewMessage,
  StepResult,
  Workflow,
} from '../../types/chat';
import { buttonsMsg, msgId, statusMsg, textMsg } from './helpers';

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
      // ?? Step 0: Resolve contact via backend workflow endpoint ??
      {
        id: 'resolve-contact',
        name: 'Find or fetch contact',
        type: 'api_call',
        execute: async (ctx): Promise<StepResult> => {
          try {
            const result = await api.workflows.resolveContact({
              name: ctx.personName,
              company: ctx.companyName,
            });

            // Found in DB ? proceed directly
            if (result.found_in_db?.length) {
              const contact = result.found_in_db[0];
              return {
                success: true,
                data: { contact },
                messages: [
                  statusMsg('Found contact in your database', 'success'),
                  textMsg(`Great, I found ${ctx.personName}. I will get this outreach ready.`),
                ],
              };
            }

            // Found in SalesNav ? ask user to confirm
            if (result.found_in_salesnav?.length) {
              const profile = result.found_in_salesnav[0] as Record<string, string | undefined>;
              const card: ContactCardMessage = {
                id: msgId(),
                type: 'contact_card',
                sender: 'bot',
                timestamp: new Date(),
                contact: {
                  name: (profile.name as string) || ctx.personName,
                  title: profile.title,
                  company: (profile.company as string) || ctx.companyName,
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
                  statusMsg('Searching Sales Navigator...', 'info'),
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
            }

            // Not found anywhere
            return {
              success: false,
              messages: [
                statusMsg(
                  `I could not find ${ctx.personName} at ${ctx.companyName} in the database or Sales Navigator.`,
                  'error'
                ),
              ],
              done: true,
            };
          } catch (err) {
            const errorMessage = err instanceof Error ? err.message : 'Contact resolution failed.';
            return {
              success: false,
              messages: [statusMsg(errorMessage, 'error')],
              done: true,
            };
          }
        },
      },

      // ?? Step 1: Create contact from SalesNav profile (user confirmed) ??
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

      // ?? Step 2: Select campaign ??
      {
        id: 'select-campaign',
        name: 'Ask user to select campaign',
        type: 'user_prompt',
        execute: async (ctx): Promise<StepResult> => {
          try {
            const campaigns = await api.getEmailCampaigns();
            const activeCampaigns = ((campaigns as CampaignForChat[]) || []).filter(
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

      // ?? Step 3: Enroll + draft via backend workflow endpoint ??
      {
        id: 'enroll-and-draft',
        name: 'Enroll contact and generate email draft',
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
            const result = await api.workflows.enrollAndDraft({
              campaign_id: campaignId,
              contact_id: ctx.contact?.id,
            });

            if (result.error) {
              return {
                success: false,
                messages: [statusMsg(result.error, 'error')],
                done: true,
              };
            }

            const campaigns = ctx.campaigns as CampaignForChat[] | undefined;
            const campaign = campaigns?.find((c) => c.id === campaignId);
            const campaignName = campaign?.name || 'campaign';

            const messages = [
              statusMsg(
                result.already_enrolled
                  ? `Already enrolled in "${campaignName}"`
                  : `Registered to "${campaignName}"`,
                'success'
              ),
            ];

            // Show email draft if available
            if (result.email_draft && !result.email_draft.error) {
              const preview: EmailPreviewMessage = {
                id: msgId(),
                type: 'email_preview',
                sender: 'bot',
                timestamp: new Date(),
                email: {
                  id: result.contact_id || 0,
                  to: ctx.contact?.email || `${ctx.personName} (no email yet)`,
                  subject: result.email_draft.subject || '(No subject)',
                  body: result.email_draft.body || '',
                  campaign_name: campaignName,
                },
                actions: ['approve', 'edit', 'discard'],
              };
              messages.push(
                textMsg(`Here is the draft email for ${ctx.personName}:`),
                preview,
              );

              return {
                success: true,
                data: { campaignId, campaignName, email: result.email_draft },
                messages,
                waitForUser: true,
                nextStepIndex: 4,
              };
            }

            // No draft ? done
            return {
              success: true,
              data: { campaignId, campaignName },
              messages,
              done: true,
            };
          } catch {
            return {
              success: false,
              messages: [statusMsg('Failed to enroll and generate email.', 'error')],
              done: true,
            };
          }
        },
      },

      // ?? Step 4: Handle email approve/edit/discard ??
      {
        id: 'handle-email-action',
        name: 'Handle email approve/edit/discard',
        type: 'user_prompt',
        execute: async (ctx, userInput): Promise<StepResult> => {
          if (userInput === 'discard') {
            await api.discardEmail(ctx.email?.id).catch(() => undefined);
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
              nextStepIndex: 4,
            };
          }

          if (userInput === 'approve') {
            try {
              await api.approveEmail(ctx.email?.id);
              return {
                success: true,
                messages: [
                  statusMsg('Email approved and scheduled!', 'success'),
                  textMsg(
                    `${ctx.personName}'s email will be sent at the next scheduled time.`
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
            nextStepIndex: 4,
          };
        },
      },
    ],
  };
}
