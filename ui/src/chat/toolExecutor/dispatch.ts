import { TOOLS } from '../tools';
import { normalizeToolArgs } from '../../utils/filterNormalization';
import { enqueueInLane } from '../toolLane';
import type { ParsedToolCall, ToolDispatchItem, ToolDispatchResult } from './types';
import { resolveTemplate } from './template';
import { postProcessResult } from './postProcess';
import { executeTool } from './executeTool';
import { TOOL_LANE_KEY, TOOL_LANE_SERIAL } from './config';

const TOOL_SCHEMA_BY_NAME = new Map(
  TOOLS.map((tool) => [tool.function.name, tool.function.parameters] as const)
);

function validateToolArgs(name: string, args: Record<string, unknown>): { ok: true } | { ok: false; message: string } {
  if (name === 'get_contact') {
    const contactId = args.contact_id;
    if (
      typeof contactId !== 'number' ||
      !Number.isFinite(contactId) ||
      !Number.isInteger(contactId) ||
      contactId <= 0
    ) {
      return { ok: false, message: 'contact_id must be a positive integer' };
    }
  }

  const schema = TOOL_SCHEMA_BY_NAME.get(name);
  if (!schema || typeof schema !== 'object') return { ok: true };

  const schemaObj = schema as {
    required?: unknown;
    properties?: unknown;
  };
  const required = Array.isArray(schemaObj.required)
    ? schemaObj.required.filter((x): x is string => typeof x === 'string')
    : [];
  const properties =
    schemaObj.properties && typeof schemaObj.properties === 'object'
      ? (schemaObj.properties as Record<string, unknown>)
      : {};

  for (const key of required) {
    const value = args[key];
    if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) {
      return { ok: false, message: `missing required argument "${key}"` };
    }
  }

  for (const [key, value] of Object.entries(args)) {
    if (!(key in properties)) continue;
    if (value === undefined || value === null) continue;

    const prop = properties[key];
    if (!prop || typeof prop !== 'object') continue;
    const declaredType = (prop as { type?: unknown }).type;
    if (declaredType === 'string' && typeof value !== 'string') {
      return { ok: false, message: `argument "${key}" must be a string` };
    }
    if (declaredType === 'number' && (typeof value !== 'number' || Number.isNaN(value))) {
      return { ok: false, message: `argument "${key}" must be a number` };
    }
    if (declaredType === 'boolean' && typeof value !== 'boolean') {
      return { ok: false, message: `argument "${key}" must be a boolean` };
    }
    if (declaredType === 'array' && !Array.isArray(value)) {
      return { ok: false, message: `argument "${key}" must be an array` };
    }
    if (declaredType === 'object' && (typeof value !== 'object' || Array.isArray(value))) {
      return { ok: false, message: `argument "${key}" must be an object` };
    }
  }

  return { ok: true };
}

function summarizeDispatch(items: ToolDispatchItem[]): string {
  if (items.length === 0) return 'No tool calls were executed.';

  const ok = items.filter((i) => i.ok);
  const failed = items.filter((i) => !i.ok);
  if (failed.length > 0) {
    const first = failed[0];
    const result = first?.result as {
      message?: string;
      detail?: unknown;
      status?: number;
      error?: unknown;
    } | undefined;
    const errorText =
      typeof result?.error === 'string'
        ? result.error
        : result?.error && typeof result.error === 'object'
          ? (
              (result.error as { message?: string; detail?: unknown }).message ||
              ((result.error as { detail?: unknown }).detail
                ? JSON.stringify((result.error as { detail?: unknown }).detail)
                : '')
            )
          : '';
    const detail =
      typeof result?.detail === 'string'
        ? result.detail
        : result?.detail
          ? JSON.stringify(result.detail)
          : '';
    const msg = result?.message || errorText || detail || 'Unknown error';
    return `Tool ${first.name} failed${result?.status ? ` (${result.status})` : ''}: ${msg}`;
  }

  if (ok.length === 1) return `Executed ${ok[0].name}.`;
  return `Executed ${ok.length} tool calls: ${ok.map((x) => x.name).join(', ')}.`;
}

