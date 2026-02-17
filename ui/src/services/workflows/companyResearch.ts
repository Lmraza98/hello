/**
 * Company Research Workflow
 *
 * When user asks "Tell me about [company]" or "Research [company]",
 * this workflow researches the company and presents findings.
 *
 * Steps:
 *  0. Research the company via Tavily + ICP assessment
 *  1. Present results + offer to add / dig deeper
 */
import type { CompanyVetCardMessage, StepResult, Workflow } from '../../types/chat';
import { researchCompany, deepResearchCompany, formatDeepResearch } from '../research';
import { msgId, statusMsg, textMsg } from './helpers';

export function createCompanyResearchWorkflow(
  companyName: string
): Workflow {
  return {
    id: `wf-research-${Date.now()}`,
    intent: 'company_research',
    currentStepIndex: 0,
    context: {
      companyName,
    },
    status: 'running',
    createdAt: new Date(),
    steps: [
      /* -- Step 0: Research -- */
      {
        id: 'research',
        name: 'Research company',
        type: 'api_call',
        execute: async (ctx): Promise<StepResult> => {
          const emitMessages: ((msgs: any[]) => void) | undefined = ctx._emitMessages;
          emitMessages?.([
            statusMsg(`Researching **${ctx.companyName}**...`, 'loading'),
          ]);

          try {
            const research = await researchCompany(
              { name: ctx.companyName },
              {}
            );

            if (!research || Object.keys(research).length === 0) {
              return {
                success: true,
                messages: [
                  statusMsg(`Couldn't find research data for ${ctx.companyName}.`, 'info'),
                  textMsg('Try a more specific company name, or check the spelling.'),
                ],
                done: true,
              };
            }

            ctx.research = research;

            // Present as a vet card with research
            const vetCard: CompanyVetCardMessage = {
              id: msgId(),
              type: 'company_vet_card',
              sender: 'bot',
              timestamp: new Date(),
              company: {
                name: ctx.companyName,
                industry: '',
                headcount: '',
              },
              research,
              position: { current: 1, total: 1, approved_so_far: 0 },
              actions: ['more_info'],
            };

            return {
              success: true,
              data: { research },
              messages: [vetCard],
              waitForUser: true,
              nextStepIndex: 1,
            };
          } catch (err) {
            return {
              success: false,
              messages: [statusMsg('Research failed. Please try again.', 'error')],
              done: true,
            };
          }
        },
      },

      /* -- Step 1: Handle follow-up -- */
      {
        id: 'follow-up',
        name: 'Handle research follow-up',
        type: 'user_prompt',
        execute: async (ctx, userInput): Promise<StepResult> => {
          if (userInput === 'more_info') {
            try {
              const deep = await deepResearchCompany(
                { name: ctx.companyName },
                {}
              );
              return {
                success: true,
                messages: [textMsg(formatDeepResearch(deep, ctx.companyName))],
                done: true,
              };
            } catch {
              return {
                success: true,
                messages: [statusMsg('Deep research unavailable.', 'info')],
                done: true,
              };
            }
          }
          return {
            success: true,
            messages: [],
            done: true,
          };
        },
      },
    ],
  };
}
