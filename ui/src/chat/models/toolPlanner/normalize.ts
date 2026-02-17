import type { ParsedToolCall } from '../../toolExecutor';
import { normalizeToolArgs } from '../../../utils/filterNormalization';
import { TOOLS } from '../../tools';

const TOOL_BY_NAME = new Map(TOOLS.map((t) => [t.function.name, t]));

export function coerceArgByType(value: unknown, type?: string): unknown {
  if (!type) return value;
  if (type === 'string') return value == null ? '' : String(value);
  if (type === 'number') {
    if (typeof value === 'number') return value;
    if (typeof value === 'string' && value.trim()) {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : value;
    }
    return value;
  }
  if (type === 'boolean') {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
      const lower = value.trim().toLowerCase();
      if (lower === 'true') return true;
      if (lower === 'false') return false;
    }
    return value;
  }
  if (type === 'array') {
    if (Array.isArray(value)) return value;
    if (value == null) return [];
    return [value];
  }
  return value;
}

export function sanitizeCallArgs(call: ParsedToolCall): ParsedToolCall | null {
  const tool = TOOL_BY_NAME.get(call.name);
  if (!tool) return null;

  const props = tool.function.parameters?.properties || {};
  const required = new Set(tool.function.parameters?.required || []);
  const normalized: Record<string, unknown> = {};

  // Tool-specific alias normalization (kept small and schema-driven).
  // This runs before we filter args by the schema keys so aliases can be mapped.
  const rawArgs = (call.args || {}) as Record<string, unknown>;
  if (call.name === 'get_contact') {
    const rawContactId = rawArgs.contact_id;
    if (
      typeof rawContactId !== 'number' ||
      !Number.isFinite(rawContactId) ||
      !Number.isInteger(rawContactId) ||
      rawContactId <= 0
    ) {
      return null;
    }
  }
  if (call.name === 'create_campaign') {
    // Common user/prose planners say "title" but the API uses "name".
    if (rawArgs.name == null && typeof rawArgs.title === 'string' && rawArgs.title.trim()) {
      rawArgs.name = rawArgs.title;
    }
  }
  if (call.name === 'create_note') {
    // Some planners emit note_content + entity_ids; map to the canonical schema.
    if (rawArgs.content == null && typeof rawArgs.note_content === 'string' && rawArgs.note_content.trim()) {
      rawArgs.content = rawArgs.note_content;
    }
    if (rawArgs.entity_id == null && Array.isArray(rawArgs.entity_ids) && rawArgs.entity_ids.length > 0) {
      rawArgs.entity_id = String(rawArgs.entity_ids[0]);
    }
    if (rawArgs.entity_type == null && rawArgs.entity_id != null) {
      // Default to contact when unspecified; coreference/session context should provide ids.
      rawArgs.entity_type = 'contact';
    }
  }
  if (call.name === 'resolve_entity') {
    if (Array.isArray(rawArgs.entity_types)) {
      const mapped = rawArgs.entity_types
        .map((value) => String(value).trim().toLowerCase())
        .map((value) => {
          if (value === 'person' || value === 'people' || value === 'lead' || value === 'leads' || value === 'prospect' || value === 'prospects' || value === 'employee' || value === 'employees') {
            return 'contact';
          }
          if (value === 'account' || value === 'accounts' || value === 'organization' || value === 'organisations' || value === 'org' || value === 'business' || value === 'firm') {
            return 'company';
          }
          if (value === 'campaigns') return 'campaign';
          return value;
        })
        .filter((value) => value === 'contact' || value === 'company' || value === 'campaign');
      if (mapped.length > 0) {
        rawArgs.entity_types = [...new Set(mapped)];
      }
    }
  }
  if (call.name === 'hybrid_search') {
    if (rawArgs.k == null && rawArgs.limit != null) {
      rawArgs.k = rawArgs.limit;
    }
    if (Array.isArray(rawArgs.entity_types)) {
      rawArgs.entity_types = rawArgs.entity_types
        .map((value) => String(value || '').trim().toLowerCase())
        .map((value) => {
          if (value === 'person' || value === 'people' || value === 'lead' || value === 'leads') return 'contact';
          if (value === 'account' || value === 'accounts' || value === 'organization' || value === 'org') return 'company';
          return value;
        })
        .filter((value) => value === 'company' || value === 'contact' || value === 'conversation' || value === 'email');
    }
  }

  for (const [k, v] of Object.entries(rawArgs)) {
    if (!(k in props)) continue;
    const schema = props[k] as { type?: string };
    const coerced = coerceArgByType(v, schema?.type);
    if (schema?.type === 'string' && (typeof coerced !== 'string' || !coerced.trim())) {
      continue;
    }
    normalized[k] = coerced;
  }

  // Generic aliasing across tools to improve robustness.
  if (!('company' in normalized) && typeof call.args.company_name === 'string' && 'company' in props) {
    normalized.company = call.args.company_name;
  }
  if (!('company_name' in normalized) && typeof call.args.company === 'string' && 'company_name' in props) {
    normalized.company_name = call.args.company;
  }

  for (const key of required) {
    if (!(key in normalized)) return null;
    const val = normalized[key];
    if (val === null || val === undefined || (typeof val === 'string' && !val.trim())) return null;
  }

  return { name: call.name, args: normalizeToolArgs(call.name, normalized) };
}

