/**
 * Structured step context for multi-step task execution.
 *
 * This is used to pass compact tool-result summaries between TaskStep executions,
 * and must preserve serialization format and the user-visible "IMPORTANT" block.
 */

import type { TaskStep } from '../chatEngineTypes';

export type StepContextEntry = {
  stepId: string;
  stepIntent: string;
  toolResults: Array<{ name: string; ok: boolean; result?: unknown }>;
};

const STEP_CONTEXT_PREFIX = '__STEP_CTX__';

/** Serialize StepContextEntry[] -> string[] for PendingTaskPlan.contextSnippets */
export function serializeStepContext(entries: StepContextEntry[]): string[] {
  return entries.map((e) => `${STEP_CONTEXT_PREFIX}${JSON.stringify(e)}`);
}

/** Deserialize string[] (contextSnippets) back to StepContextEntry[] */
export function deserializeStepContext(snippets: string[]): StepContextEntry[] {
  const out: StepContextEntry[] = [];
  for (const s of snippets) {
    if (s.startsWith(STEP_CONTEXT_PREFIX)) {
      try {
        const parsed = JSON.parse(s.slice(STEP_CONTEXT_PREFIX.length)) as StepContextEntry;
        if (parsed.stepId && Array.isArray(parsed.toolResults)) {
          out.push(parsed);
        }
      } catch {
        // Skip malformed entries
      }
    }
  }
  return out;
}

/**
 * Extract a compact structured summary from a tool result - pull out IDs,
 * names, counts, and other key fields that downstream steps need.
 */
export function summarizeToolResult(toolName: string, ok: boolean, result: unknown): string {
  if (!ok) return 'FAILED';
  if (!result || typeof result !== 'object') return JSON.stringify(result ?? null).slice(0, 300);

  const obj = result as Record<string, unknown>;

  // Campaign creation -> extract campaign id + name
  if (toolName === 'create_campaign') {
    const id = obj.id ?? obj.campaign_id;
    const name = obj.name ?? obj.title ?? '';
    const existed = obj.already_existed ? ' (already existed)' : '';
    return id != null ? `campaign_id=${id}, name="${name}"${existed}` : JSON.stringify(obj).slice(0, 300);
  }

  // Contact/entity search -> extract IDs array + count + top labels.
  if (toolName === 'search_contacts' || toolName === 'hybrid_search' || toolName === 'search_companies') {
    const rows = Array.isArray(result)
      ? result
      : Array.isArray(obj.results)
        ? obj.results
        : Array.isArray(obj.items)
          ? obj.items
          : [];
    const ids = rows
      .slice(0, 200)
      .map((row) => {
        if (!row || typeof row !== 'object') return null;
        const r = row as Record<string, unknown>;
        return r.id ?? r.entity_id ?? r.contact_id ?? null;
      })
      .filter((id) => id != null);
    const count = rows.length;
    if (ids.length > 0) {
      const idList = ids.length <= 20
        ? ids.join(', ')
        : `${ids.slice(0, 20).join(', ')} ... (${ids.length} total)`;
      const names = rows
        .slice(0, 8)
        .map((row) => {
          if (!row || typeof row !== 'object') return null;
          const r = row as Record<string, unknown>;
          const title = r.title ?? r.name ?? r.company_name ?? r.company;
          return typeof title === 'string' && title.trim().length > 0 ? title.trim() : null;
        })
        .filter((x): x is string => Boolean(x));
      if (names.length > 0) {
        return `Found ${count} result(s). IDs: [${idList}]. Top entities: ${names.slice(0, 5).join(' | ')}`;
      }
      return `Found ${count} result(s). IDs: [${idList}]`;
    }
    return `Found ${count} result(s).`;
  }

  // Enrollment -> extract count
  if (toolName === 'enroll_contacts_in_campaign' || toolName === 'enroll_contacts_by_filter') {
    const enrolled = obj.enrolled_count ?? obj.enrolled ?? obj.count ?? 'unknown';
    const skipped = obj.skipped ?? 0;
    const matched = obj.total_matched;
    const parts = [`Enrolled ${enrolled} contact(s)`];
    if (skipped) parts.push(`skipped ${skipped}`);
    if (matched != null) parts.push(`${matched} matched filter`);
    return parts.join(', ') + '.';
  }

  // Generic: compact JSON
  return JSON.stringify(obj).slice(0, 400);
}

function extractContextEntityHints(
  structuredContext: StepContextEntry[],
  step: TaskStep
): string[] {
  const sourceEntries = step.dependsOn.length > 0
    ? structuredContext.filter((entry) => step.dependsOn.includes(entry.stepId))
    : structuredContext;
  const hints = new Set<string>();
  for (const entry of sourceEntries) {
    for (const tr of entry.toolResults) {
      if (!tr.ok || !tr.result || typeof tr.result !== 'object') continue;
      const obj = tr.result as Record<string, unknown>;
      const rows = Array.isArray(tr.result)
        ? tr.result
        : Array.isArray(obj.results)
          ? obj.results
          : Array.isArray(obj.items)
            ? obj.items
            : [];
      for (const row of rows.slice(0, 20)) {
        if (!row || typeof row !== 'object') continue;
        const r = row as Record<string, unknown>;
        const label = r.title ?? r.name ?? r.company_name ?? r.company;
        if (typeof label !== 'string' || !label.trim()) continue;
        hints.add(label.trim());
      }
    }
  }
  return [...hints].slice(0, 8);
}

export function buildStepMessage(step: TaskStep, structuredContext: StepContextEntry[]): string {
  if (structuredContext.length === 0) return step.intent;

  const sourceEntries = step.dependsOn.length > 0
    ? structuredContext.filter((entry) => step.dependsOn.includes(entry.stepId))
    : structuredContext;

  const lines: string[] = [];
  for (const entry of sourceEntries.slice(-4)) {
    for (const tr of entry.toolResults) {
      const summary = summarizeToolResult(tr.name, tr.ok, tr.result);
      lines.push(`- ${entry.stepId} (${tr.name}): ${summary}`);
    }
  }

  if (lines.length === 0) return step.intent;

  const dependencyGuard = step.dependsOn.length > 0
    ? `STRICT: This step depends on ${step.dependsOn.join(', ')}. Reuse only those entities/IDs. Do not run generic broad queries without those constraints.\n\n`
    : '';
  const entityHints = extractContextEntityHints(structuredContext, step);
  const hintBlock = entityHints.length > 0
    ? `Entity hints from prior steps: ${entityHints.join(' | ')}\n\n`
    : '';
  const contextBlock =
    `IMPORTANT - Results from previous steps (use these values for your tool call arguments):\n` +
    lines.join('\n');
  return `${step.intent}\n\n${dependencyGuard}${hintBlock}${contextBlock}`;
}
