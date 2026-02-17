/**
 * Template resolution helpers for tool-call args.
 *
 * Extracted verbatim from `ui/src/chat/toolExecutor.ts` (Phase 1A).
 */

export function getPathValue(source: unknown, path: string): unknown {
  if (!path) return source;
  const normalized = path.replace(/\[(\d+)\]/g, '.$1');
  const parts = normalized.split('.').filter(Boolean);
  let current: unknown = source;
  for (const part of parts) {
    if (current == null) return undefined;
    if (Array.isArray(current)) {
      const idx = Number(part);
      if (!Number.isInteger(idx) || idx < 0 || idx >= current.length) return undefined;
      current = current[idx];
      continue;
    }
    if (typeof current === 'object') {
      current = (current as Record<string, unknown>)[part];
      continue;
    }
    return undefined;
  }
  return current;
}

export function resolveTemplate(
  value: unknown,
  previousResult: unknown,
  resultsByTool: Record<string, unknown>
): unknown {
  if (typeof value === 'string') {
    const trimmed = value.trim();

    const prevMatch = trimmed.match(/^\$prev(?:\.(.+))?$/);
    if (trimmed === '$previous_result') return previousResult;
    if (prevMatch) return getPathValue(previousResult, prevMatch[1] || '');

    const toolMatch = trimmed.match(/^\$tool\.([a-zA-Z0-9_]+)(?:\.(.+))?$/);
    if (toolMatch) {
      const toolName = toolMatch[1] || '';
      const path = toolMatch[2] || '';
      return getPathValue(resultsByTool[toolName], path);
    }
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((v) => resolveTemplate(v, previousResult, resultsByTool));
  }

  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = resolveTemplate(v, previousResult, resultsByTool);
    }
    return out;
  }

  return value;
}

