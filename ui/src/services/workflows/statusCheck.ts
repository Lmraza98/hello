import { api } from '../../api';
import type { StepResult, Workflow } from '../../types/chat';
import { statusMsg, textMsg } from './helpers';

export function createStatusCheckWorkflow(): Workflow {
  return {
    id: `wf-${Date.now()}`,
    intent: 'status_check',
    currentStepIndex: 0,
    context: {},
    status: 'running',
    createdAt: new Date(),
    steps: [
      {
        id: 'fetch-stats',
        name: 'Fetch dashboard stats',
        type: 'api_call',
        execute: async (): Promise<StepResult> => {
          try {
            const [stats, emailStats] = await Promise.all([
              api.getStats(),
              api.getEmailDashboardMetrics(),
            ]);

            const companies = stats?.total_companies ?? 0;
            const contacts = stats?.total_contacts ?? 0;
            const replyRate = emailStats?.reply_rate ?? 0;
            const meetingRate = emailStats?.meeting_booking_rate ?? 0;
            const activeConvos = emailStats?.active_conversations ?? 0;

            const lines = [
              "Here's your current overview:",
              '',
              `- **${companies}** companies, **${contacts}** contacts in the database`,
              `- **${replyRate}%** reply rate, **${meetingRate}%** meeting booking rate`,
              activeConvos > 0
                ? `- **${activeConvos}** active conversation${activeConvos > 1 ? 's' : ''} needing attention`
                : '- No active conversations - all caught up!',
            ];

            return {
              success: true,
              messages: [textMsg(lines.join('\n'))],
              expandSection: 'metrics',
              done: true,
            };
          } catch {
            return {
              success: false,
              messages: [statusMsg('Failed to fetch stats. Try again.', 'error')],
              done: true,
            };
          }
        },
      },
    ],
  };
}
