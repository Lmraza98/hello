/**
 * Action router for UI action button values.
 *
 * Moved from `chatEngine.ts` with minimal logic change.
 */

import { statusMsg, textMsg } from '../../services/messageHelpers';
import type { ChatCompletionMessageParam } from '../chatEngineTypes';
import type { ChatSessionState } from '../sessionState';
import { executeTool } from '../toolExecutor';
import type { ChatEngineResult } from './pipelineTypes';
import { processMessagePipeline } from './pipelineSteps';

export async function processAction(
  actionValue: string,
  conversationHistory: ChatCompletionMessageParam[] = [],
  sessionState?: ChatSessionState
): Promise<ChatEngineResult> {
  if (actionValue.startsWith('pick_contact_for_email:')) {
    const rawContactId = actionValue.split(':')[1] || '';
    const contactId = Number.parseInt(rawContactId, 10);
    if (!Number.isFinite(contactId) || contactId <= 0) {
      return {
        response: 'Invalid contact selection.',
        updatedHistory: conversationHistory,
        messages: [textMsg('Invalid contact selection.')],
        modelUsed: 'qwen3',
        toolsUsed: [],
        fallbackUsed: false,
        sessionState,
      };
    }

    return processMessagePipeline(`send an email to contact ${contactId}`, {
      conversationHistory,
      phase: 'planning',
      sessionState,
    });
  }

  if (actionValue.startsWith('pick_entity:')) {
    const parts = actionValue.split(':');
    const entityType = (parts[1] || '').trim().toLowerCase();
    const entityId = (parts[2] || '').trim();
    if (!entityType || !entityId) {
      return {
        response: 'Invalid entity selection.',
        updatedHistory: conversationHistory,
        messages: [textMsg('Invalid entity selection.')],
        modelUsed: 'qwen3',
        toolsUsed: [],
        fallbackUsed: false,
        sessionState,
      };
    }
    const selected = sessionState?.entities?.find(
      (entity) =>
        entity.entityType.toLowerCase() === entityType &&
        String(entity.entityId) === entityId
    );
    if (!selected) {
      return {
        response: `Selected ${entityType} #${entityId}.`,
        updatedHistory: conversationHistory,
        messages: [textMsg(`Selected ${entityType} #${entityId}. Continue with your request.`)],
        modelUsed: 'qwen3',
        toolsUsed: [],
        fallbackUsed: false,
        sessionState,
      };
    }
    const now = Date.now();
    const nextSessionState: ChatSessionState = {
      entities: [
        { ...selected, updatedAt: now },
        ...(sessionState?.entities || []).filter(
          (entity) =>
            !(
              entity.entityType.toLowerCase() === entityType &&
              String(entity.entityId) === entityId
            )
        ),
      ],
      activeEntity: { ...selected, updatedAt: now },
      ...(sessionState?.browser ? { browser: sessionState.browser } : {}),
    };
    return {
      response: `Selected ${selected.label || `${entityType} #${entityId}`}.`,
      updatedHistory: conversationHistory,
      messages: [textMsg(`Selected ${selected.label || `${entityType} #${entityId}`}. Continue with your request.`)],
      modelUsed: 'qwen3',
      toolsUsed: [],
      fallbackUsed: false,
      sessionState: nextSessionState,
    };
  }

  if (actionValue.startsWith('contact_action:')) {
    const [, action, rawContactId] = actionValue.split(':');
    const contactId = Number.parseInt(rawContactId || '', 10);

    const contextActions = new Set(['add_to_database', 'add_to_campaign', 'send_email', 'search_salesnav']);
    if (contextActions.has(action)) {
      return processMessagePipeline(`Execute action "${action}" for contact ID ${contactId}`, {
        conversationHistory,
        phase: 'planning',
        sessionState,
      });
    }

    const directActionTool: Record<string, string> = {
      sync_salesforce: 'salesforce_search_contact',
      delete_contact: 'delete_contact',
    };
    const toolName = directActionTool[action];

    if (!toolName) {
      return {
        response: 'Unknown action.',
        updatedHistory: conversationHistory,
        messages: [textMsg('That action is not available.')],
        modelUsed: 'qwen3',
        toolsUsed: [],
        fallbackUsed: false,
        sessionState,
      };
    }

    try {
      await executeTool(toolName, { contact_id: contactId });
      return {
        response: 'Action completed.',
        updatedHistory: conversationHistory,
        messages: [statusMsg(`${action} completed for contact #${contactId}`, 'success')],
        modelUsed: 'qwen3',
        toolsUsed: [toolName],
        fallbackUsed: false,
        sessionState,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return {
        response: 'Action failed.',
        updatedHistory: conversationHistory,
        messages: [statusMsg(`Action failed: ${message}`, 'error')],
        modelUsed: 'qwen3',
        toolsUsed: [],
        fallbackUsed: false,
        sessionState,
      };
    }
  }

  if (actionValue.startsWith('section:')) {
    return {
      response: '',
      updatedHistory: conversationHistory,
      messages: [],
      modelUsed: 'qwen3',
      toolsUsed: [],
      fallbackUsed: false,
      sessionState,
    };
  }

  return {
    response: 'Unknown action.',
    updatedHistory: conversationHistory,
    messages: [textMsg('That action is not available.')],
    modelUsed: 'qwen3',
    toolsUsed: [],
    fallbackUsed: false,
    sessionState,
  };
}
