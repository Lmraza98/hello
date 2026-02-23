/**
 * Skill loader: parses SKILL.md YAML frontmatter into SkillDefinition objects.
 *
 * In the browser environment, we can't read files from disk at runtime.
 * Instead, skills are registered at build time via static imports.
 * This loader provides the parsing utility + the init function that
 * registers all built-in skills.
 */

import type { SkillDefinition, SkillExtractField, ConfirmationPolicy } from '../domain/types';
import { registerSkill } from './registry';
import { campaignCreateAndEnrollHandler } from './handlers/campaignCreateAndEnroll';
import { prospectCompaniesAndDraftEmailsHandler } from './handlers/prospectCompaniesAndDraftEmails';

/**
 * Parse YAML-ish frontmatter from a SKILL.md string.
 * Simple parser — handles the subset we use (scalars, lists, nested objects).
 */
export function parseFrontmatter(raw: string): { meta: Record<string, unknown>; body: string } {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { meta: {}, body: raw };

  const yamlBlock = match[1] || '';
  const body = (match[2] || '').trim();
  const meta: Record<string, unknown> = {};

  let currentKey = '';
  let currentList: unknown[] | null = null;

  for (const line of yamlBlock.split('\n')) {
    const trimmed = line.trimEnd();

    // List item (indented with -)
    if (/^\s+-\s+/.test(trimmed) && currentList) {
      const value = trimmed.replace(/^\s+-\s+/, '').trim().replace(/^["']|["']$/g, '');
      // Check if it's a map item (key: value)
      const mapMatch = value.match(/^(\w+):\s*(.+)$/);
      if (mapMatch) {
        // Nested object in list
        const last = currentList[currentList.length - 1];
        if (last && typeof last === 'object' && !Array.isArray(last)) {
          (last as Record<string, unknown>)[mapMatch[1]] = parseValue(mapMatch[2]);
        } else {
          const obj: Record<string, unknown> = { [mapMatch[1]]: parseValue(mapMatch[2]) };
          currentList.push(obj);
        }
      } else {
        currentList.push(parseValue(value));
      }
      continue;
    }

    // Nested key-value under a list item
    if (/^\s{4,}\w+:/.test(trimmed) && currentList) {
      const kvMatch = trimmed.trim().match(/^(\w+):\s*(.*)$/);
      if (kvMatch) {
        let last = currentList[currentList.length - 1];
        if (!last || typeof last !== 'object' || Array.isArray(last)) {
          last = {};
          currentList.push(last);
        }
        (last as Record<string, unknown>)[kvMatch[1]] = parseValue(kvMatch[2] || '');
      }
      continue;
    }

    // Top-level key: value
    const kvMatch = trimmed.match(/^(\w[\w_]*)\s*:\s*(.*)$/);
    if (kvMatch) {
      currentKey = kvMatch[1];
      const value = kvMatch[2].trim();
      if (value === '' || value === '|') {
        // Start of a list or multiline — will be populated by subsequent lines
        currentList = [];
        meta[currentKey] = currentList;
      } else {
        currentList = null;
        meta[currentKey] = parseValue(value);
      }
    }
  }

  return { meta, body };
}

function parseValue(raw: string): unknown {
  const trimmed = raw.trim().replace(/^["']|["']$/g, '');
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (trimmed === 'null' || trimmed === '') return null;
  const num = Number(trimmed);
  if (!Number.isNaN(num) && trimmed !== '') return num;
  return trimmed;
}

/**
 * Convert parsed frontmatter into a SkillDefinition.
 */
export function metaToSkillDefinition(id: string, meta: Record<string, unknown>, body: string): SkillDefinition {
  const toStringArray = (val: unknown): string[] => {
    if (Array.isArray(val)) return val.map(String).filter(Boolean);
    return [];
  };

  const toExtractFields = (val: unknown): SkillExtractField[] => {
    if (!Array.isArray(val)) return [];
    return val
      .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
      .map((item) => ({
        name: String(item.name || ''),
        description: String(item.description || ''),
        type: (item.type as 'string' | 'number' | 'boolean') || 'string',
        required: item.required === true,
        default: item.default,
      }))
      .filter((f) => f.name);
  };

  return {
    id,
    name: String(meta.name || id),
    description: String(meta.description || ''),
    version: typeof meta.version === 'number' ? meta.version : 1,
    tags: toStringArray(meta.tags),
    triggerPatterns: toStringArray(meta.trigger_patterns),
    allowedTools: toStringArray(meta.allowed_tools),
    extractFields: toExtractFields(meta.extract_fields),
    confirmationPolicy: (['ask_every', 'ask_writes', 'auto'].includes(String(meta.confirmation_policy))
      ? String(meta.confirmation_policy)
      : 'ask_writes') as ConfirmationPolicy,
    body,
  };
}

// ── Built-in skill SKILL.md content ─────────────────────────
// Imported as raw strings at build time (Vite handles `?raw` imports).
// If raw import isn't available, we inline the frontmatter here.

const CAMPAIGN_CREATE_AND_ENROLL_META: Record<string, unknown> = {
  name: 'campaign-create-and-enroll',
  description: 'Create an email campaign and enroll contacts matching an industry/vertical filter',
  version: 1,
  tags: ['campaign', 'enrollment', 'bulk'],
  trigger_patterns: [
    'create campaign',
    'create an email campaign',
    'new campaign',
    'sequence targeting',
    'and add contacts',
    'and enroll',
    'targeting {industry}',
    'campaign targeting',
    'campaign for {industry}',
    'add {industry} contacts',
  ],
  allowed_tools: [
    'create_campaign',
    'enroll_contacts_by_filter',
    'list_campaigns',
    'get_campaign',
    'list_filter_values',
  ],
  extract_fields: [
    { name: 'industry', description: 'Industry/vertical keyword', type: 'string', required: true },
    { name: 'campaign_name', description: 'Campaign name', type: 'string', required: false },
    { name: 'num_emails', description: 'Number of emails', type: 'number', required: false },
    { name: 'days_between_emails', description: 'Days between emails', type: 'number', required: false },
  ],
  confirmation_policy: 'ask_writes',
};

const PROSPECT_COMPANIES_AND_DRAFT_EMAILS_META: Record<string, unknown> = {
  name: 'prospect-companies-and-draft-emails',
  description: 'Discover target companies, find heads of marketing, draft intros, and schedule email send time',
  version: 1,
  tags: ['prospecting', 'research', 'email', 'scheduling'],
  trigger_patterns: [
    'find {company_count} companies',
    'identify key decision-makers',
    'decision-makers for companies',
    'head of marketing at each company',
    'create a personalized email outreach campaign',
    'personalized email outreach campaign',
    'draft a personalized introductory email',
    'schedule it to send {days_from_now} days from now',
    'raised series b funding',
    'fintech space',
    'revenue of over',
    'based in',
    'been in business for at least',
  ],
  allowed_tools: [
    'search_companies',
    'search_contacts',
    'collect_companies_from_salesnav',
    'browser_search_and_extract',
    'compound_workflow_run',
    'create_campaign',
    'enroll_contacts_by_filter',
    'prepare_email_batch',
    'approve_campaign_review_queue',
    'reschedule_campaign_emails',
    'get_scheduled_emails',
  ],
  extract_fields: [
    { name: 'company_count', description: 'How many companies to find', type: 'number', required: false, default: 5 },
    { name: 'industry', description: 'Target industry keyword', type: 'string', required: false, default: 'fintech' },
    { name: 'location', description: 'Target location', type: 'string', required: false, default: 'New York City' },
    { name: 'decision_maker_title', description: 'Target decision-maker role/title', type: 'string', required: false, default: 'Head of Marketing' },
    { name: 'min_revenue_millions', description: 'Minimum company revenue in millions USD', type: 'number', required: false, default: 100 },
    { name: 'min_years_in_business', description: 'Minimum years in business', type: 'number', required: false, default: 5 },
    { name: 'funding_stage', description: 'Funding stage (for example Series B)', type: 'string', required: false, default: 'Series B' },
    { name: 'specific_service', description: 'Service value proposition to mention', type: 'string', required: false },
    { name: 'days_from_now', description: 'Days from now to schedule sending', type: 'number', required: false, default: 3 },
  ],
  confirmation_policy: 'ask_writes',
};

/**
 * Register all built-in skills.  Call once at app startup.
 */
export function registerBuiltinSkills(): void {
  const def = metaToSkillDefinition(
    'campaign-create-and-enroll',
    CAMPAIGN_CREATE_AND_ENROLL_META,
    ''
  );
  registerSkill(def, campaignCreateAndEnrollHandler);

  const prospectDef = metaToSkillDefinition(
    'prospect-companies-and-draft-emails',
    PROSPECT_COMPANIES_AND_DRAFT_EMAILS_META,
    ''
  );
  registerSkill(prospectDef, prospectCompaniesAndDraftEmailsHandler);
}
