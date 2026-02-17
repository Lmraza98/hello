/**
 * Session entity coreference resolution.
 *
 * Must preserve the anchored [RESOLVED_ENTITY] block formatting exactly.
 */

import { ollamaChat } from '../models/ollamaClient';
import { type ChatSessionState } from '../sessionState';
import { DECOMPOSE_CLASSIFIER_MODEL, SESSION_ENTITY_MAX_AGE_MS } from './env';

export type SessionEntityChoice = {
  entityType: string;
  entityId: string;
  label: string;
};

export type SessionResolution = {
  normalizedMessage: string;
  resolvedEntity?: SessionEntityChoice;
  ambiguous: boolean;
};

export function buildSessionEntityChoices(sessionState: ChatSessionState | undefined, limit = 5): SessionEntityChoice[] {
  if (!sessionState || !Array.isArray(sessionState.entities)) return [];
  const now = Date.now();
  const seen = new Set<string>();
  const out: SessionEntityChoice[] = [];
  for (const entity of sessionState.entities) {
    if (Number.isFinite(entity.updatedAt) && now - entity.updatedAt > SESSION_ENTITY_MAX_AGE_MS) continue;
    const entityType = String(entity.entityType || '').trim().toLowerCase();
    const entityId = String(entity.entityId || '').trim();
    if (!entityType || !entityId) continue;
    const key = `${entityType}:${entityId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      entityType,
      entityId,
      label: entity.label || `${entityType} #${entityId}`,
    });
    if (out.length >= limit) break;
  }
  return out;
}

export function tokenizeLowerWords(value: string): string[] {
  const cleaned = value
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .map((token) => token.trim())
    .filter(Boolean);
  return cleaned;
}

export async function resolveSessionCoreference(
  normalizedMessage: string,
  sessionState: ChatSessionState | undefined
): Promise<SessionResolution> {
  const sessionChoices = buildSessionEntityChoices(sessionState);
  if (sessionChoices.length === 0) return { normalizedMessage, ambiguous: false };

  const msgLower = normalizedMessage.toLowerCase();
  const explicitMatches = sessionChoices.filter((choice) =>
    choice.label.trim().length > 2 && msgLower.includes(choice.label.trim().toLowerCase())
  );
  if (explicitMatches.length === 1) {
    const resolved = explicitMatches[0];
    const anchoredMessage =
      `${normalizedMessage}\n\n` +
      `[RESOLVED_ENTITY]\n` +
      `${JSON.stringify({
        entity_type: resolved.entityType,
        entity_id: resolved.entityId,
        label: resolved.label,
        source: 'session_explicit_match',
      })}\n` +
      `[/RESOLVED_ENTITY]`;
    return { normalizedMessage: anchoredMessage, resolvedEntity: resolved, ambiguous: false };
  }

  // Cheap gate: if there's no coreference signal, don't spend an LLM call.
  // (Explicit label matches are already handled above.)
  const tokens = new Set(tokenizeLowerWords(normalizedMessage));
  const hasAnyCorefSignal = ['him', 'her', 'them', 'their', 'it', 'this', 'that', 'these', 'those', 'he', 'she', 'they'].some(
    (t) => tokens.has(t)
  );
  if (!hasAnyCorefSignal && explicitMatches.length === 0) return { normalizedMessage, ambiguous: false };

  // LLM coreference classifier (only when we have multiple recent entities).
  // If it fails, never block the user with an ambiguity prompt.
  if (sessionChoices.length < 2) return { normalizedMessage, ambiguous: false };

  try {
    const choices = sessionChoices.map((c, idx) => ({
      idx: idx + 1,
      entity_type: c.entityType,
      entity_id: c.entityId,
      label: c.label,
    }));
    const res = await ollamaChat({
      model: DECOMPOSE_CLASSIFIER_MODEL,
      messages: [
        {
          role: 'system',
          content:
            'You are a coreference resolver for a chat session.\n' +
            'Given a user message and a list of recent entities, decide if the message refers to one of them.\n' +
            'Return ONLY one of:\n' +
            '- a number (1..N) selecting the best matching entity\n' +
            '- "none" (message does not refer to any entity)\n' +
            '- "ambiguous" (message could refer to multiple entities)\n' +
            'Be conservative: if unclear, return "none".',
        },
        { role: 'user', content: `Entities:\n${JSON.stringify(choices)}\n\nMessage:\n${normalizedMessage}` },
      ],
      temperature: 0,
      numPredict: 4,
    });

    const answer = (res.message.content || '').trim().toLowerCase();
    if (!answer) return { normalizedMessage, ambiguous: false };
    if (answer.includes('ambig')) return { normalizedMessage, ambiguous: true };
    if (answer.includes('none')) return { normalizedMessage, ambiguous: false };
    const picked = Number.parseInt(answer.replace(/[^0-9]/g, ''), 10);
    if (!Number.isFinite(picked) || picked <= 0 || picked > sessionChoices.length) {
      return { normalizedMessage, ambiguous: false };
    }

    const resolved = sessionChoices[picked - 1];
    if (!resolved) return { normalizedMessage, ambiguous: false };
    const anchoredMessage =
      `${normalizedMessage}\n\n` +
      `[RESOLVED_ENTITY]\n` +
      `${JSON.stringify({
        entity_type: resolved.entityType,
        entity_id: resolved.entityId,
        label: resolved.label,
        source: 'session_coreference_llm',
      })}\n` +
      `[/RESOLVED_ENTITY]`;
    return { normalizedMessage: anchoredMessage, resolvedEntity: resolved, ambiguous: false };
  } catch {
    return { normalizedMessage, ambiguous: false };
  }
}

