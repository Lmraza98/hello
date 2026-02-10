import { api } from '../../api';
import type { ContactAction, ContactCardMessage, StepResult, Workflow } from '../../types/chat';
import { buttonsMsg, msgId, statusMsg, textMsg } from './helpers';

export function createContactLookupWorkflow(
  personName: string,
  companyName?: string
): Workflow {
  return {
    id: `wf-${Date.now()}`,
    intent: 'contact_lookup',
    currentStepIndex: 0,
    context: { personName, companyName },
    status: 'running',
    createdAt: new Date(),
    steps: [
      {
        id: 'search-db',
        name: 'Search database for contact',
        type: 'api_call',
        execute: async (ctx): Promise<StepResult> => {
          try {
            const results = await api.searchContacts({
              name: ctx.personName,
              company: ctx.companyName,
            });

            if (results?.length) {
              const contact = results[0];
              // Determine context actions based on contact state
              const actions: ContactAction[] = [];
              if (contact.salesforce_url) {
                actions.push('add_to_campaign', 'send_email', 'view_in_salesforce', 'edit_contact');
              } else {
                actions.push('sync_salesforce', 'add_to_campaign', 'edit_contact');
              }

              const contactCard: ContactCardMessage = {
                id: msgId(),
                type: 'contact_card',
                sender: 'bot',
                timestamp: new Date(),
                contact: {
                  id: contact.id,
                  name: contact.name,
                  title: contact.title || undefined,
                  company: contact.company_name,
                  email: contact.email || undefined,
                  linkedin_url: contact.linkedin_url || undefined,
                  salesforce_url: contact.salesforce_url || undefined,
                },
                actions,
              };

              const messages = [
                textMsg(
                  `Found ${results.length > 1 ? `${results.length} matches` : 'a match'} in your database:`
                ),
                contactCard,
              ];

              if (results.length > 1) {
                messages.push(
                  textMsg(
                    `Showing the best match. ${results.length - 1} other result${results.length - 1 > 1 ? 's' : ''} also matched.`
                  )
                );
              }

              return {
                success: true,
                data: { contact: results[0], allResults: results },
                messages,
                expandSection: 'contacts',
                done: true,
              };
            }

            return {
              success: true,
              data: { found: false },
              messages: [
                textMsg(
                  ctx.companyName
                    ? `I could not find "${ctx.personName}" at "${ctx.companyName}" in your database.`
                    : `I could not find "${ctx.personName}" in your database.`
                ),
                buttonsMsg('Would you like me to search Sales Navigator?', [
                  { label: 'Search Sales Nav', value: 'salesnav_search', variant: 'primary' },
                  { label: 'Cancel', value: 'cancel', variant: 'secondary' },
                ]),
              ],
              waitForUser: true,
              nextStepIndex: 1,
            };
          } catch {
            return {
              success: false,
              messages: [statusMsg('Failed to search contacts. Try again.', 'error')],
              done: true,
            };
          }
        },
      },
      {
        id: 'salesnav-search',
        name: 'Search Sales Navigator',
        type: 'api_call',
        execute: async (ctx, userInput): Promise<StepResult> => {
          if (userInput === 'cancel') {
            return {
              success: true,
              messages: [textMsg('No problem. Let me know if you need anything else.')],
              done: true,
            };
          }

          if (userInput !== 'salesnav_search') {
            return {
              success: true,
              messages: [
                buttonsMsg('Choose an option:', [
                  { label: 'Search Sales Nav', value: 'salesnav_search', variant: 'primary' },
                  { label: 'Cancel', value: 'cancel', variant: 'secondary' },
                ]),
              ],
              waitForUser: true,
              nextStepIndex: 1,
            };
          }

          const openViewerResult: StepResult = {
            success: true,
            messages: [statusMsg('Searching Sales Navigator...', 'info')],
            openBrowserViewer: true,
          };

          try {
            const nameParts = String(ctx.personName).trim().split(/\s+/);
            const result = await api.salesnavSearch({
              first_name: nameParts[0] || '',
              last_name: nameParts.slice(1).join(' '),
              company: ctx.companyName,
            });

            if (result?.profiles?.length) {
              const profile = result.profiles[0];
              const contactCard: ContactCardMessage = {
                id: msgId(),
                type: 'contact_card',
                sender: 'bot',
                timestamp: new Date(),
                contact: {
                  name: profile.name || ctx.personName,
                  title: profile.title,
                  company: profile.company || ctx.companyName || '',
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
                  statusMsg('Found on Sales Navigator', 'success'),
                  contactCard,
                  buttonsMsg('Add this contact to your database?', [
                    { label: 'Add Contact', value: 'add_contact', variant: 'primary' },
                    { label: 'Skip', value: 'cancel', variant: 'secondary' },
                  ]),
                ],
                openBrowserViewer: true,
                closeBrowserViewer: true,
                waitForUser: true,
                nextStepIndex: 2,
              };
            }

            return {
              success: true,
              messages: [
                ...openViewerResult.messages,
                textMsg(
                  `Could not find "${ctx.personName}"${ctx.companyName ? ` at "${ctx.companyName}"` : ''} on Sales Navigator either.`
                ),
              ],
              openBrowserViewer: true,
              done: true,
            };
          } catch (err) {
            const errorMessage =
              err instanceof Error ? err.message : 'Sales Navigator search failed.';
            const isNotImplemented = /not implemented/i.test(errorMessage);
            return {
              success: false,
              messages: [
                ...openViewerResult.messages,
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
        id: 'create-contact',
        name: 'Create contact in database',
        type: 'api_call',
        execute: async (ctx, userInput): Promise<StepResult> => {
          if (userInput === 'cancel') {
            return {
              success: true,
              messages: [textMsg('Got it, skipping.')],
              done: true,
            };
          }

          if (userInput !== 'add_contact') {
            return {
              success: true,
              messages: [
                buttonsMsg('Add this contact to your database?', [
                  { label: 'Add Contact', value: 'add_contact', variant: 'primary' },
                  { label: 'Skip', value: 'cancel', variant: 'secondary' },
                ]),
              ],
              waitForUser: true,
              nextStepIndex: 2,
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
              expandSection: 'contacts',
              done: true,
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
    ],
  };
}
