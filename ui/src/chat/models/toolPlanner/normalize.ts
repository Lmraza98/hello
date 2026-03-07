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
  selectedTools: string[] = []
): { calls: ParsedToolCall[]; notes: string[]; clarificationQuestion?: string } {
  const normalized: ParsedToolCall[] = [];
  const notes: string[] = [];
  const lowerMsg = (userMessage || '').toLowerCase();
  const isDocumentIntent =
    /\b(document|documents|doc|docx|pdf|file|files|attachment|attachments|uploaded|upload)\b/.test(lowerMsg) ||
    /\b\w+\.(pdf|docx|csv|txt)\b/.test(lowerMsg);
  const hasExplicitDocumentReference =
    /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i.test(userMessage) ||
    /\b\w+\.(pdf|docx|csv|txt)\b/i.test(userMessage);
  const extractDocumentIdsFromContext = (source: string): string[] => {
    const matches = source.match(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi) || [];
    return [...new Set(matches.map((m) => m.toLowerCase()))].slice(0, 20);
  };
  const contextDocumentIds = extractDocumentIdsFromContext(userMessage);
  const truncatePeopleKeyword = (value: unknown): string => {
    if (typeof value !== 'string') return '';
    const trimmed = value.trim();
    if (!trimmed) return '';
    const token = trimmed.split(/\s+/)[0] || '';
    return token.trim();
  };
  const normalizeCompoundPeopleQueries = (spec: unknown): { next: unknown; changed: boolean } => {
    if (!spec || typeof spec !== 'object' || Array.isArray(spec)) return { next: spec, changed: false };
    const specRec = { ...(spec as Record<string, unknown>) };
    const rawPhases = Array.isArray(specRec.phases) ? (specRec.phases as unknown[]) : [];
    let changed = false;
    const phases = rawPhases.map((phase) => {
      if (!phase || typeof phase !== 'object' || Array.isArray(phase)) return phase;
      const phaseRec = { ...(phase as Record<string, unknown>) };
      const operation = phaseRec.operation;
      const opRec = operation && typeof operation === 'object' && !Array.isArray(operation)
        ? (operation as Record<string, unknown>)
        : null;
      const task = typeof opRec?.task === 'string' ? opRec.task : '';
      if (task !== 'salesnav_people_search') return phaseRec;
      const templates = phaseRec.param_templates;
      if (!templates || typeof templates !== 'object' || Array.isArray(templates)) return phaseRec;
      const templateRec = { ...(templates as Record<string, unknown>) };
      const compactQuery = truncatePeopleKeyword(templateRec.query);
      if (compactQuery !== (templateRec.query ?? '')) {
        templateRec.query = compactQuery;
        changed = true;
      }
      phaseRec.param_templates = templateRec;
      return phaseRec;
    });
    specRec.phases = phases;
    return { next: specRec, changed };
  };
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
  const selectedToolSet = new Set((selectedTools || []).map((tool) => String(tool)));
  const salesNavMentioned = /\b(sales\s*navigator|salesnav|linkedin)\b/i.test(userMessage);
  const hasBrowserSessionSalesNavContext = /\[BROWSER_SESSION\][\s\S]*linkedin\.com\/sales/i.test(userMessage);
  const salesNavWorkflowAvailable = selectedToolSet.has('browser_search_and_extract') || selectedToolSet.has('browser_list_sub_items');
  const impliedPeopleAtCompanyLookup =
    /\b(employee|employees|people|contacts?|leads?|profiles?)\b/i.test(userMessage) &&
    /\b(of|at)\b/i.test(userMessage) &&
    /\b(details?|contact details|email|emails|phone|phones|title|titles|decision makers?)\b/i.test(userMessage);
  const inferSalesNavTask = (source: string): 'salesnav_search_account' | 'salesnav_people_search' => {
    const lower = source.toLowerCase();
    if (/\b(company|companies|account|accounts|organization|organisations|org|firms|businesses)\b/.test(lower)) {
      return 'salesnav_search_account';
    }
    if (/\b(person|people|lead|leads|contact|contacts|profile|profiles|employee|employees|founder|ceo|cmo|vp|director|head of|manager)\b/.test(lower)) {
      return 'salesnav_people_search';
    }
    return 'salesnav_people_search';
  };
  const stripSalesNavPhrases = (source: string): string => {
    const cleaned = source
      .replace(/\bon\s+(linkedin\s+)?sales\s*navigator\b/gi, ' ')
      .replace(/\bon\s+linkedin\b/gi, ' ')
      .replace(/\busing\s+(linkedin\s+)?sales\s*navigator\b/gi, ' ')
      .replace(/\b(in|from)\s+salesnav\b/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return cleaned || source.trim();
  };
  const extractCompanyFromEmployeeLookup = (source: string): string => {
    const cleaned = stripSalesNavPhrases(source)
      .replace(/\bfind\s+contact\s+details\s+for\b/gi, ' ')
      .replace(/\bcontact\s+details\b/gi, ' ')
      .replace(/\bdetails\b/gi, ' ')
      .replace(/\bfind\b/gi, ' ')
      .replace(/\bshow\b/gi, ' ')
      .replace(/\bget\b/gi, ' ')
      .replace(/\blist\b/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const match = cleaned.match(/\b(?:employees|people|contacts?|leads?|profiles?)\s+(?:of|at)\s+(.+)$/i);
    if (!match) return '';
    return match[1].replace(/[?.!]+$/g, '').trim();
  };
  const employeeLookupCompany = impliedPeopleAtCompanyLookup ? extractCompanyFromEmployeeLookup(userMessage) : '';
  const hasExplicitContactLimit = /\b\d{1,3}\b/.test(userMessage);
  const requestedDetailKinds = [
    /\blinkedin\b/i.test(userMessage) ? 'LinkedIn URL' : '',
    /\btitle|titles\b/i.test(userMessage) ? 'title' : '',
    /\bemail|emails\b/i.test(userMessage) ? 'email' : '',
    /\bphone|phones|mobile|direct dial\b/i.test(userMessage) ? 'phone' : '',
  ].filter(Boolean);
  const needsEmployeeLookupClarification =
    Boolean(employeeLookupCompany) &&
    /\bdetails?|contact details\b/i.test(userMessage) &&
    (!hasExplicitContactLimit || requestedDetailKinds.length === 0);

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
      const entityTypes = Array.isArray(cleaned.args?.entity_types)
        ? cleaned.args.entity_types.map((v) => String(v).toLowerCase())
        : [];
      if (isDocumentIntent && (entityTypes.length === 0 || entityTypes.includes('company') || entityTypes.includes('file_chunk'))) {
        normalized.push({
          name: 'ask_documents',
          args: {
            question: query || userMessage,
            limit_chunks: typeof cleaned.args.k === 'number' ? cleaned.args.k : 5,
          },
        });
        notes.push('Rewrote document-intent hybrid_search to ask_documents.');
        continue;
      }
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
    if (cleaned.name === 'search_documents') {
      const query = typeof cleaned.args?.query === 'string' ? cleaned.args.query.trim() : '';
      const contentLikeQuery =
        /\b(content|contents|what(?:'s| is)\s+in|full\s+text|tell me about|summarize|summary)\b/i.test(query) ||
        /\bthose documents\b/i.test(lowerMsg);
      if (isDocumentIntent && contentLikeQuery) {
        const nextArgs: Record<string, unknown> = {
          question: query || userMessage,
          limit_chunks: 6,
        };
        if (contextDocumentIds.length > 0) {
          nextArgs.document_ids = contextDocumentIds;
        }
        normalized.push({ name: 'ask_documents', args: nextArgs });
        notes.push('Rewrote content-style search_documents call to ask_documents (with context document_ids when available).');
        continue;
      }
    }
    if (cleaned.name === 'compound_workflow_run') {
      const spec = cleaned.args?.spec;
      if (isDocumentIntent) {
        const phases = spec && typeof spec === 'object' && !Array.isArray(spec)
          ? ((spec as Record<string, unknown>).phases as unknown[])
          : [];
        if (!Array.isArray(phases) || phases.length === 0) {
          notes.push('Dropped empty compound workflow for document-intent query.');
          continue;
        }
      }
      const normalizedSpec = normalizeCompoundPeopleQueries(spec);
      if (normalizedSpec.changed) {
        cleaned.args = {
          ...(cleaned.args || {}),
          spec: normalizedSpec.next,
        };
        notes.push('Normalized compound workflow SalesNav people-search queries to concise keyword input.');
      }
    }

    if (cleaned.name === 'ask_documents') {
      const existingDocIds = Array.isArray(cleaned.args?.document_ids) ? cleaned.args.document_ids : [];
      if (isDocumentIntent && !hasExplicitDocumentReference && existingDocIds.length > 0) {
        const nextArgs = { ...(cleaned.args || {}) } as Record<string, unknown>;
        delete nextArgs.document_ids;
        cleaned.args = nextArgs;
        notes.push('Removed implicit ask_documents document_ids because no explicit document reference was provided.');
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
    // LeadPilot role refs look like "e204". Local backend may emit numeric refs as strings.
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

  const hasStructuredSalesNavCall = browserFixed.some((call) =>
    call.name === 'browser_search_and_extract' || call.name === 'browser_list_sub_items'
  );
  const hasRawSalesNavLoop = browserFixed.some((call) => {
    if (!call.name.startsWith('browser_')) return false;
    if (!['browser_navigate', 'browser_snapshot', 'browser_find_ref', 'browser_act', 'browser_wait'].includes(call.name)) return false;
    const url = typeof call.args?.url === 'string' ? call.args.url.toLowerCase() : '';
    const text = typeof call.args?.text === 'string' ? call.args.text.toLowerCase() : '';
    const ref = typeof call.args?.ref === 'string' ? call.args.ref.toLowerCase() : '';
    const value = typeof call.args?.value === 'string' ? call.args.value.toLowerCase() : '';
    return url.includes('linkedin.com/sales') || text.includes('search') || ref.includes('search') || value.includes('linkedin');
  });
  const shouldForceSalesNavRewrite =
    !hasStructuredSalesNavCall &&
    hasRawSalesNavLoop &&
    (salesNavMentioned || hasBrowserSessionSalesNavContext || (salesNavWorkflowAvailable && impliedPeopleAtCompanyLookup));
  if (shouldForceSalesNavRewrite) {
    const preservedPrefix = browserFixed.filter((call) => call.name === 'browser_health' || call.name === 'browser_tabs');
    const navigateCall = browserFixed.find((call) => call.name === 'browser_navigate' && typeof call.args?.url === 'string');
    const browserTypeCall = browserFixed.find((call) =>
      call.name === 'browser_act' &&
      typeof call.args?.action === 'string' &&
      ['type', 'fill'].includes(String(call.args.action).toLowerCase()) &&
      typeof call.args?.value === 'string' &&
      String(call.args.value).trim().length > 0
    );
    const task = inferSalesNavTask(userMessage);
    const query = stripSalesNavPhrases(
      typeof browserTypeCall?.args?.value === 'string' && browserTypeCall.args.value.trim()
        ? browserTypeCall.args.value
        : userMessage
    );
    const tabId =
      (typeof browserTypeCall?.args?.tab_id === 'string' && browserTypeCall.args.tab_id) ||
      (typeof navigateCall?.args?.tab_id === 'string' && navigateCall.args.tab_id) ||
      undefined;
    browserFixed.length = 0;
    browserFixed.push(
      ...preservedPrefix,
      {
        name: 'browser_search_and_extract',
        args: {
          task,
          query,
          ...(tabId ? { tab_id: tabId } : {}),
          limit: 25,
        },
      }
    );
    notes.push(`Rewrote raw SalesNav browser loop to browser_search_and_extract(${task}) so the backend URL builder handles the search flow.`);
  }

  const shouldForceEmployeeListFlow =
    employeeLookupCompany &&
    (salesNavMentioned || hasBrowserSessionSalesNavContext) &&
    salesNavWorkflowAvailable;
  if (needsEmployeeLookupClarification) {
    return {
      calls: [],
      notes: [
        ...notes,
        `Held SalesNav employee lookup for ${employeeLookupCompany} because the request did not specify count and/or concrete detail fields.`,
      ],
      clarificationQuestion: `How many contacts do you want from ${employeeLookupCompany}, and which details should I collect: LinkedIn URL, title, email, or phone?`,
    };
  }
  if (shouldForceEmployeeListFlow) {
    const preservedPrefix = browserFixed.filter((call) => call.name === 'browser_health' || call.name === 'browser_tabs');
    browserFixed.length = 0;
    browserFixed.push(
      ...preservedPrefix,
      {
        name: 'browser_list_sub_items',
        args: {
          task: 'salesnav_list_employees',
          parent_query: employeeLookupCompany,
          parent_task: 'salesnav_search_account',
          entrypoint_action: 'entrypoint',
          extract_type: 'lead',
          limit: 25,
        },
      }
    );
    notes.push(`Rewrote SalesNav employee-at-company request to a single browser_list_sub_items flow for ${employeeLookupCompany}.`);
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
