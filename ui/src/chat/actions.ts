import type { PageContextSnapshot } from '../types/pageContext';
import type { UIAction } from '../capabilities/generated/schema';

export type ChatAction =
  | UIAction
  | { type: 'navigate'; to: string }
  | { type: 'set_filter'; key: string; value: string | number | boolean | null }
  | { type: 'select_contact'; contactId: number }
  | { type: 'select_company'; companyId: number }
  | { type: 'open_modal'; modal: 'create_campaign' | 'email_contact' | 'confirm_delete'; payload?: Record<string, unknown> }
  | { type: 'run_command'; command: 'sync_to_sf' | 'add_to_campaign' | 'delete_contact'; payload: Record<string, unknown> }
  | { type: 'toast'; level: 'success' | 'error' | 'info'; message: string };

export interface ParsedAssistantPayload {
  text: string;
  actions: ChatAction[];
}

export function buildChatRequest(input: {
  userMessage: string;
  pageContext: PageContextSnapshot;
}): string {
  const contextBlock = JSON.stringify(input.pageContext);
  return `${input.userMessage}\n\n[PAGE_CONTEXT]\n${contextBlock}\n[/PAGE_CONTEXT]`;
}

export function parseAssistantResponse(content: string): ParsedAssistantPayload {
  const trimmed = content.trim();
  const fence = trimmed.match(/```json\s*([\s\S]*?)```/i);
  if (!fence || !fence[1]) {
    return { text: content, actions: [] };
  }

  const jsonText = fence[1].trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return { text: content, actions: [] };
  }

  if (!parsed || typeof parsed !== 'object') {
    return { text: content, actions: [] };
  }

  const obj = parsed as { actions?: unknown };
  const actions = Array.isArray(obj.actions) ? (obj.actions as ChatAction[]) : [];
  const text = trimmed.replace(fence[0], '').trim();
  return { text, actions };
}
