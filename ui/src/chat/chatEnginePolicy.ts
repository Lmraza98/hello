import type { ChatCompletionMessageParam, PlannedToolCall } from './chatEngineTypes';
import type { ChatAction } from './actions';

export const CONFIRMED_READ_ONLY_FASTLANE_TOOLS = new Set<string>([
  'resolve_entity',
  'hybrid_search',
  'search_contacts',
  'get_contact',
  'search_companies',
  'list_filter_values',
  'get_pending_companies_count',
  'list_campaigns',
  'get_campaign',
  'get_campaign_contacts',
  'get_campaign_stats',
  'get_email_dashboard_metrics',
  'get_review_queue',
  'get_scheduled_emails',
  'get_active_conversations',
  'get_conversation_thread',
  'preview_email',
  'get_pipeline_status',
  'get_salesforce_auth_status',
  'get_dashboard_stats',
  // Browser read-only tools — extraction/observation, no mutations
  'browser_health',
  'browser_tasks_status',
  'browser_tabs',
  'browser_snapshot',
  'browser_screenshot',
  'browser_find_ref',
  'browser_wait',
  'browser_search_and_extract',
  'google_search_browser',
  'browser_list_sub_items',
  'browser_skill_list',
  'browser_skill_match',
  'browser_skill_get',
  // Workflow read-only tools
  'workflow_resolve_contact',
  'workflow_prospect',
  'workflow_lookup_and_research',
]);

export function shouldRequireToolConfirmation(
  calls: PlannedToolCall[],
  requireToolConfirmation?: boolean
): boolean {
  if (requireToolConfirmation === false) return false;
  const hasWriteCall = calls.some((call) => !CONFIRMED_READ_ONLY_FASTLANE_TOOLS.has(call.name));
  if (!hasWriteCall) return false;
  return requireToolConfirmation ?? true;
}

export function hasOpenBrowserSessionSignal(history: ChatCompletionMessageParam[]): boolean {
  const tail = history.slice(-6);
  return tail.some((m) => {
    if (m.role !== 'assistant' || typeof m.content !== 'string') return false;
    const lower = m.content.toLowerCase();
    return (
      lower.includes('browser session is still open') ||
      lower.includes('kept the session open') ||
      lower.includes('sales navigator navigation')
    );
  });
}

export function isBrowserFollowUpIntent(message: string): boolean {
  const lower = message.toLowerCase();

  // If user mentions a specific site/tool by name, this is a NEW browser request,
  // not a follow-up to whatever tab is currently open.
  if (/\b(sales\s*navigator|salesnav|linkedin|youtube|twitter|reddit|google)\b/.test(lower) &&
      /\b(search|find|look|go)\b/.test(lower)) {
    return false;
  }

  // Obvious in-page follow-up actions (no site context switch)
  if (/^\s*(click|type|enter|press|submit|scroll|next|back)\b/.test(lower)) return true;

  const strong = [
    'click',
    'open it',
    'who works there',
    'employees',
    'people at',
    'list contacts',
    'that company',
    'this company',
    'collect information',
    'dig into this',
    'on the page',
    'from the page',
    'on this page',
    'already open',
  ];
  return strong.some((x) => lower.includes(x));
}

export function isLikelyInternalUiIntent(message: string): boolean {
  const lower = message.toLowerCase();
  if (!lower.trim()) return false;
  if (/(https?:\/\/|www\.|linkedin|sales navigator|salesnav|youtube|google|reddit|twitter)/i.test(lower)) {
    return false;
  }
  const uiHints = [
    'on the page',
    'show me',
    'open',
    'go to',
    'navigate',
    'campaign',
    'email view',
    'contacts page',
    'companies page',
    'dashboard',
    'tasks',
    'admin',
    'bi',
  ];
  return uiHints.some((hint) => lower.includes(hint));
}

function formatToolCallArgs(args: Record<string, unknown>): string {
  return Object.entries(args || {})
    .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
    .join(', ');
}

function summarizeCompoundSpec(spec: unknown): string {
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) return 'compound workflow spec';
  const obj = spec as Record<string, unknown>;
  const name = typeof obj.name === 'string' && obj.name.trim() ? obj.name.trim() : 'Compound workflow';
  const description = typeof obj.description === 'string' ? obj.description.trim() : '';
  const constraints = (obj.constraints && typeof obj.constraints === 'object' && !Array.isArray(obj.constraints))
    ? (obj.constraints as Record<string, unknown>)
    : {};
  const phases = Array.isArray(obj.phases) ? obj.phases : [];
  const phaseLines = phases.slice(0, 8).map((phase, idx) => {
    if (!phase || typeof phase !== 'object' || Array.isArray(phase)) return `${idx + 1}. phase_${idx + 1}`;
    const p = phase as Record<string, unknown>;
    const id = typeof p.id === 'string' && p.id.trim() ? p.id.trim() : `phase_${idx + 1}`;
    const pname = typeof p.name === 'string' && p.name.trim() ? p.name.trim() : id;
    const ptype = typeof p.type === 'string' ? p.type : 'phase';
    return `${idx + 1}. ${pname} (${ptype}, id=${id})`;
  });
  const runtime = constraints.max_runtime_minutes != null ? `max_runtime_minutes=${constraints.max_runtime_minutes}` : '';
  const results = constraints.max_results != null ? `max_results=${constraints.max_results}` : '';
  const concurrency = constraints.concurrency != null ? `concurrency=${constraints.concurrency}` : '';
  const budget = [runtime, results, concurrency].filter(Boolean).join(', ');
  return [
    `name: ${name}`,
    description ? `description: ${description}` : '',
    budget ? `constraints: ${budget}` : '',
    `phases:\n${phaseLines.join('\n') || 'none'}`,
  ].filter(Boolean).join('\n');
}

export function buildPlanSummary(calls: PlannedToolCall[]): string {
  return buildMixedPlanSummary([], calls);
}

export function buildMixedPlanSummary(uiActions: ChatAction[], calls: PlannedToolCall[]): string {
  const parts: string[] = [];
  if (uiActions.length > 0) {
    parts.push(
      'Planned UI actions:\n' +
        uiActions
          .map((action, idx) => `${idx + 1}. ${JSON.stringify(action)}`)
          .join('\n')
    );
  }
  if (calls.length > 0) {
    parts.push(
      'Planned tool calls:\n' +
        calls
          .map((call, idx) => {
            if (call.name === 'compound_workflow_run') {
              const spec = (call.args || {}).spec;
              return `${idx + 1}. compound_workflow_run\n${summarizeCompoundSpec(spec)}`;
            }
            return `${idx + 1}. ${call.name}(${formatToolCallArgs(call.args || {})})`;
          })
          .join('\n')
    );
  }
  return parts.join('\n\n').trim() || 'No actions planned.';
}
