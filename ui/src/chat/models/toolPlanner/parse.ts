import type { TaskStep } from "../../chatEngineTypes";
import type { ParsedToolCall } from "../../toolExecutor";
import type { UIAction } from "../../../capabilities/generated/schema";
import registry from "../../../capabilities/generated/registry.json";

type CapabilityActionRecord = { id?: string; aliases?: string[] };
type CapabilityPageRecord = { actions?: CapabilityActionRecord[] };

const KNOWN_UI_ACTIONS = new Set(
  (Array.isArray(registry) ? registry : [])
    .flatMap((page) => ((page as CapabilityPageRecord).actions || []))
    .flatMap((action) => [String(action.id || '').trim(), ...((action.aliases || []).map((x) => String(x).trim()))])
    .filter(Boolean)
);

export interface ParsedPlannerPlan {
  uiActions: UIAction[];
  toolCalls: ParsedToolCall[];
}

export type PlannerModelFamily = 'gemma' | 'gpt-4o-mini' | 'gpt-4o' | 'claude' | 'other';

export function detectPlannerModelFamily(model: string | undefined): PlannerModelFamily {
  const normalized = String(model || '').toLowerCase();
  if (!normalized) return 'other';
  if (normalized.includes('gemma') || normalized.includes('qwen') || normalized.includes('devstral')) return 'gemma';
  if (normalized.includes('gpt-4o-mini')) return 'gpt-4o-mini';
  if (normalized.includes('gpt-4o')) return 'gpt-4o';
  if (normalized.includes('claude')) return 'claude';
  return 'other';
}

export function shouldUpgradeModelAfterParseFailure(model: string | undefined): boolean {
  const family = detectPlannerModelFamily(model);
  return family === 'gemma' || family === 'other';
}

export function extractCandidateJson(content: string | null): string | null {
  if (!content) return null;
  const trimmed = content.trim();
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) return trimmed;

  const fenced = trimmed.match(/```(?:json)?\\s*([\\s\\S]*?)```/i);
  if (fenced && fenced[1]) return fenced[1].trim();

  // Extract first balanced JSON array/object from mixed prose output.
  const start = Math.min(
    ...[trimmed.indexOf('['), trimmed.indexOf('{')].filter((i) => i >= 0)
  );
  if (!Number.isFinite(start) || start < 0) return null;

  const open = trimmed[start];
  const close = open === '[' ? ']' : '}';
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\\\') {
      escaped = true;
      continue;
    }
    if (ch === '\"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === open) depth += 1;
    if (ch === close) depth -= 1;
    if (depth === 0) return trimmed.slice(start, i + 1).trim();
  }
  return null;
}
export function normalizeParsedCalls(raw: unknown): ParsedToolCall[] {
  const extractContainer = (value: unknown): unknown => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
    const obj = value as Record<string, unknown>;
    if (Array.isArray(obj.calls)) return obj.calls;
    if (Array.isArray(obj.plan)) return obj.plan;
    if (Array.isArray(obj.tool_calls)) return obj.tool_calls;
    return value;
  };

  const toCall = (item: unknown): ParsedToolCall | null => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
    const obj = item as Record<string, unknown>;
    const nameValue = obj.name ?? obj.tool;
    if (typeof nameValue !== 'string' || !nameValue.trim()) return null;
    const rawArgs = obj.args ?? obj.arguments;
    let args: Record<string, unknown>;
    if (rawArgs && typeof rawArgs === 'object' && !Array.isArray(rawArgs)) {
      args = rawArgs as Record<string, unknown>;
    } else {
      // Model put args at the top level (flat format). Collect all keys
      // that aren't meta-keys as the tool arguments.
      const metaKeys = new Set(['name', 'tool', 'tool_call', 'args', 'arguments', 'parameters']);
      args = {};
      for (const [k, v] of Object.entries(obj)) {
        if (!metaKeys.has(k)) args[k] = v;
      }
    }
    return { name: nameValue.trim(), args };
  };

  const normalized = extractContainer(raw);
  if (Array.isArray(normalized)) {
    const calls = normalized.map(toCall).filter((x): x is ParsedToolCall => Boolean(x));
    const seen = new Set<string>();
    const out: ParsedToolCall[] = [];
    for (const call of calls) {
      let key = call.name;
      try {
        key += `|${JSON.stringify(call.args)}`;
      } catch {
        key += '|{unstringifiable}';
      }
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(call);
    }
    return out;
  }
  const one = toCall(normalized);
  return one ? [one] : [];
}

function normalizeParsedUiActions(raw: unknown): UIAction[] {
  const extractContainer = (value: unknown): unknown => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
    const obj = value as Record<string, unknown>;
    if (Array.isArray(obj.ui_actions)) return obj.ui_actions;
    if (Array.isArray(obj.uiActions)) return obj.uiActions;
    return value;
  };

  const normalized = extractContainer(raw);
  if (!Array.isArray(normalized)) return [];

  const out: UIAction[] = [];
  const seen = new Set<string>();
  for (const item of normalized) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    const actionId = String(record.action || '').trim();
    if (!actionId || !KNOWN_UI_ACTIONS.has(actionId)) continue;
    const key = JSON.stringify(record);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(record as unknown as UIAction);
  }
  return out;
}

export function normalizeParsedPlan(raw: unknown): ParsedPlannerPlan {
  const toolCalls = normalizeParsedCalls(raw);
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const obj = raw as Record<string, unknown>;
    const compound = obj.compound_workflow;
    if (compound && typeof compound === 'object' && !Array.isArray(compound)) {
      toolCalls.unshift({
        name: 'compound_workflow_run',
        args: { spec: compound as Record<string, unknown> },
      });
    }
  }
  const uiActions = normalizeParsedUiActions(raw);
  return { toolCalls, uiActions };
}

export function normalizeParsedSteps(raw: unknown): TaskStep[] {
  const normalized = Array.isArray(raw) ? raw : (raw && typeof raw === 'object' && Array.isArray((raw as any).steps) ? (raw as any).steps : raw);
  if (!Array.isArray(normalized)) return [];
  const out: TaskStep[] = [];
  for (const item of normalized) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const obj = item as Record<string, unknown>;
    const id = typeof obj.id === 'string' ? obj.id.trim() : '';
    const intent = typeof obj.intent === 'string' ? obj.intent.trim() : '';
    const dependsOnRaw = obj.dependsOn;
    const dependsOn = Array.isArray(dependsOnRaw)
      ? dependsOnRaw.map((x) => String(x || '').trim()).filter(Boolean)
      : [];
    if (!intent) continue;
    out.push({ id: id || `step_${out.length + 1}`, intent, dependsOn });
  }
  return out;
}