export function normalizePlannedCalls(
  calls: ParsedToolCall[],
  userMessage: string,
  _selectedTools: string[]
): { calls: ParsedToolCall[]; notes: string[] } {
  const normalized: ParsedToolCall[] = [];
  const notes: string[] = [];
  const extractEntityHints = (source: string): string[] => {
    const lines = source.split('\n');
    for (const line of lines) {
      const match = line.match(/Top entities:\s*(.+)$/i);
      if (!match) continue;
      return match[1]
        .split('|')
        .map((x) => x.trim())
        .filter(Boolean)
        .slice(0, 6);
    }
    return [];
  };
  const contextEntityHints = extractEntityHints(userMessage);

  for (const raw of calls) {
    const cleaned = sanitizeCallArgs(raw);
    if (!cleaned) {
      notes.push(`Skipped invalid call ${raw.name} because required args were missing after schema validation.`);
      continue;
    }
    if (cleaned.name === 'resolve_entity') {
      const identifier = typeof cleaned.args?.name_or_identifier === 'string' ? cleaned.args.name_or_identifier.trim() : '';
      const genericRoleLookup = /\b(head of marketing|vp marketing|marketing director|cmo)\b/i.test(identifier);
      if (genericRoleLookup) {
        const roleQuery = contextEntityHints.length > 0
          ? `${identifier} at ${contextEntityHints.join(', ')}`
          : identifier;
        normalized.push({
          name: 'hybrid_search',
          args: {
            query: roleQuery,
            entity_types: ['contact'],
            k: 10,
          },
        });
        notes.push(`Rewrote generic resolve_entity role lookup to hybrid_search with contact constraints.`);
        continue;
      }
    }
    if (cleaned.name === 'hybrid_search') {
      const query = typeof cleaned.args?.query === 'string' ? cleaned.args.query.trim() : '';
      const lower = query.toLowerCase();
      if (lower.startsWith('google ') || lower.startsWith('search google for ') || lower.startsWith('search google ')) {
        const stripped =
          lower.startsWith('google ')
            ? query.slice(7).trim()
            : lower.startsWith('search google for ')
              ? query.slice('search google for '.length).trim()
              : query.slice('search google '.length).trim();
        normalized.push({
          name: 'google_search_browser',
          args: {
            query: stripped || query,
            max_results: typeof cleaned.args.k === 'number' ? Math.max(1, Math.min(20, cleaned.args.k)) : 5,
          },
        });
        notes.push('Rewrote explicit Google intent from hybrid_search to google_search_browser.');
        continue;
      }
      const genericRoleLookup = /\b(head of marketing|vp marketing|marketing director|cmo)\b/i.test(query);
      const hasEntityTypes = Array.isArray(cleaned.args?.entity_types) && cleaned.args.entity_types.length > 0;
      if (genericRoleLookup && !hasEntityTypes) {
        cleaned.args = {
          ...cleaned.args,
          query: contextEntityHints.length > 0 ? `${query} at ${contextEntityHints.join(', ')}` : query,
          entity_types: ['contact'],
          k: typeof cleaned.args.k === 'number' ? cleaned.args.k : 10,
        };
        notes.push(`Added contact constraints to generic role lookup hybrid_search call.`);
      }
    }
    normalized.push(cleaned);
  }

  // Browser robustness: fix common planner mistakes without adding site-specific adapters.
  // - browser_snapshot.mode must be "role" or "ai"
  // - browser_act.ref must be a real ref (e.g. "e204" or "12"), not a label like "search field"
  const isBrowserRefStr = (ref: string): boolean => {
    const t = (ref || '').trim();
    if (!t) return false;
    // OpenClaw role refs look like "e204". Local backend may emit numeric refs as strings.
    if (/^e\d+$/i.test(t)) return true;
    if (/^\d+$/.test(t)) return true;
    return false;
  };
  const isBrowserRef = (ref: unknown): ref is string => (typeof ref === 'string' ? isBrowserRefStr(ref) : false);

  const browserFixed: ParsedToolCall[] = [];
  for (const call of normalized) {
    if (call.name === 'browser_snapshot') {
      const mode = typeof call.args?.mode === 'string' ? call.args.mode.trim().toLowerCase() : '';
      if (mode && mode !== 'role' && mode !== 'ai') {
        browserFixed.push({ ...call, args: { ...call.args, mode: 'role' } });
        notes.push(`Normalized browser_snapshot.mode="${mode}" -> "role".`);
        continue;
      }
    }

    if (call.name === 'browser_act') {
      const rawRef = call.args?.ref;
      const action = typeof call.args?.action === 'string' ? call.args.action.trim().toLowerCase() : '';
      const tab_id = typeof call.args?.tab_id === 'string' ? call.args.tab_id : undefined;
      const value = typeof call.args?.value === 'string' ? call.args.value : undefined;

      // If the model tries to "press" with free-form text, convert to type + press Enter.
      // keyboard.press expects a single key/chord, not a query string.
      const looksLikeFreeText =
        typeof value === 'string' &&
        value.trim().length > 1 &&
        (value.includes(' ') || value.length > 12) &&
        !/^(enter|tab|escape|backspace|delete|space|arrow(up|down|left|right)|page(up|down)|home|end|f\d{1,2})$/i.test(value.trim()) &&
        !/^(control\+.+|ctrl\+.+|alt\+.+|shift\+.+|meta\+.+)$/i.test(value.trim());

      if (action === 'press' && looksLikeFreeText) {
        const textValue = typeof value === 'string' ? value.trim() : '';
        const refForTyping = typeof rawRef === 'string' ? rawRef : '';
        // Reuse the existing ref repair logic if ref isn't valid.
        if (!isBrowserRefStr(refForTyping) && refForTyping.trim()) {
          const refTextLower = refForTyping.trim().toLowerCase();
          const isSearchy = refTextLower.includes('search');
          const findArgs: Record<string, unknown> = {
            text: isSearchy ? 'Search' : refForTyping.trim(),
            ...(isSearchy ? { role: 'combobox' } : {}),
            ...(tab_id ? { tab_id } : {}),
          };
          browserFixed.push({ name: 'browser_find_ref', args: findArgs });
          browserFixed.push({
            name: 'browser_act',
            args: { ref: '$prev.ref', action: 'type', value: textValue },
          });
          browserFixed.push({
            name: 'browser_act',
            args: { ref: '$prev.ref', action: 'press', value: 'Enter' },
          });
          notes.push(`Repaired browser_act(action="press", value="${value}") into type + press Enter.`);
          continue;
        }

        // If we have a valid ref already, just rewrite in-place with a follow-up Enter.
        if (isBrowserRef(rawRef)) {
          browserFixed.push({
            name: 'browser_act',
            args: { ...call.args, action: 'type', value: textValue },
          });
          browserFixed.push({
            name: 'browser_act',
            args: { ref: rawRef, action: 'press', value: 'Enter', ...(tab_id ? { tab_id } : {}) },
          });
          notes.push(`Repaired browser_act(action="press", value="${value}") into type + press Enter.`);
          continue;
        }
      }

      if (!isBrowserRef(rawRef) && typeof rawRef === 'string' && rawRef.trim()) {
        // If the model provided a label instead of a ref, insert a find_ref step.
        // Heuristic: for typing into a search field, "Search" + role=combobox is a strong generic prior.
        const refTextLower = rawRef.trim().toLowerCase();
        const isSearchy = refTextLower.includes('search') && (action === 'type' || action === 'fill');
        const findArgs: Record<string, unknown> = {
          text: isSearchy ? 'Search' : rawRef.trim(),
          ...(isSearchy ? { role: 'combobox' } : {}),
          ...(tab_id ? { tab_id } : {}),
        };
        browserFixed.push({ name: 'browser_find_ref', args: findArgs });
        browserFixed.push({
          ...call,
          args: { ...call.args, ref: '$prev.ref' },
        });
        notes.push(`Repaired browser_act(ref="${rawRef}") by inserting browser_find_ref and using $prev.ref.`);
        continue;
      }
    }

    browserFixed.push(call);
  }

  const mergeableTools = new Set(['search_companies', 'search_contacts']);
  const hasExplicitOrIntent = userMessage.toLowerCase().includes(' or ');
  if (hasExplicitOrIntent) {
    return { calls: browserFixed, notes };
  }

  const merged: ParsedToolCall[] = [];
  for (const call of browserFixed) {
    const prev = merged[merged.length - 1];
    if (!prev || prev.name !== call.name || !mergeableTools.has(call.name)) {
      merged.push(call);
      continue;
    }

    const prevArgs = prev.args || {};
    const nextArgs = call.args || {};
    const prevKeys = Object.keys(prevArgs);
    const nextKeys = Object.keys(nextArgs);
    const overlap = nextKeys.filter((k) => prevKeys.includes(k));
    const compatibleOverlap = overlap.every((k) => JSON.stringify(prevArgs[k]) === JSON.stringify(nextArgs[k]));
    if (!compatibleOverlap) {
      merged.push(call);
      continue;
    }

    prev.args = { ...prevArgs, ...nextArgs };
    notes.push(`Merged adjacent ${call.name} calls into one combined filter call.`);
  }

  return { calls: merged, notes };
}

export function buildPlanRationale(
  _userMessage: string,
  plannedCalls: ParsedToolCall[],
  normalizationNotes: string[]
): string[] {
  const notes: string[] = [];
  for (const call of plannedCalls) {
    const argKeys = Object.keys(call.args || {}).filter((k) => {
      const v = call.args[k];
      if (typeof v === 'string') return Boolean(v.trim());
      return v !== undefined && v !== null;
    });
    if (argKeys.length > 0) {
      notes.push(`Prepared ${call.name} with ${argKeys.join(', ')} filters.`);
    } else {
      notes.push(`Prepared ${call.name} without extra filters.`);
    }
  }
  notes.push(...normalizationNotes);

  if (notes.length === 0) {
    notes.push('Selected tools based on intent and schema-compatible arguments.');
  }
  return notes;
}
