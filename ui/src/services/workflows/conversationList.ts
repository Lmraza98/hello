import type {
  ConversationCardMessage,
  StepResult,
  Workflow,
} from '../../types/chat';
import { msgId, textMsg } from './helpers';

export function createConversationListWorkflow(recentReplies: any[]): Workflow {
  return {
    id: `wf-${Date.now()}`,
    intent: 'conversation_list',
    currentStepIndex: 0,
    context: { recentReplies },
    status: 'running',
    createdAt: new Date(),
    steps: [
      {
        id: 'format-conversations',
        name: 'Format active conversations',
        type: 'format',
        execute: async (ctx): Promise<StepResult> => {
          const replies = ctx.recentReplies || [];

          if (!replies.length) {
            return {
              success: true,
              messages: [textMsg('No active conversations right now. All caught up!')],
              expandSection: 'conversations',
              done: true,
            };
          }

          const cards: ConversationCardMessage[] = replies
            .slice(0, 5)
            .map((reply: any) => ({
              id: msgId(),
              type: 'conversation_card',
              sender: 'bot',
              timestamp: new Date(),
              conversation: {
                reply_id: reply.reply_id,
                contact_name: reply.contact_name,
                company_name: reply.company_name,
                snippet: reply.snippet || reply.body_preview || '',
                received_at: reply.received_at,
                sentiment: reply.sentiment,
              },
              actions: ['view', 'mark_done'],
            }));

          return {
            success: true,
            messages: [
              textMsg(
                `You have ${replies.length} active conversation${replies.length === 1 ? '' : 's'}:`
              ),
              ...cards,
            ],
            expandSection: 'conversations',
            done: true,
          };
        },
      },
    ],
  };
}