async function dispatchToolCallsInternal(
  calls: ParsedToolCall[],
  onToolCall?: (name: string) => void
): Promise<ToolDispatchResult> {
  const allowed = new Set(TOOLS.map((t) => t.function.name));
  const stopChainOnFailure = new Set([
    'browser_health',
    'browser_tabs',
    'browser_navigate',
    'browser_snapshot',
    'browser_act',
    'browser_find_ref',
    'browser_wait',
    'browser_screenshot',
    'browser_search_and_extract',
    'google_search_browser',
    'browser_list_sub_items',
    'browser_skill_list',
    'browser_skill_match',
    'browser_skill_get',
    'browser_skill_upsert',
    'browser_skill_delete',
    'browser_skill_repair',
  ]);
  const executed: ToolDispatchItem[] = [];
  const toolsUsed: string[] = [];
  let previousResult: unknown = null;
  const resultsByTool: Record<string, unknown> = {};

  for (const call of calls) {
    const name = call.name;
    const rawArgs = (call.args && typeof call.args === 'object' && !Array.isArray(call.args))
      ? call.args
      : {};
    const resolvedArgs = resolveTemplate(rawArgs, previousResult, resultsByTool) as Record<string, unknown>;
    const args = normalizeToolArgs(name, resolvedArgs);

    if (!allowed.has(name)) {
      executed.push({
        name,
        args,
        result: { error: true, message: `Invalid or unsupported tool call: ${name}` },
        ok: false,
      });
      continue;
    }

    const argValidation = validateToolArgs(name, args);
    if (!argValidation.ok) {
      executed.push({
        name,
        args,
        result: { error: true, message: `Invalid arguments for tool ${name}: ${argValidation.message}` },
        ok: false,
      });
      if (stopChainOnFailure.has(name)) {
        break;
      }
      continue;
    }

    toolsUsed.push(name);
    onToolCall?.(name);
    const startedAt = (typeof performance !== 'undefined' && typeof performance.now === 'function')
      ? performance.now()
      : Date.now();

    try {
      const rawResult = await executeTool(name, args);
      const result = postProcessResult(name, args, rawResult);
      const hasError = Boolean(
        result &&
        typeof result === 'object' &&
        'error' in (result as Record<string, unknown>) &&
        (result as { error?: unknown }).error
      );
      const endedAt = (typeof performance !== 'undefined' && typeof performance.now === 'function')
        ? performance.now()
        : Date.now();
      executed.push({ name, args, result, ok: !hasError, durationMs: Math.max(0, Math.round(endedAt - startedAt)) });
      if (!hasError) {
        previousResult = result;
        resultsByTool[name] = result;
      } else if (stopChainOnFailure.has(name)) {
        break;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      const endedAt = (typeof performance !== 'undefined' && typeof performance.now === 'function')
        ? performance.now()
        : Date.now();
      executed.push({
        name,
        args,
        result: { error: true, message },
        ok: false,
        durationMs: Math.max(0, Math.round(endedAt - startedAt)),
      });
      if (stopChainOnFailure.has(name)) {
        break;
      }
    }
  }

  const success = executed.length > 0 && executed.every((x) => x.ok);
  return {
    success,
    toolsUsed,
    executed,
    summary: summarizeDispatch(executed),
  };
}

export async function dispatchToolCalls(
  calls: ParsedToolCall[],
  onToolCall?: (name: string) => void
): Promise<ToolDispatchResult> {
  if (!TOOL_LANE_SERIAL) {
    return dispatchToolCallsInternal(calls, onToolCall);
  }
  return enqueueInLane(TOOL_LANE_KEY, () => dispatchToolCallsInternal(calls, onToolCall));
}

export { summarizeDispatch, dispatchToolCallsInternal };
