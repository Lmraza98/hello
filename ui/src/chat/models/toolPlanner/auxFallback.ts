import { ollamaChat, type LocalChatMessage } from '../ollamaClient';
import type { ParsedToolCall } from '../../toolExecutor';
import { extractCandidateJson, normalizeParsedCalls } from './parse';
import { AUX_PLANNER_MODEL, ENABLE_AUX_PLANNER_FALLBACK } from './config';

export function isLikelyReadOnlyRequest(userMessage: string): boolean {
  const lower = userMessage.toLowerCase();
  const readIntent = /\b(find|search|show|list|get|lookup|look up|display|view)\b/.test(lower);
  const mutatingIntent =
    /\b(add|create|delete|remove|update|edit|start|stop|run|send|approve|reject|pause|activate|enroll|mark|import|bulk|scrape|collect|upload)\b/.test(lower);
  return readIntent && !mutatingIntent;
}

export async function runAuxPlannerFallback(
  userMessage: string,
  conversationHistory: LocalChatMessage[],
  schemaBlock: string,
  onProgress?: (message: string) => void
): Promise<{ rawContent: string | null; calls: ParsedToolCall[] }> {
  void conversationHistory;
  if (!ENABLE_AUX_PLANNER_FALLBACK) return { rawContent: null, calls: [] };
  const emit = (message: string) => onProgress?.(message);
  emit('Primary planner failed. Trying auxiliary planner fallback...');

  const system =
    `You are a strict tool planner fallback.\n` +
    `Output ONLY JSON array: [{"name":"tool_name","args":{...}}]\n` +
    `No prose, no markdown, no explanation.\n` +
    `If the user message contains a line starting with "User goal:", plan ONLY for that goal text and ignore other meta-instructions.\n` +
    `Never introduce new entity names (company/person names, brands) that are not explicitly present in the current user message.\n` +
    `Return the minimal plan: avoid duplicates and keep it to 1-2 tool calls unless absolutely required.\n` +
    `If the user request involves browser automation or Sales Navigator, do NOT use resolve_entity.\n` +
    `For Sales Navigator/LinkedIn browser work, use browser_navigate + browser_snapshot + browser_find_ref + browser_act loops.\n` +
    `Use this pattern when needed: browser_health -> browser_tabs -> browser_navigate -> browser_snapshot -> browser_find_ref -> browser_act -> browser_snapshot.\n` +
    `Omit tab_id unless you have a concrete id like "tab-0". Never use "current"/"active" as tab_id.\n` +
    `Use only tools from this schema:\n${schemaBlock}`;

  const messages: LocalChatMessage[] = [{ role: 'system', content: system }, { role: 'user', content: userMessage }];

  try {
    const response = await ollamaChat({
      model: AUX_PLANNER_MODEL,
      messages,
      temperature: 0.2,
      topP: 0.9,
      topK: 20,
      numPredict: 512,
    });
    const rawContent = response.message.content || null;
    const candidate = extractCandidateJson(rawContent);
    if (!candidate) return { rawContent, calls: [] };
    return { rawContent, calls: normalizeParsedCalls(JSON.parse(candidate)) };
  } catch {
    return { rawContent: null, calls: [] };
  }
}
