import { api } from '../../api';
import type { CompanyListMessage, StepResult, Workflow } from '../../types/chat';
import { buttonsMsg, msgId, statusMsg, textMsg } from './helpers';
import { createCompanyVettingWorkflow } from './companyVetting';

/**
 * Lead Generation Workflow
 *
 * Steps:
 *  0. Collect industry (if not extracted from intent)
 *  1. Collect location (if not extracted)
 *  2. Collect target titles (if not extracted)
 *  3. Confirm search parameters
 *  4. Search companies via Sales Nav
 *  5. Present companies + ask to scrape
 *  6. Scrape leads from companies
 */
export function createLeadGenerationWorkflow(
  entities: Record<string, any>
): Workflow {
  return {
    id: `wf-${Date.now()}`,
    intent: 'lead_generation',
    currentStepIndex: 0,
    context: {
      industry: entities.industry || null,
      location: entities.location || null,
      titles: entities.titles?.length ? entities.titles : null,
    },
    status: 'running',
    createdAt: new Date(),
    steps: [
      /* ── Step 0: Collect industry ── */
      {
        id: 'collect-industry',
        name: 'Collect target industry',
        type: 'user_prompt',
        execute: async (ctx, userInput): Promise<StepResult> => {
          // If industry already captured from intent, skip
          if (ctx.industry) {
            return {
              success: true,
              messages: [textMsg(`Targeting **${ctx.industry}** companies.`)],
            };
          }

          // If this is a response to our question
          if (userInput) {
            ctx.industry = userInput.trim();
            return {
              success: true,
              messages: [textMsg(`Got it — targeting **${ctx.industry}** companies.`)],
            };
          }

          // Ask
          return {
            success: true,
            messages: [
              textMsg('What industry should I target?'),
              buttonsMsg('Pick one or type your own:', [
                { label: 'Construction', value: 'Construction', variant: 'secondary' },
                { label: 'Technology', value: 'Technology', variant: 'secondary' },
                { label: 'Healthcare', value: 'Healthcare', variant: 'secondary' },
                { label: 'Manufacturing', value: 'Manufacturing', variant: 'secondary' },
                { label: 'Financial Services', value: 'Financial Services', variant: 'secondary' },
                { label: 'Real Estate', value: 'Real Estate', variant: 'secondary' },
              ]),
            ],
            waitForUser: true,
            nextStepIndex: 0,
          };
        },
      },

      /* ── Step 1: Collect location ── */
      {
        id: 'collect-location',
        name: 'Collect target location',
        type: 'user_prompt',
        execute: async (ctx, userInput): Promise<StepResult> => {
          if (ctx.location) {
            const label = LOCATION_LABELS[ctx.location] || ctx.location;
            return {
              success: true,
              messages: [textMsg(`Location: **${label}**`)],
            };
          }

          if (userInput) {
            // Map button values or free text
            const loc = userInput.trim().toLowerCase();
            ctx.location = LOCATION_LABELS[loc] ? loc : userInput.trim();
            const label = LOCATION_LABELS[ctx.location] || ctx.location;
            return {
              success: true,
              messages: [textMsg(`Location: **${label}**`)],
            };
          }

          return {
            success: true,
            messages: [
              buttonsMsg('Which region?', [
                { label: 'New England', value: 'new_england', variant: 'secondary' },
                { label: 'East Coast', value: 'east_coast', variant: 'secondary' },
                { label: 'West Coast', value: 'west_coast', variant: 'secondary' },
                { label: 'Midwest', value: 'midwest', variant: 'secondary' },
                { label: 'Southeast', value: 'southeast', variant: 'secondary' },
                { label: 'Nationwide', value: 'nationwide', variant: 'secondary' },
              ]),
            ],
            waitForUser: true,
            nextStepIndex: 1,
          };
        },
      },

      /* ── Step 2: Collect titles ── */
      {
        id: 'collect-titles',
        name: 'Collect target titles',
        type: 'user_prompt',
        execute: async (ctx, userInput): Promise<StepResult> => {
          if (ctx.titles?.length) {
            return {
              success: true,
              messages: [textMsg(`Targeting: **${ctx.titles.join(', ')}**`)],
            };
          }

          if (userInput) {
            const titleMap: Record<string, string[]> = {
              c_level: ['CEO', 'CTO', 'CFO', 'COO', 'CMO', 'CIO'],
              vp: ['VP', 'Vice President'],
              director: ['Director'],
              all_dm: ['CEO', 'CTO', 'CFO', 'VP', 'Director', 'Owner', 'President', 'Partner'],
            };
            ctx.titles = titleMap[userInput] || [userInput.trim()];
            return {
              success: true,
              messages: [textMsg(`Targeting: **${ctx.titles.join(', ')}**`)],
            };
          }

          return {
            success: true,
            messages: [
              buttonsMsg('Which decision-makers should I target?', [
                { label: 'C-Level (CEO, CTO, CFO)', value: 'c_level', variant: 'secondary' },
                { label: 'VP Level', value: 'vp', variant: 'secondary' },
                { label: 'Directors', value: 'director', variant: 'secondary' },
                { label: 'All Decision Makers', value: 'all_dm', variant: 'primary' },
              ]),
            ],
            waitForUser: true,
            nextStepIndex: 2,
          };
        },
      },

      /* ── Step 3: Confirm parameters ── */
      {
        id: 'confirm-search',
        name: 'Confirm search parameters',
        type: 'user_prompt',
        execute: async (ctx, userInput): Promise<StepResult> => {
          if (userInput === 'cancel') {
            return {
              success: true,
              messages: [textMsg('Lead generation cancelled.')],
              done: true,
            };
          }

          if (userInput === 'start_search' || userInput === 'confirm') {
            // Proceed to next step
            return { success: true, messages: [] };
          }

          const locationLabel = LOCATION_LABELS[ctx.location] || ctx.location;
          const summary = [
            `**Industry:** ${ctx.industry}`,
            `**Location:** ${locationLabel}`,
            `**Titles:** ${ctx.titles.join(', ')}`,
          ].join('\n');

          return {
            success: true,
            messages: [
              textMsg(`Here's what I'll search for:\n\n${summary}`),
              buttonsMsg('Ready to search?', [
                { label: 'Start Search', value: 'start_search', variant: 'primary' },
                { label: 'Cancel', value: 'cancel', variant: 'secondary' },
              ]),
            ],
            waitForUser: true,
            nextStepIndex: 3,
          };
        },
      },

      /* ── Step 4: Search companies ── */
      {
        id: 'search-companies',
        name: 'Search companies on Sales Navigator',
        type: 'api_call',
        execute: async (ctx): Promise<StepResult> => {
          const locationLabel = LOCATION_LABELS[ctx.location] || ctx.location;
          const query = `${ctx.industry} companies in ${locationLabel}`;

          // Open browser viewer so user can watch the automation
          const openViewer: (() => void) | undefined = ctx._openBrowserViewer;
          openViewer?.();

          try {
            const result = await api.salesnavSearchCompanies({
              query,
              max_companies: 50,
              save_to_db: true,
            });

            if (result.status === 'error') {
              return {
                success: false,
                messages: [statusMsg(result.error || 'Company search failed.', 'error')],
                done: true,
              };
            }

            ctx.companies = result.companies || [];
            ctx.filtersApplied = result.filters_applied;

            if (ctx.companies.length === 0) {
              return {
                success: true,
                messages: [
                  statusMsg('No companies found matching your criteria.', 'info'),
                  textMsg('Try a broader industry or location.'),
                ],
                closeBrowserViewer: true,
                done: true,
              };
            }

            return {
              success: true,
              data: { companies: ctx.companies },
              messages: [
                statusMsg(`Found ${ctx.companies.length} companies`, 'success'),
              ],
              closeBrowserViewer: true,
            };
          } catch (err) {
            const msg = err instanceof Error ? err.message : 'Company search failed.';
            return {
              success: false,
              messages: [statusMsg(msg, 'error')],
              done: true,
            };
          }
        },
      },

      /* ── Step 5: Present companies + ask to scrape or vet ── */
      {
        id: 'present-companies',
        name: 'Show companies and ask to proceed',
        type: 'user_prompt',
        execute: async (ctx, userInput): Promise<StepResult> => {
          if (userInput === 'refine') {
            ctx.industry = null;
            ctx.location = null;
            ctx.titles = null;
            return {
              success: true,
              messages: [textMsg('OK, let\'s refine your search.')],
              nextStepIndex: 0,
            };
          }

          if (userInput === 'start_scrape') {
            return { success: true, messages: [] };
          }

          if (userInput === 'vet_companies') {
            // Transition to interactive vetting workflow
            // Store the vetting workflow in context so the engine can pick it up
            ctx._switchToWorkflow = createCompanyVettingWorkflow(
              ctx.companies,
              {
                industry: ctx.industry,
                location: ctx.location,
                titles: ctx.titles,
              }
            );
            return {
              success: true,
              messages: [],
              done: true, // End this workflow, the engine will start the new one
            };
          }

          if (userInput === 'cancel') {
            return {
              success: true,
              messages: [textMsg('No problem. The companies have already been saved to your database.')],
              done: true,
            };
          }

          // Show ALL companies — the vetting flow will tag existing ones
          // with their DB info and contact counts.
          const companies = ctx.companies as any[];

          // Show the company list
          const displayCompanies = companies.slice(0, 15);
          const companyList: CompanyListMessage = {
            id: msgId(),
            type: 'company_list',
            sender: 'bot',
            timestamp: new Date(),
            companies: displayCompanies.map((c: any) => ({
              company_name: c.company_name || c.name || 'Unknown',
              industry: c.industry,
              employee_count: c.employee_count,
              linkedin_url: c.linkedin_url,
              location: c.location,
            })),
            prompt: companies.length > 15
              ? `Showing 15 of ${companies.length} companies:`
              : `Found ${companies.length} companies:`,
          };

          return {
            success: true,
            messages: [
              companyList,
              buttonsMsg(`What would you like to do with these ${companies.length} companies?`, [
                { label: 'Vet Companies (recommended)', value: 'vet_companies', variant: 'primary' },
                { label: 'Scrape All', value: 'start_scrape', variant: 'secondary' },
                { label: 'Refine Search', value: 'refine', variant: 'secondary' },
                { label: 'Done', value: 'cancel', variant: 'secondary' },
              ]),
            ],
            waitForUser: true,
            nextStepIndex: 5,
          };
        },
      },

      /* ── Step 6: Scrape leads from companies ── */
      {
        id: 'scrape-leads',
        name: 'Scrape leads from companies',
        type: 'api_call',
        execute: async (ctx): Promise<StepResult> => {
          const companies = (ctx.companies as any[]).slice(0, 25); // Cap at 25 for time
          const titleFilter = (ctx.titles as string[]).join(', ');

          // Open browser viewer so user can watch the automation
          const openViewer: (() => void) | undefined = ctx._openBrowserViewer;
          openViewer?.();

          try {
            const result = await api.salesnavScrapeLeads({
              companies: companies.map((c: any) => ({
                name: c.company_name || c.name,
                domain: c.domain,
                linkedin_url: c.linkedin_url,
              })),
              title_filter: titleFilter,
              max_per_company: 10,
            });

            const leads = result.leads || [];
            const saved = result.saved_count ?? leads.length;

            if (leads.length === 0) {
              return {
                success: true,
                messages: [
                  statusMsg('No leads found matching your title criteria.', 'info'),
                  textMsg('The companies are saved. You can try different titles or scrape manually.'),
                ],
                closeBrowserViewer: true,
                done: true,
              };
            }

            return {
              success: true,
              messages: [
                statusMsg(`Scraped ${leads.length} leads from ${companies.length} companies`, 'success'),
                textMsg(`**${saved}** contacts saved to your database. Titles targeted: ${titleFilter}`),
                buttonsMsg('What next?', [
                  { label: 'Add to Campaign', value: 'add_leads_to_campaign', variant: 'primary' },
                  { label: 'View Contacts', value: 'view_contacts', variant: 'secondary' },
                  { label: 'Done', value: 'done', variant: 'secondary' },
                ]),
              ],
              closeBrowserViewer: true,
              waitForUser: true,
              nextStepIndex: 7,
            };
          } catch (err) {
            const msg = err instanceof Error ? err.message : 'Lead scraping failed.';
            return {
              success: false,
              messages: [
                statusMsg(msg, 'error'),
                textMsg('Check that Sales Navigator is authenticated and try again.'),
              ],
              done: true,
            };
          }
        },
      },

      /* ── Step 7: Post-scrape actions ── */
      {
        id: 'post-scrape',
        name: 'Handle post-scrape actions',
        type: 'user_prompt',
        execute: async (_ctx, userInput): Promise<StepResult> => {
          if (userInput === 'view_contacts') {
            return {
              success: true,
              messages: [textMsg('You can see the new contacts on the Contacts page, or click the **Contacts** button below to see today\'s contacts.')],
              expandSection: 'contacts',
              done: true,
            };
          }

          if (userInput === 'add_leads_to_campaign') {
            return {
              success: true,
              messages: [textMsg('To add these leads to a campaign, go to the Email page and select a campaign, then use bulk actions to add contacts. Campaign bulk-add from chat is coming soon.')],
              done: true,
            };
          }

          // "done" or anything else
          return {
            success: true,
            messages: [textMsg('Lead generation complete! Let me know if you need anything else.')],
            done: true,
          };
        },
      },
    ],
  };
}

/* ── Helpers ── */

const LOCATION_LABELS: Record<string, string> = {
  new_england: 'New England',
  east_coast: 'East Coast',
  west_coast: 'West Coast',
  midwest: 'Midwest',
  southwest: 'Southwest',
  southeast: 'Southeast',
  nationwide: 'Nationwide',
};
