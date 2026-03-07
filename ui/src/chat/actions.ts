import type { PageContextSnapshot } from '../types/pageContext';
import type { UIAction } from '../capabilities/generated/schema';

export type ChatAction =
  | UIAction
  | { type: 'navigate'; to: string }
  | { type: 'set_filter'; key: string; value: string | number | boolean | null }
  | { type: 'select_contact'; contactId: number }
  | { type: 'select_company'; companyId: number }
  | {
      type: 'assistant_ui_start_flow';
      flowId: 'create_contact';
    }
  | {
      type: 'assistant_ui_set_target';
      targetId: string;
      scrollTargetId?: string | null;
      instruction?: string | null;
      interaction?: 'highlight' | 'click';
      pointerMode?: 'passthrough' | 'interactive';
      autoClick?: boolean;
    }
  | { type: 'assistant_ui_clear' }
  | {
      type: 'assistant_guide';
      highlightedElementId: string;
      scrollTargetId?: string | null;
      activeStep?: string | null;
      interaction?: 'highlight' | 'click';
      pointerMode?: 'passthrough' | 'interactive';
      autoClick?: boolean;
    }
  | { type: 'assistant_guide_clear' }
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
  return `${input.userMessage}

[ASSISTANT_UI_GUIDANCE]
When guiding a user through the existing UI, do not invent or move interface elements.
Prefer starting durable multi-step UI flows with {"actions":[{"type":"assistant_ui_start_flow","flowId":"create_contact"}]} when the user asks for an end-to-end workflow like creating a contact.
Prefer fenced JSON actions like {"actions":[{"type":"assistant_ui_set_target","targetId":"new-contact-button","scrollTargetId":"new-contact-button","instruction":"Click New Contact","interaction":"click","pointerMode":"passthrough","autoClick":false}]}.
Use {"actions":[{"type":"assistant_ui_clear"}]} when the user changes direction or guidance should stop.
Legacy assistant_guide / assistant_guide_clear actions are still accepted, but prefer assistant_ui_start_flow / assistant_ui_set_target / assistant_ui_clear.
For walkthroughs, prefer demonstrating the click without activating it unless the user explicitly asks the assistant to perform the action.
Use pointerMode="passthrough" only when the user must click the live UI control underneath the chat overlay. Use pointerMode="interactive" for form/panel guidance so the chat stays scrollable.
Known contact-form targets: new-contact-button, contact-create-panel, contact-name-input, contact-company-input, contact-email-input, contact-phone-input, contact-location-input, contact-title-input, contact-linkedin-input, contact-salesforce-input, add-contact-submit.
Keep the human-readable instruction in normal chat text outside the JSON block.
[/ASSISTANT_UI_GUIDANCE]

[PAGE_CONTEXT]
${contextBlock}
[/PAGE_CONTEXT]`;
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
