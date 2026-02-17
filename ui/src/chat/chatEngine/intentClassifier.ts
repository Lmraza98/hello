/**
 * Intent classification utilities used by the chat engine pipeline.
 *
 * This module preserves the legacy classifier behavior from `chatEngine.ts`,
 * including heuristic multi-step detection and lenient parsing of model output.
 */

import type { ChatCompletionMessageParam } from '../chatEngineTypes';
import { ollamaChat } from '../models/ollamaClient';
import { CONVERSATION_MODEL, DECOMPOSE_CLASSIFIER_MODEL } from './env';

export type IntentKind = 'conversational' | 'single' | 'multi';

export function hasExplicitMultiStepMarkers(message: string): boolean {
  const lower = message.toLowerCase();
  if (/\n\s*\d+\.\s+/.test(lower)) return true;
  if (lower.includes(';')) return true;
  const multiMarkers = [
    ' then ',
    ' and then ',
    ' after that',
    ' before that',
    ' based on ',
    ' followed by ',
    ' next,',
    ' next ',
  ];
  return multiMarkers.some((m) => lower.includes(m));
}

// NOTE: Decomposition decisions flow through classifyIntent(). Keep the planner fast by skipping LLM classification for very short messages.
export async function classifyIntent(message: string, onProgress?: (msg: string) => void): Promise<IntentKind> {
  const cleaned = (message || '').trim();
  if (!cleaned) return 'conversational';

  // Explicit multi-step markers are conclusive.
  if (hasExplicitMultiStepMarkers(cleaned)) return 'multi';

  const prompt: ChatCompletionMessageParam[] = [
    {
      role: 'system',
      content:
        'Classify the user message into one of: conversational, single, multi.\n' +
        '\n' +
        'Definitions:\n' +
        '- conversational: greetings, capability questions, chit-chat, opinions, brainstorming.\n' +
        '- IMPORTANT: If the user asks for a CURRENT value that requires looking something up (views count, price, weather, â€œwhatâ€™s on the page right nowâ€), classify as single.\n' +
        '- single: the user is asking you to do one concrete action, giving a correction, or providing operational instructions (often one tool call).\n' +
        '- multi: multiple sequential steps with dependencies (often contains then/after/next or multiple actions).\n' +
        '\n' +
        'Examples:\n' +
        'User: "hello what can you do" -> conversational\n' +
        'User: "what are the most complex tasks you can do" -> conversational\n' +
        'User: "what are complex tasks you can do" -> conversational\n' +
        'User: "How many views does Gangnam Style currently have on YouTube?" -> single\n' +
        'User: "What is the weather in Boston today?" -> single\n' +
        'User: "find Keven Fuertes" -> single\n' +
        'User: "search for contacts in veterinary services" -> single\n' +
        'User: "Veterinary Services should be searched in the Vertical" -> single\n' +
        'User: "you should filter by vertical not by name" -> single\n' +
        'User: "try searching by industry instead" -> single\n' +
        'User: "create a new email campaign" -> single\n' +
        'User: "add those contacts to campaign 3" -> single\n' +
        'User: "find Keven then enroll him in campaign 5" -> multi\n' +
        'User: "create a campaign for vets then add contacts from the database" -> multi\n' +
        '\n' +
        'Key rule: If the message mentions databases, filters, fields, tools, searches,\n' +
        'contacts, campaigns, emails, or gives corrections about HOW to do something,\n' +
        'it is "single" - NOT conversational.\n' +
        '\n' +
        'Output rules:\n' +
        '- Reply with ONLY one word: conversational|single|multi\n' +
        '- Do NOT output JSON. Do NOT call tools. Do NOT explain.\n',
    },
    { role: 'user', content: cleaned },
  ];

  const parse = (raw: string): IntentKind | null => {
    const text = (raw || '').trim().toLowerCase();
    // Some models may wrap in code fences, add punctuation, or use synonyms like "multiple" instead of "multi". Be lenient in parsing.
    if (text.includes('conversational') || text.includes('convers')) return 'conversational';
    if (text.includes('single')) return 'single';
    if (text.includes('multi')) return 'multi'; // matches "multi", "multi-step", "multiple"
    // Fallback: extract first alphabetic word
    const first = (text.match(/[a-z]+/g) || [])[0] || '';
    if (first === 'conversational' || first === 'single' || first === 'multi') return first;
    return null;
  };

  const classifyWith = async (model: string): Promise<IntentKind | null> => {
    const response = await ollamaChat({
      model,
      messages: prompt,
      temperature: 0,
      numPredict: 8,
    });
    return parse(response.message.content || '');
  };

  // LLM classifier (prefer tiny model, but fall back if it returns tool-call JSON or other invalid output).
  try {
    onProgress?.('Classifying intent...');
    const primary = await classifyWith(DECOMPOSE_CLASSIFIER_MODEL);
    if (primary) return primary;

    onProgress?.('Classifier returned invalid output. Retrying with conversation model...');
    const fallback = await classifyWith(CONVERSATION_MODEL);
    if (fallback) return fallback;

    return 'single';
  } catch {
    return 'single';
  }
}

