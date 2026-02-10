/**
 * Check Job Workflow
 *
 * When user asks "check contacts job" or "how's the scraping going?",
 * this shows the status of background tasks.
 */
import type { BackgroundTask, StepResult, Workflow } from '../../types/chat';
import { statusMsg, textMsg } from './helpers';

export function createCheckJobWorkflow(
  backgroundTasks: BackgroundTask[]
): Workflow {
  return {
    id: `wf-checkjob-${Date.now()}`,
    intent: 'check_job',
    currentStepIndex: 0,
    context: { backgroundTasks },
    status: 'running',
    createdAt: new Date(),
    steps: [
      {
        id: 'show-status',
        name: 'Show background task status',
        type: 'format',
        execute: async (ctx): Promise<StepResult> => {
          const tasks = ctx.backgroundTasks as BackgroundTask[];

          if (!tasks || tasks.length === 0) {
            return {
              success: true,
              messages: [textMsg('No background tasks running right now.')],
              done: true,
            };
          }

          const lines: string[] = [];
          for (const task of tasks) {
            const progress = task.progress
              ? ` (${task.progress.current}/${task.progress.total})`
              : '';
            const statusIcon =
              task.status === 'running' ? '🔄' :
              task.status === 'completed' ? '✅' :
              task.status === 'failed' ? '❌' : '⏳';

            lines.push(`${statusIcon} **${task.label}**${progress}`);
            if (task.status === 'running') {
              lines.push(`   Status: ${task.status}`);
            }
            if (task.details && task.details.length > 0) {
              const recent = task.details.slice(-3);
              for (const detail of recent) {
                lines.push(`   - ${detail}`);
              }
            }
          }

          const running = tasks.filter((t) => t.status === 'running');
          const completed = tasks.filter((t) => t.status === 'completed');

          const summary =
            running.length > 0
              ? `**${running.length}** task(s) running, **${completed.length}** completed.`
              : `All tasks completed.`;

          return {
            success: true,
            messages: [
              textMsg(lines.join('\n')),
              statusMsg(summary, running.length > 0 ? 'loading' : 'success'),
            ],
            done: true,
          };
        },
      },
    ],
  };
}
