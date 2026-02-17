import generatedRegistry from '../capabilities/generated/registry.json';
import type { ChatAction } from './actions';
import type { PlannedToolCall } from './toolExecutor/types';

const DESTRUCTIVE_TOOLS = new Set([
  'delete_contact',
  'delete_company',
  'delete_campaign',
  'send_email',
  'send_campaign_emails',
  'sync_to_salesforce',
  'reset_all',
  'bulk_delete_contacts',
  'bulk_delete_companies',
]);

const CONFIRMATION_REQUIRED_TOOLS = new Set([
  'compound_workflow_run',
]);

const SAFE_TOOLS = new Set([
  'hybrid_search',
  'list_campaigns',
  'search_contacts',
  'search_companies',
  'get_contact',
  'get_campaign',
  'get_company',
  'browser_health',
  'browser_tabs',
  'browser_snapshot',
  'browser_find_ref',
  'list_filter_values',
]);

type CapabilityActionRecord = {
  id?: string;
  aliases?: string[];
  destructive?: boolean;
};

type CapabilityPageRecord = {
  actions?: CapabilityActionRecord[];
};

const DESTRUCTIVE_ACTION_IDS = (() => {
  const set = new Set<string>();
  const pages = Array.isArray(generatedRegistry) ? (generatedRegistry as CapabilityPageRecord[]) : [];
  for (const page of pages) {
    for (const action of page.actions || []) {
      if (!action?.destructive) continue;
      if (typeof action.id === 'string' && action.id.trim()) set.add(action.id.trim());
      for (const alias of action.aliases || []) {
        const normalized = String(alias || '').trim();
        if (normalized) set.add(normalized);
      }
    }
  }
  return set;
})();

export interface DestructiveCheckResult {
  requiresConfirmation: boolean;
  reasons: string[];
}

export function checkPlanDestructive(
  uiActions: ChatAction[] | undefined,
  toolCalls: PlannedToolCall[] | undefined
): DestructiveCheckResult {
  const reasons: string[] = [];

  for (const action of uiActions || []) {
    if (!action || typeof action !== 'object') continue;
    if (!('action' in action)) continue;
    const actionId = String((action as { action?: unknown }).action || '').trim();
    if (!actionId) continue;
    if (DESTRUCTIVE_ACTION_IDS.has(actionId)) {
      reasons.push(`UI action "${actionId}" is marked destructive`);
    }
  }

  for (const call of toolCalls || []) {
    const name = String(call?.name || '').trim();
    if (!name) continue;
    if (DESTRUCTIVE_TOOLS.has(name)) {
      reasons.push(`Tool "${name}" is destructive`);
      continue;
    }
    if (CONFIRMATION_REQUIRED_TOOLS.has(name)) {
      reasons.push(`Tool "${name}" requires confirmation (long-running background workflow)`);
      continue;
    }
    if (SAFE_TOOLS.has(name)) continue;
  }

  return {
    requiresConfirmation: reasons.length > 0,
    reasons,
  };
}
