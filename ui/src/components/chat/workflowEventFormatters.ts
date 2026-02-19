import type { StatusMessage } from '../../types/chat';

export type WorkflowChipStatus = 'queued' | 'running' | 'done' | 'failed';

export type WorkflowEventSummary = {
  title: string;
  summary: string;
  status: WorkflowChipStatus;
  keyOutputs: string[];
  errorText?: string;
  details?: string;
  links: Array<{ label: string; url: string }>;
};

const URL_RE = /(https?:\/\/[^\s)]+)/gi;

function safeString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function linesOf(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function dedupe<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function extractLinks(source: string): Array<{ label: string; url: string }> {
  const links = source.match(URL_RE) || [];
  return dedupe(links).map((url, idx) => ({
    label: idx === 0 ? 'Open result' : 'View source',
    url,
  }));
}

function stripUrls(source: string): string {
  return source.replace(URL_RE, '').replace(/\s+/g, ' ').trim();
}

function chipFromStatus(status: StatusMessage['status']): WorkflowChipStatus {
  if (status === 'loading') return 'running';
  if (status === 'success') return 'done';
  if (status === 'error') return 'failed';
  return 'queued';
}

function parseMissingField(content: string, details: string): string | null {
  const combined = `${content}\n${details}`;
  const fromMissingArg = combined.match(/missing required argument\s+"([^"]+)"/i);
  if (fromMissingArg?.[1]) return fromMissingArg[1];
  const fromField = combined.match(/"field"\s*:\s*"([^"]+)"/i);
  if (fromField?.[1]) return fromField[1];
  return null;
}

function buildTitle(content: string, status: WorkflowChipStatus): string {
  const lower = content.toLowerCase();
  if (lower.includes('planned') || lower.includes('plan')) return 'Planning completed';
  if (lower.includes('tool') || lower.includes('workflow')) return 'Tool result';
  if (status === 'failed') return 'Run failed';
  if (status === 'running') return 'Running';
  if (status === 'done') return 'Completed';
  return 'Update';
}

export function formatStatusAsWorkflowEvent(message: StatusMessage): WorkflowEventSummary {
  const details = safeString(message.details);
  const content = safeString(message.content);
  const status = chipFromStatus(message.status);
  const links = extractLinks(`${content}\n${details}`);

  const cleanContent = stripUrls(content);
  const cleanDetails = stripUrls(details);
  const detailLines = linesOf(cleanDetails);
  const keyOutputs = detailLines
    .filter((line) => line.startsWith('- ') || line.startsWith('* ') || /:/.test(line))
    .map((line) => line.replace(/^[-*]\s*/, ''))
    .slice(0, 4);

  let errorText: string | undefined;
  if (status === 'failed') {
    const missingField = parseMissingField(cleanContent, cleanDetails);
    if (/422/.test(`${cleanContent}\n${cleanDetails}`)) {
      errorText = missingField ? `Missing required field: ${missingField}` : 'Validation error (422)';
    } else {
      errorText = cleanContent || 'Execution failed.';
    }
  }

  const summary = cleanContent || (status === 'failed' ? 'An error occurred.' : 'Update available.');
  return {
    title: buildTitle(cleanContent, status),
    summary,
    status,
    keyOutputs,
    ...(errorText ? { errorText } : {}),
    ...(details ? { details } : {}),
    links,
  };
}
