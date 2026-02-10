import type { StepResult, Workflow } from '../../types/chat';
import { textMsg } from './helpers';

export function createHelpWorkflow(): Workflow {
  return {
    id: `wf-${Date.now()}`,
    intent: 'help',
    currentStepIndex: 0,
    context: {},
    status: 'running',
    createdAt: new Date(),
    steps: [
      {
        id: 'show-help',
        name: 'Display help message',
        type: 'format',
        execute: async (): Promise<StepResult> => ({
          success: true,
          messages: [
            textMsg(
              `Here's what I can help with:\n\n` +
                `**Find contacts**\n` +
                `"Find John Smith from Acme Corp"\n` +
                `"Lookup Jane Doe"\n\n` +
                `**Lead generation**\n` +
                `"Find leads in construction in New England"\n` +
                `"Generate prospects for healthcare targeting CTOs"\n\n` +
                `**Company research**\n` +
                `"Tell me about Herc Rentals"\n` +
                `"Research MasTec"\n` +
                `"Is Power Design a good target?"\n\n` +
                `**Send outreach**\n` +
                `"Message Randy Peterson from Zco Corporation"\n` +
                `"Email the CTO at Acme"\n\n` +
                `**Manage campaigns**\n` +
                `"List my campaigns"\n` +
                `"Show pending emails"\n\n` +
                `**Check status**\n` +
                `"What's my status?"\n` +
                `"Show active conversations"\n` +
                `"Check job status"\n\n` +
                `Just type naturally - I will figure out what you need.`
            ),
          ],
          done: true,
        }),
      },
    ],
  };
}
