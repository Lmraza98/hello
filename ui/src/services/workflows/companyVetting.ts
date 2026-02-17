/**
 * Interactive Company Vetting Workflow
 *
 * Walks through companies one at a time, presenting research about each
 * and asking the user to approve, skip, or get more info.
 *
 * Steps:
 *  0. Intro
 *  1. Present company (with research)
 *  2. Handle user vetting decision (approve / skip / more_info / skip_rest)
 *  3. Completion (start scraping / review again / cancel)
 */
import { api } from '../../api';
import type {
  CompanyVetCardMessage,
  StepResult,
  Workflow,
} from '../../types/chat';
import { deepResearchCompany, formatDeepResearch } from '../research';
import { buttonsMsg, msgId, statusMsg, textMsg } from './helpers';

export function createCompanyVettingWorkflow(
  companies: any[],
  icpContext: { industry: string; location: string; titles: string[] }
): Workflow {
  return {
    id: `wf-vet-${Date.now()}`,
    intent: 'lead_generation',
    currentStepIndex: 0,
    context: {
      companies,
      icpContext,
      currentIndex: 0,
      approved: [] as any[],
      skipped: [] as any[],
      vetDecisions: [] as Array<{ company_name: string; company_id?: number; approved: boolean; icp_score?: number }>,
      currentCompany: null as any,
      currentResearch: {} as any,
      existingLookup: null as Record<string, any> | null,
      researchCache: null as Record<string, any> | null,
    },
    status: 'running',
    createdAt: new Date(),
    steps: [
      /* -- Step 0: Intro ? batch lookup + research via backend workflow -- */
      {
        id: 'intro',
        name: 'Introduce vetting flow',
        type: 'api_call',
        execute: async (ctx): Promise<StepResult> => {
          const companyNames = ctx.companies.map(
            (c: any) => c.company_name || c.name || ''
          ).filter(Boolean);

          // Single backend call replaces lookupExistingCompanies + per-company research
          try {
            const result = await api.workflows.lookupAndResearch({
              company_names: companyNames,
              icp_context: {
                industry: ctx.icpContext.industry,
                location: ctx.icpContext.location,
              },
            });

            // Build lookup maps from the batch result
            ctx.existingLookup = {};
            ctx.researchCache = {};
            for (const entry of result.companies || []) {
              const key = (entry.name || '').toLowerCase();
              if (entry.existing) {
                ctx.existingLookup[key] = entry.existing;
              }
              ctx.researchCache[key] = entry.research || {};
            }
          } catch {
            ctx.existingLookup = {};
            ctx.researchCache = {};
          }

          const existingCount = Object.keys(ctx.existingLookup || {}).length;
          const newCount = ctx.companies.length - existingCount;

          let intro = `I found **${ctx.companies.length}** ${ctx.icpContext.industry || ''} companies`;
          intro += ctx.icpContext.location ? ` in ${ctx.icpContext.location}` : '';
          intro += '.';
          if (existingCount > 0) {
            intro += ` **${existingCount}** already in your database, **${newCount}** new.`;
          }
          intro += ' Let me walk you through them so we pick the best targets.';

          return {
            success: true,
            messages: [textMsg(intro)],
          };
        },
      },

      /* -- Step 1: Present next company for vetting -- */
      {
        id: 'present-company',
        name: 'Present next company for vetting',
        type: 'api_call',
        execute: async (ctx): Promise<StepResult> => {
          const company = ctx.companies[ctx.currentIndex];
          if (!company) {
            // All companies reviewed
            return {
              success: true,
              messages: [
                textMsg(
                  `Done! You approved **${ctx.approved.length}** of ${ctx.companies.length} companies.`
                ),
                buttonsMsg(
                  ctx.approved.length > 0
                    ? `Ready to scrape leads (${ctx.icpContext.titles?.join(', ') || 'decision makers'}) from these ${ctx.approved.length} companies?`
                    : 'No companies approved. Want to refine your search?',
                  ctx.approved.length > 0
                    ? [
                        { label: 'Start Scraping', value: 'start_scraping', variant: 'primary' },
                        { label: 'Review Again', value: 'review_again', variant: 'secondary' },
                        { label: 'Cancel', value: 'cancel', variant: 'secondary' },
                      ]
                    : [
                        { label: 'Refine Search', value: 'refine_search', variant: 'primary' },
                        { label: 'Cancel', value: 'cancel', variant: 'secondary' },
                      ]
                ),
              ],
              waitForUser: true,
              nextStepIndex: 3,
            };
          }

          const companyName = company.company_name || company.name || 'Unknown';

          // Use pre-fetched data from the batch lookup-and-research call
          const existingInfo = ctx.existingLookup?.[companyName.toLowerCase()] || null;
          const research: Record<string, any> = ctx.researchCache?.[companyName.toLowerCase()] || {};

          ctx.currentCompany = company;
          ctx.currentResearch = research;

          // Build actions ? existing companies get a re-vet option instead of plain approve
          const actions: CompanyVetCardMessage['actions'] = existingInfo
            ? ['approve', 'skip', 'more_info', 'skip_rest']
            : ['approve', 'skip', 'more_info', 'skip_rest'];

          const vetCard: CompanyVetCardMessage = {
            id: msgId(),
            type: 'company_vet_card',
            sender: 'bot',
            timestamp: new Date(),
            company: {
              name: companyName,
              industry: company.industry || ctx.icpContext.industry || '',
              headcount: company.employee_count || company.headcount || '',
              hq_location: company.location,
              website: company.website,
              linkedin_url: company.linkedin_url,
              description: company.description,
            },
            research: Object.keys(research).length > 0 ? research : undefined,
            existing: existingInfo
              ? {
                  id: existingInfo.id,
                  contact_count: existingInfo.contact_count,
                  vetted_at: existingInfo.vetted_at,
                  status: existingInfo.status,
                }
              : undefined,
            position: {
              current: ctx.currentIndex + 1,
              total: ctx.companies.length,
              approved_so_far: ctx.approved.length,
            },
            actions,
          };

          return {
            success: true,
            data: { currentCompany: company, currentResearch: research },
            messages: [vetCard],
            waitForUser: true,
            nextStepIndex: 2, // Route user's button click to step 2 (handle-vet-decision)
          };
        },
      },

      /* -- Step 2: Handle vetting decision -- */
      {
        id: 'handle-vet-decision',
        name: 'Process user vetting decision',
        type: 'user_prompt',
        execute: async (ctx, userInput): Promise<StepResult> => {
          const companyName = ctx.currentCompany?.company_name || ctx.currentCompany?.name || 'this company';

          switch (userInput) {
            case 'approve': {
              ctx.approved.push(ctx.currentCompany);
              ctx.currentIndex++;

              // Collect vetting decision for batch submission later
              const existingInfo = ctx.existingLookup?.[companyName.toLowerCase()];
              const icpScore = ctx.currentResearch?.icp_fit_score;
              ctx.vetDecisions.push({
                company_name: companyName,
                company_id: existingInfo?.id,
                approved: true,
                icp_score: icpScore,
              });

              return {
                success: true,
                data: { approved: ctx.approved, currentIndex: ctx.currentIndex },
                messages: [
                  statusMsg(
                    `Added ${companyName} (${ctx.approved.length} approved)`,
                    'success'
                  ),
                ],
                nextStepIndex: 1,
              };
            }

            case 'skip':
              ctx.skipped.push(ctx.currentCompany);
              ctx.currentIndex++;
              return {
                success: true,
                data: { skipped: ctx.skipped, currentIndex: ctx.currentIndex },
                messages: [
                  statusMsg(`Skipped ${companyName}`, 'info'),
                ],
                nextStepIndex: 1,
              };

            case 'more_info':
              try {
                const deepResearch = await deepResearchCompany(
                  {
                    name: companyName,
                    industry: ctx.currentCompany?.industry || ctx.icpContext?.industry,
                  },
                  ctx.icpContext
                );
                return {
                  success: true,
                  data: { currentResearch: { ...ctx.currentResearch, ...deepResearch } },
                  messages: [
                    textMsg(formatDeepResearch(deepResearch, companyName)),
                    buttonsMsg(`Add ${companyName} to your list?`, [
                      { label: 'Add', value: 'approve', variant: 'primary' },
                      { label: 'Skip', value: 'skip', variant: 'secondary' },
                    ]),
                  ],
                  waitForUser: true,
                  nextStepIndex: 2,
                };
              } catch {
                return {
                  success: true,
                  messages: [
                    statusMsg('Deep research unavailable right now.', 'info'),
                    buttonsMsg(`Add ${companyName}?`, [
                      { label: 'Add', value: 'approve', variant: 'primary' },
                      { label: 'Skip', value: 'skip', variant: 'secondary' },
                    ]),
                  ],
                  waitForUser: true,
                  nextStepIndex: 2,
                };
              }

            case 'skip_rest':
              return {
                success: true,
                messages: [
                  textMsg(
                    `Stopped vetting. **${ctx.approved.length}** companies approved ` +
                    `out of ${ctx.companies.length}.`
                  ),
                  buttonsMsg(
                    ctx.approved.length > 0
                      ? 'Ready to scrape leads from approved companies?'
                      : 'No companies approved.',
                    ctx.approved.length > 0
                      ? [
                          { label: 'Start Scraping', value: 'start_scraping', variant: 'primary' },
                          { label: 'Cancel', value: 'cancel', variant: 'secondary' },
                        ]
                      : [
                          { label: 'Cancel', value: 'cancel', variant: 'secondary' },
                        ]
                  ),
                ],
                waitForUser: true,
                nextStepIndex: 3,
              };

            default:
              return {
                success: false,
                messages: [textMsg("I didn't catch that. Use the buttons to approve or skip.")],
                waitForUser: true,
                nextStepIndex: 2,
              };
          }
        },
      },

      /* -- Step 3: Completion handler -- */
      {
        id: 'completion',
        name: 'Handle post-vetting action',
        type: 'user_prompt',
        execute: async (ctx, userInput): Promise<StepResult> => {
          switch (userInput) {
            case 'start_scraping': {
              // Submit batch vetting decisions first
              if (ctx.vetDecisions?.length > 0) {
                try {
                  await api.workflows.vetBatch({ decisions: ctx.vetDecisions });
                } catch { /* best-effort */ }
              }

              const maxPerCompany = ctx.leadsPerCompany || 10;
              const companyNames = ctx.approved.map((c: any) => c.company_name || c.name).filter(Boolean);

              const emitMessages: ((msgs: any[]) => void) | undefined = ctx._emitMessages;
              emitMessages?.([
                statusMsg(
                  `Scraping started for ${ctx.approved.length} companies targeting ${ctx.icpContext.titles?.join(', ') || 'decision makers'}. This will run in the background.`,
                  'success'
                ),
              ]);

              const taskId = `task-scrape-${Date.now()}`;
              ctx._backgroundTask = {
                id: taskId,
                type: 'lead_scraping',
                label: `Scraping leads from ${ctx.approved.length} companies`,
                status: 'running',
                progress: { current: 0, total: ctx.approved.length },
                details: [],
                startedAt: new Date(),
              };

              try {
                const result = await api.workflows.scrapeLeadsBatch({
                  company_names: companyNames,
                  title_filter: ctx.icpContext.titles?.join(', ') || 'Decision Maker',
                  max_per_company: maxPerCompany,
                });

                return {
                  success: true,
                  messages: [
                    statusMsg(
                      `Scraped ${result.leads?.length || 0} leads from ${result.companies_processed} companies`,
                      'success'
                    ),
                    textMsg(
                      `**${result.saved_count ?? 0}** contacts saved. Check the **Contacts** section for details.`
                    ),
                  ],
                  expandSection: 'contacts',
                  openBrowserViewer: true,
                  done: true,
                };
              } catch {
                return {
                  success: false,
                  messages: [statusMsg('Failed to start scraping.', 'error')],
                  done: true,
                };
              }
            }

            case 'review_again':
              ctx.currentIndex = 0;
              ctx.approved = [];
              ctx.skipped = [];
              return {
                success: true,
                data: { currentIndex: 0, approved: [], skipped: [] },
                messages: [textMsg("Let's go through them again.")],
                nextStepIndex: 1,
              };

            case 'refine_search':
              return {
                success: true,
                messages: [textMsg('What would you like to change? You can adjust the industry, location, company size, or target titles.')],
                done: true,
              };

            case 'cancel':
              return {
                success: true,
                messages: [textMsg('No problem. Let me know when you want to search again.')],
                done: true,
              };

            default:
              return {
                success: false,
                messages: [textMsg('Use the buttons above to proceed.')],
                waitForUser: true,
                nextStepIndex: 3,
              };
          }
        },
      },
    ],
  };
}
