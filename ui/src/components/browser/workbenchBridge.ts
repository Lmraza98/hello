export type BrowserWorkflowAction = 'observe' | 'annotate' | 'validate' | 'synthesize';

export interface BrowserWorkflowCommand {
  action: BrowserWorkflowAction;
  source: 'chat' | 'system' | 'sidebar';
  hrefPattern?: string;
  preferFullscreen?: boolean;
}

export const BROWSER_WORKFLOW_COMMAND_EVENT = 'hello:browser-workflow-command';

export function dispatchBrowserWorkflowCommand(command: BrowserWorkflowCommand) {
  window.dispatchEvent(new CustomEvent<BrowserWorkflowCommand>(BROWSER_WORKFLOW_COMMAND_EVENT, { detail: command }));
}

export function isBrowserWorkflowCommand(value: unknown): value is BrowserWorkflowCommand {
  if (!value || typeof value !== 'object') return false;
  const rec = value as Record<string, unknown>;
  const action = rec.action;
  const source = rec.source;
  if (action !== 'observe' && action !== 'annotate' && action !== 'validate' && action !== 'synthesize') return false;
  if (source !== 'chat' && source !== 'system' && source !== 'sidebar') return false;
  if (rec.hrefPattern != null && typeof rec.hrefPattern !== 'string') return false;
  if (rec.preferFullscreen != null && typeof rec.preferFullscreen !== 'boolean') return false;
  return true;
}
