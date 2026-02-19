const NULLISH_FILTER_TOKENS = new Set([
  '',
  'all',
  'any',
  '*',
  'none',
  'null',
  'n/a',
  'na',
]);

const BOOLEAN_TRUE_TOKENS = new Set(['true', '1', 'yes', 'y']);
const BOOLEAN_FALSE_TOKENS = new Set(['false', '0', 'no', 'n']);
const PAGE_CONTEXT_BLOCK = /\[PAGE_CONTEXT\][\s\S]*?\[\/PAGE_CONTEXT\]/gi;
const JSON_OBJECT_AT_END = /\n?\{[\s\S]*\}\s*$/;

function isNullishToken(value: string): boolean {
  return NULLISH_FILTER_TOKENS.has(value.trim().toLowerCase());
}

function normalizeBooleanString(raw: string): boolean | null {
  const lower = raw.trim().toLowerCase();
  if (BOOLEAN_TRUE_TOKENS.has(lower)) return true;
  if (BOOLEAN_FALSE_TOKENS.has(lower)) return false;
  return null;
}

export function stripPageContextFromText(value: string): string {
  const withoutContext = value.replace(PAGE_CONTEXT_BLOCK, ' ').replace(/\s+/g, ' ').trim();
  // Defensive: if context was appended without tags in edge cases, drop trailing JSON blob.
  if (JSON_OBJECT_AT_END.test(withoutContext) && withoutContext.includes('[PAGE_CONTEXT]')) {
    return withoutContext.replace(JSON_OBJECT_AT_END, '').trim();
  }
  return withoutContext;
}

export function normalizeFilterValue(
  key: string,
  value: unknown
): string | boolean | number | Record<string, unknown> | unknown[] | null {
  if (value == null) return null;

  const keyLower = key.trim().toLowerCase();

  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (Array.isArray(value)) {
    const normalizedItems = value
      .map((item) => normalizeFilterValue(key, item))
      .filter((item) => item !== null);
    return normalizedItems;
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [nestedKey, nestedValue] of Object.entries(value as Record<string, unknown>)) {
      const normalizedNested = normalizeFilterValue(nestedKey, nestedValue);
      if (normalizedNested !== null) {
        out[nestedKey] = normalizedNested;
      }
    }
    return out;
  }

  if (typeof value !== 'string') return String(value);

  const trimmed = stripPageContextFromText(value).trim();
  if (!trimmed) return null;
  if (isNullishToken(trimmed)) return null;

  if (keyLower === 'tier') {
    const single = trimmed.toUpperCase();
    if (/^[A-Z]$/.test(single)) return single;
    return single;
  }

  if (
    keyLower === 'has_email' ||
    keyLower === 'hasemail' ||
    keyLower === 'today_only' ||
    keyLower === 'todayonly' ||
    keyLower === 'with_email_only'
  ) {
    const parsed = normalizeBooleanString(trimmed);
    return parsed === null ? null : parsed;
  }

  return trimmed;
}

export function normalizeToolArgs(
  toolName: string,
  args: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args || {})) {
    const normalized = normalizeFilterValue(k, v);
    if (normalized === null) continue;
    out[k] = normalized;
  }

  if (toolName === 'search_companies') {
    if (typeof out.tier === 'string' && isNullishToken(out.tier)) {
      delete out.tier;
    }
    if (typeof out.vertical === 'string') {
      const vertical = out.vertical.trim();
      if (!vertical) delete out.vertical;
      else out.vertical = vertical;
    }
  }

  if (toolName === 'search_contacts') {
    if (typeof out.name === 'string' && !out.name.trim()) delete out.name;
    if (typeof out.company === 'string' && !out.company.trim()) delete out.company;
    if (typeof out.vertical === 'string') {
      const vertical = out.vertical.trim();
      if (!vertical) delete out.vertical;
      else out.vertical = vertical;
    }
  }

  if (toolName === 'hybrid_search' || toolName === 'resolve_entity') {
    if (typeof out.entity_types === 'string') {
      const parsed = out.entity_types
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean);
      if (parsed.length > 0) out.entity_types = parsed;
      else delete out.entity_types;
    } else if (Array.isArray(out.entity_types)) {
      const parsed = out.entity_types
        .map((x) => String(x).trim())
        .filter(Boolean);
      if (parsed.length > 0) out.entity_types = parsed;
      else delete out.entity_types;
    } else {
      delete out.entity_types;
    }

    if (typeof out.k === 'string') {
      const parsed = Number.parseInt(out.k, 10);
      if (Number.isFinite(parsed) && parsed > 0) out.k = parsed;
      else delete out.k;
    }
  }

  if (toolName === 'hybrid_search') {
    if (typeof out.filters === 'string') {
      try {
        const parsed = JSON.parse(out.filters) as unknown;
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          out.filters = parsed as Record<string, unknown>;
        } else {
          delete out.filters;
        }
      } catch {
        delete out.filters;
      }
    } else if (!out.filters || typeof out.filters !== 'object' || Array.isArray(out.filters)) {
      delete out.filters;
    }
  }

  if (toolName === 'resolve_entity') {
    if (typeof out.name_or_identifier !== 'string' || !out.name_or_identifier.trim()) {
      if (typeof out.query === 'string' && out.query.trim()) {
        out.name_or_identifier = out.query.trim();
      }
    }
    delete out.query;
  }

  if (toolName === 'ask_documents') {
    if ((typeof out.question !== 'string' || !out.question.trim()) && typeof out.query === 'string' && out.query.trim()) {
      out.question = out.query.trim();
    }
    delete out.query;
  }

  if (toolName === 'browser_snapshot') {
    const mode = typeof out.mode === 'string' ? out.mode.trim().toLowerCase() : '';
    if (mode && mode !== 'role' && mode !== 'ai') {
      out.mode = 'role';
    }
  }

  return out;
}

export function normalizeQueryFilterParam(
  key: string,
  value: unknown
): string | null {
  const normalized = normalizeFilterValue(key, value);
  if (normalized === null) return null;
  if (typeof normalized === 'boolean') return String(normalized);
  return String(normalized);
}
