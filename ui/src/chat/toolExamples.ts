import type { ToolDefinition } from './chatEngineTypes';

export type ToolCallExample = {
  user: string;
  calls: Array<{ name: string; args: Record<string, unknown> }>;
};

const TOOL_EXAMPLE_OVERRIDES_KEY = 'chat_tool_example_overrides_v1';

export const PLANNER_TOOL_USAGE_RULES = [
  'You MUST call a tool for every actionable request. Never say "I cannot assist."',
  'Extract names, companies, and filters from natural language. Do NOT invent args the user did not mention.',
  'If the user does not mention a company, do NOT add one.',
  'Each tool call must be based on the CURRENT user message only.',
  'Find [person] defaults to resolve_entity or hybrid_search unless user explicitly says SalesNav/LinkedIn person search.',
  'Find [industry] companies defaults to search_companies using q or vertical, never tier.',
  'Use collect_companies_from_salesnav only for explicit scraping/collection requests, not for simple navigation.',
  'For website navigation/interaction, use browser_* tools (health/tabs/navigate/snapshot/find_ref/act/wait/screenshot/salesnav_search_account) rather than scrape tools.',
  'Send email to [person] starts with hybrid_search as step 1.',
  'Add [person] to campaign starts with hybrid_search as step 1.',
].join('\n');

const CURATED_EXAMPLES: Record<string, ToolCallExample[]> = {
  search_contacts: [
    { user: 'Find Lucas Raza', calls: [{ name: 'search_contacts', args: { name: 'Lucas Raza' } }] },
    { user: 'Find Keven Fuertes from RussElectric', calls: [{ name: 'search_contacts', args: { name: 'Keven Fuertes', company: 'RussElectric' } }] },
    { user: 'show me contacts at RussElectric', calls: [{ name: 'search_contacts', args: { company: 'RussElectric' } }] },
    { user: 'find contacts with emails', calls: [{ name: 'search_contacts', args: { has_email: true } }] },
    { user: "show me today's new contacts", calls: [{ name: 'search_contacts', args: { today_only: true } }] },
  ],
  search_companies: [
    { user: 'Find construction companies', calls: [{ name: 'search_companies', args: { q: 'construction' } }] },
    { user: 'Show me vet clinics in New Hampshire', calls: [{ name: 'search_companies', args: { q: 'vet clinics New Hampshire' } }] },
    { user: 'find companies in the banking industry', calls: [{ name: 'search_companies', args: { q: 'banking' } }] },
    { user: 'Find Zco Corporation', calls: [{ name: 'search_companies', args: { company_name: 'Zco Corporation' } }] },
    { user: 'Show me all Tier A companies', calls: [{ name: 'search_companies', args: { tier: 'A' } }] },
  ],
  collect_companies_from_salesnav: [
    { user: 'search salesnavigator for construction companies in nebraska', calls: [{ name: 'collect_companies_from_salesnav', args: { query: 'construction companies in nebraska' } }] },
    { user: 'Find construction on LinkedIn SalesNavigator in New England', calls: [{ name: 'collect_companies_from_salesnav', args: { query: 'construction companies in New England' } }] },
    { user: 'search salesnav for tech companies in Boston', calls: [{ name: 'collect_companies_from_salesnav', args: { query: 'tech companies in Boston' } }] },
    { user: 'Find me smallish companies like Zco Corporation', calls: [{ name: 'collect_companies_from_salesnav', args: { query: 'small software development companies similar to Zco Corporation' } }] },
  ],
  salesnav_person_search: [
    { user: 'search for John Smith on sales navigator', calls: [{ name: 'salesnav_person_search', args: { first_name: 'John', last_name: 'Smith' } }] },
    { user: 'find Randy Peterson on LinkedIn', calls: [{ name: 'salesnav_person_search', args: { first_name: 'Randy', last_name: 'Peterson' } }] },
    { user: 'look up Lucas Raza on salesnav at Zco', calls: [{ name: 'salesnav_person_search', args: { first_name: 'Lucas', last_name: 'Raza', company: 'Zco' } }] },
  ],
  list_campaigns: [
    { user: 'show me our campaigns', calls: [{ name: 'list_campaigns', args: {} }] },
    { user: 'what campaigns are active', calls: [{ name: 'list_campaigns', args: { status: 'active' } }] },
    { user: 'list draft campaigns', calls: [{ name: 'list_campaigns', args: { status: 'draft' } }] },
  ],
  create_campaign: [
    { user: 'create an email campaign', calls: [{ name: 'create_campaign', args: { name: 'New Campaign' } }] },
    { user: 'create a campaign called Q1 Outreach', calls: [{ name: 'create_campaign', args: { name: 'Q1 Outreach' } }] },
    { user: 'set up a new campaign for construction companies with 5 emails', calls: [{ name: 'create_campaign', args: { name: 'Construction Outreach', num_emails: 5 } }] },
  ],
  activate_campaign: [
    { user: 'start sending for campaign 7', calls: [{ name: 'activate_campaign', args: { campaign_id: 7 } }] },
    { user: 'activate campaign 3', calls: [{ name: 'activate_campaign', args: { campaign_id: 3 } }] },
  ],
  pause_campaign: [
    { user: 'pause campaign 3', calls: [{ name: 'pause_campaign', args: { campaign_id: 3 } }] },
    { user: 'stop campaign 7', calls: [{ name: 'pause_campaign', args: { campaign_id: 7 } }] },
  ],
  enroll_contacts_in_campaign: [
    { user: 'Yes, enroll them in campaign 5', calls: [{ name: 'enroll_contacts_in_campaign', args: { campaign_id: 5, contact_ids: [2976, 2974] } }] },
    { user: 'enroll these contacts in campaign 3', calls: [{ name: 'enroll_contacts_in_campaign', args: { campaign_id: 3, contact_ids: [2976] } }] },
  ],
  get_campaign: [
    { user: 'show campaign 3', calls: [{ name: 'get_campaign', args: { campaign_id: 3 } }] },
    { user: 'open campaign 7', calls: [{ name: 'get_campaign', args: { campaign_id: 7 } }] },
  ],
  get_campaign_contacts: [
    { user: 'show contacts in campaign 3', calls: [{ name: 'get_campaign_contacts', args: { campaign_id: 3 } }] },
    { user: 'who is in campaign 7', calls: [{ name: 'get_campaign_contacts', args: { campaign_id: 7 } }] },
  ],
  get_campaign_stats: [
    { user: 'campaign 3 stats', calls: [{ name: 'get_campaign_stats', args: { campaign_id: 3 } }] },
    { user: 'show stats for campaign 7', calls: [{ name: 'get_campaign_stats', args: { campaign_id: 7 } }] },
  ],
  get_email_dashboard_metrics: [
    { user: 'how are our emails performing', calls: [{ name: 'get_email_dashboard_metrics', args: {} }] },
    { user: "what's our reply rate", calls: [{ name: 'get_email_dashboard_metrics', args: {} }] },
  ],
  get_review_queue: [
    { user: 'show me emails waiting for review', calls: [{ name: 'get_review_queue', args: {} }] },
    { user: 'what emails are pending approval', calls: [{ name: 'get_review_queue', args: {} }] },
  ],
  approve_email: [
    { user: 'approve email 5', calls: [{ name: 'approve_email', args: { email_id: 5 } }] },
    { user: 'approve draft 12', calls: [{ name: 'approve_email', args: { email_id: 12 } }] },
  ],
  reject_email: [
    { user: 'reject email 12', calls: [{ name: 'reject_email', args: { email_id: 12 } }] },
    { user: 'decline email 7', calls: [{ name: 'reject_email', args: { email_id: 7 } }] },
  ],
  approve_all_emails: [
    { user: 'approve all pending emails', calls: [{ name: 'approve_all_emails', args: { email_ids: [5, 7, 9] } }] },
    { user: 'approve every email in review', calls: [{ name: 'approve_all_emails', args: { email_ids: [1, 2] } }] },
  ],
  send_campaign_emails: [
    { user: 'send the campaign emails', calls: [{ name: 'send_campaign_emails', args: {} }] },
    { user: 'trigger email sends for campaign 3', calls: [{ name: 'send_campaign_emails', args: { campaign_id: 3 } }] },
  ],
  prepare_email_batch: [
    { user: "prepare today's emails", calls: [{ name: 'prepare_email_batch', args: {} }] },
    { user: 'generate the email drafts', calls: [{ name: 'prepare_email_batch', args: {} }] },
  ],
  get_scheduled_emails: [
    { user: 'show scheduled emails', calls: [{ name: 'get_scheduled_emails', args: {} }] },
    { user: 'what is queued to send', calls: [{ name: 'get_scheduled_emails', args: {} }] },
  ],
  send_email_now: [
    { user: 'send it', calls: [{ name: 'send_email_now', args: { email_id: 1 } }] },
    { user: 'yes send that email', calls: [{ name: 'send_email_now', args: { email_id: 1 } }] },
  ],
  get_active_conversations: [
    { user: 'who has replied to us', calls: [{ name: 'get_active_conversations', args: {} }] },
    { user: 'any replies this week', calls: [{ name: 'get_active_conversations', args: { days: 7 } }] },
  ],
  get_conversation_thread: [
    { user: 'show me the thread with contact 2976', calls: [{ name: 'get_conversation_thread', args: { contact_id: 2976 } }] },
    { user: 'open conversation for contact 2964', calls: [{ name: 'get_conversation_thread', args: { contact_id: 2964 } }] },
  ],
  preview_email: [
    { user: 'preview email 5', calls: [{ name: 'preview_email', args: { email_id: 5 } }] },
    { user: 'show draft email 12', calls: [{ name: 'preview_email', args: { email_id: 12 } }] },
  ],
  mark_conversation_handled: [
    { user: 'mark conversation 18 handled', calls: [{ name: 'mark_conversation_handled', args: { reply_id: 18 } }] },
    { user: 'close out reply 21', calls: [{ name: 'mark_conversation_handled', args: { reply_id: 21 } }] },
  ],
  start_pipeline: [
    { user: 'start the pipeline', calls: [{ name: 'start_pipeline', args: {} }] },
    { user: 'run the pipeline for tier A companies', calls: [{ name: 'start_pipeline', args: { tier: 'A' } }] },
  ],
  stop_pipeline: [
    { user: 'stop the pipeline', calls: [{ name: 'stop_pipeline', args: {} }] },
    { user: 'halt pipeline run', calls: [{ name: 'stop_pipeline', args: {} }] },
  ],
  get_pipeline_status: [
    { user: 'is the pipeline running', calls: [{ name: 'get_pipeline_status', args: {} }] },
    { user: 'pipeline status', calls: [{ name: 'get_pipeline_status', args: {} }] },
  ],
  run_email_discovery: [
    { user: 'find emails for our contacts', calls: [{ name: 'run_email_discovery', args: {} }] },
    { user: 'run email discovery', calls: [{ name: 'run_email_discovery', args: {} }] },
  ],
  run_phone_discovery: [
    { user: 'run phone discovery', calls: [{ name: 'run_phone_discovery', args: {} }] },
    { user: "discover phone numbers for today's contacts", calls: [{ name: 'run_phone_discovery', args: { today_only: true } }] },
  ],
  salesnav_scrape_leads: [
    { user: 'scrape leads from Zco Corporation', calls: [{ name: 'salesnav_scrape_leads', args: { companies: [{ name: 'Zco Corporation' }] } }] },
    { user: 'find decision makers at MasTec and Bechtel', calls: [{ name: 'salesnav_scrape_leads', args: { companies: [{ name: 'MasTec' }, { name: 'Bechtel' }] } }] },
  ],
  research_company: [
    { user: 'research Zco Corporation', calls: [{ name: 'research_company', args: { company_name: 'Zco Corporation' } }] },
    { user: 'what do we know about RussElectric', calls: [{ name: 'research_company', args: { company_name: 'RussElectric' } }] },
    { user: 'look into Bechtel Corporation for me', calls: [{ name: 'research_company', args: { company_name: 'Bechtel Corporation' } }] },
  ],
  research_person: [
    { user: 'research Randy Peterson from Zco', calls: [{ name: 'research_person', args: { person_name: 'Randy Peterson', company_name: 'Zco' } }] },
    { user: 'look into Keven Fuertes at RussElectric', calls: [{ name: 'research_person', args: { person_name: 'Keven Fuertes', company_name: 'RussElectric' } }] },
  ],
  assess_icp_fit: [
    { user: 'is Zco a good fit for us', calls: [{ name: 'assess_icp_fit', args: { company_name: 'Zco' } }] },
    { user: 'assess ICP fit for RussElectric', calls: [{ name: 'assess_icp_fit', args: { company_name: 'RussElectric' } }] },
  ],
  list_filter_values: [
    { user: 'what verticals do we have', calls: [{ name: 'list_filter_values', args: { arg_name: 'vertical' } }] },
    { user: 'what tiers are available', calls: [{ name: 'list_filter_values', args: { arg_name: 'tier' } }] },
    { user: 'show me verticals starting with con', calls: [{ name: 'list_filter_values', args: { arg_name: 'vertical', starts_with: 'con' } }] },
  ],
  add_contact: [
    { user: 'add Lucas Raza from Zco as a contact', calls: [{ name: 'add_contact', args: { name: 'Lucas Raza', company_name: 'Zco' } }] },
    { user: 'create a contact for John Smith at Acme Corp, VP of Sales', calls: [{ name: 'add_contact', args: { name: 'John Smith', company_name: 'Acme Corp', title: 'VP of Sales' } }] },
  ],
  get_contact: [
    { user: 'show contact 2976', calls: [{ name: 'get_contact', args: { contact_id: 2976 } }] },
    { user: 'open contact id 2964', calls: [{ name: 'get_contact', args: { contact_id: 2964 } }] },
  ],
  salesforce_search_contact: [
    { user: 'sync contact 2976 to salesforce', calls: [{ name: 'salesforce_search_contact', args: { contact_id: 2976 } }] },
    { user: 'find contact 2964 in salesforce', calls: [{ name: 'salesforce_search_contact', args: { contact_id: 2964 } }] },
  ],
  bulk_upload_to_salesforce: [
    { user: 'upload contacts 2976 and 2964 to salesforce', calls: [{ name: 'bulk_upload_to_salesforce', args: { contact_ids: [2976, 2964] } }] },
    { user: 'push these contacts to salesforce', calls: [{ name: 'bulk_upload_to_salesforce', args: { contact_ids: [2976] } }] },
  ],
  bulk_send_linkedin_requests: [
    { user: 'send linkedin requests to contacts 2976 and 2964', calls: [{ name: 'bulk_send_linkedin_requests', args: { contact_ids: [2976, 2964] } }] },
    { user: 'connect with these contacts on linkedin', calls: [{ name: 'bulk_send_linkedin_requests', args: { contact_ids: [2976] } }] },
  ],
  bulk_collect_phone: [
    { user: 'collect phones for contacts 2976 and 2964', calls: [{ name: 'bulk_collect_phone', args: { contact_ids: [2976, 2964] } }] },
    { user: 'find phone numbers for these contacts', calls: [{ name: 'bulk_collect_phone', args: { contact_ids: [2976] } }] },
  ],
  bulk_delete_contacts: [
    { user: 'delete contacts 2976 and 2964', calls: [{ name: 'bulk_delete_contacts', args: { contact_ids: [2976, 2964] } }] },
    { user: 'remove these contacts from the database', calls: [{ name: 'bulk_delete_contacts', args: { contact_ids: [2976] } }] },
  ],
  export_contacts_csv: [
    { user: "export today's contacts csv", calls: [{ name: 'export_contacts_csv', args: { today_only: true } }] },
    { user: 'export contacts with email only', calls: [{ name: 'export_contacts_csv', args: { with_email_only: true } }] },
  ],
  add_company: [
    { user: 'add Zco Corporation to the database', calls: [{ name: 'add_company', args: { company_name: 'Zco Corporation' } }] },
    { user: 'add MasTec as a tier A company in construction', calls: [{ name: 'add_company', args: { company_name: 'MasTec', tier: 'A', vertical: 'Construction' } }] },
  ],
  mark_company_vetted: [
    { user: 'mark company 101 vetted', calls: [{ name: 'mark_company_vetted', args: { company_id: 101 } }] },
    { user: 'mark company 102 vetted with icp score 8', calls: [{ name: 'mark_company_vetted', args: { company_id: 102, icp_score: 8 } }] },
  ],
  get_pending_companies_count: [
    { user: 'how many pending companies do we have', calls: [{ name: 'get_pending_companies_count', args: {} }] },
    { user: 'pending company count', calls: [{ name: 'get_pending_companies_count', args: {} }] },
  ],
  delete_contact: [
    { user: 'delete contact 2976', calls: [{ name: 'delete_contact', args: { contact_id: 2976 } }] },
    { user: 'remove contact 2964', calls: [{ name: 'delete_contact', args: { contact_id: 2964 } }] },
  ],
  delete_company: [
    { user: 'remove company 350', calls: [{ name: 'delete_company', args: { company_id: 350 } }] },
    { user: 'delete company 101', calls: [{ name: 'delete_company', args: { company_id: 101 } }] },
  ],
  get_dashboard_stats: [
    { user: 'show me the dashboard', calls: [{ name: 'get_dashboard_stats', args: {} }] },
    { user: 'how many contacts do we have', calls: [{ name: 'get_dashboard_stats', args: {} }] },
  ],
  get_salesforce_auth_status: [
    { user: 'check salesforce connection', calls: [{ name: 'get_salesforce_auth_status', args: {} }] },
    { user: 'is salesforce connected', calls: [{ name: 'get_salesforce_auth_status', args: {} }] },
  ],
  trigger_salesforce_reauth: [
    { user: 'reconnect to salesforce', calls: [{ name: 'trigger_salesforce_reauth', args: {} }] },
    { user: 'reauthenticate salesforce', calls: [{ name: 'trigger_salesforce_reauth', args: {} }] },
  ],
};

function parseOverridePayload(raw: string | null): Record<string, ToolCallExample[]> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, ToolCallExample[]> = {};
    for (const [toolName, value] of Object.entries(parsed)) {
      if (!Array.isArray(value)) continue;
      const rows: ToolCallExample[] = [];
      for (const row of value) {
        if (!row || typeof row !== 'object') continue;
        const obj = row as Record<string, unknown>;
        const user = typeof obj.user === 'string' ? obj.user.trim() : '';
        const calls = Array.isArray(obj.calls) ? obj.calls : [];
        const safeCalls = calls
          .filter((call) => call && typeof call === 'object')
          .map((call) => {
            const c = call as Record<string, unknown>;
            const name = typeof c.name === 'string' ? c.name.trim() : '';
            const args = c.args && typeof c.args === 'object' && !Array.isArray(c.args)
              ? (c.args as Record<string, unknown>)
              : {};
            return { name, args };
          })
          .filter((call) => Boolean(call.name));
        if (!user || safeCalls.length === 0) continue;
        rows.push({ user, calls: safeCalls });
      }
      if (rows.length > 0) out[toolName] = rows;
    }
    return out;
  } catch {
    return {};
  }
}

export function getToolExampleOverrides(): Record<string, ToolCallExample[]> {
  if (typeof localStorage === 'undefined') return {};
  return parseOverridePayload(localStorage.getItem(TOOL_EXAMPLE_OVERRIDES_KEY));
}

export function setToolExampleOverrides(overrides: Record<string, ToolCallExample[]>): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(TOOL_EXAMPLE_OVERRIDES_KEY, JSON.stringify(overrides));
}

export function clearToolExampleOverrides(): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.removeItem(TOOL_EXAMPLE_OVERRIDES_KEY);
}

type ArgSchema = {
  type?: string;
};

const STRING_SAMPLES: Record<string, string[]> = {
  name: ['Lucas Raza', 'Randy Peterson', 'Keven Fuertes'],
  company: ['Zco Corporation', 'RussElectric', 'Acme Corp'],
  company_name: ['Zco Corporation', 'RussElectric', 'Acme Corp'],
  title: ['Senior Account Executive', 'VP Sales', 'Head of Partnerships'],
  email: ['lucas.raza@zco.com', 'randy.peterson@zco.com', 'hello@example.com'],
  phone: ['555-123-4567', '555-987-0000', '555-222-3333'],
  domain: ['zco.com', 'russ-electric.com', 'acme.com'],
  q: ['construction', 'vet clinics in New Hampshire', 'banking companies in Nebraska'],
  query: ['construction companies in Nebraska', 'tech companies in Boston', 'vet clinics in Texas'],
  vertical: ['Construction', 'Veterinary', 'Banking'],
  industry: ['Construction', 'Veterinary', 'Banking'],
  tier: ['A', 'B', 'C'],
  status: ['active', 'draft', 'paused'],
  arg_name: ['vertical', 'tier', 'status'],
  tool_name: ['search_companies', 'search_contacts', 'list_campaigns'],
  starts_with: ['con', 'vet', 'bank'],
  context: [
    'small software companies similar to Zco',
    'contacts in automotive with email',
    'new campaign prospects in Nebraska',
  ],
  first_name: ['Lucas', 'Randy', 'Keven'],
  last_name: ['Raza', 'Peterson', 'Fuertes'],
  location: ['Texas', 'New Hampshire', 'Nebraska'],
  description: ['Initial outreach campaign', 'Follow-up campaign', 'Warm intro sequence'],
  wedge: ['Innovation', 'Cost reduction', 'Operational efficiency'],
  target_reason: ['ICP fit', 'High growth', 'Strategic account'],
};

function sampleForString(arg: string, variant: number): string {
  const key = arg.toLowerCase();
  const values = STRING_SAMPLES[key] || ['example value', 'sample value', 'test value'];
  return values[variant % values.length] as string;
}

function sampleForNumber(arg: string, variant: number): number {
  const key = arg.toLowerCase();
  if (key.endsWith('_id') || key === 'id') return [2976, 2964, 101][variant % 3] as number;
  if (key.includes('max')) return [10, 25, 50][variant % 3] as number;
  if (key.includes('days')) return [2, 3, 5][variant % 3] as number;
  if (key.includes('num')) return [3, 5, 10][variant % 3] as number;
  if (key.includes('score')) return [6, 8, 9][variant % 3] as number;
  return [1, 2, 3][variant % 3] as number;
}

function sampleForBoolean(_arg: string, variant: number): boolean {
  return [true, false, true][variant % 3] as boolean;
}

function sampleForArray(arg: string, variant: number): unknown[] {
  const key = arg.toLowerCase();
  if (key.includes('contact')) return [[2976], [2976, 2964], [2976, 2964, 2959]][variant % 3] as unknown[];
  if (key.includes('company')) return [[101], [101, 102], [101, 102, 103]][variant % 3] as unknown[];
  return [[1], [1, 2], [1, 2, 3]][variant % 3] as unknown[];
}

function sampleForArg(arg: string, schema: ArgSchema | undefined, variant: number): unknown {
  const type = schema?.type || 'string';
  if (type === 'number') return sampleForNumber(arg, variant);
  if (type === 'boolean') return sampleForBoolean(arg, variant);
  if (type === 'array') return sampleForArray(arg, variant);
  return sampleForString(arg, variant);
}

function chooseArgKeys(
  required: string[],
  optional: string[],
  variant: number
): string[] {
  const keys = [...required];
  if (optional.length === 0) return keys;
  if (variant === 0) return keys;
  if (variant === 1) return [...keys, optional[0] as string];
  return [...keys, ...optional.slice(0, 2)];
}

function renderUtterance(
  toolName: string,
  args: Record<string, unknown>,
  variant: number
): string {
  const readable = toolName.replace(/_/g, ' ');
  const compactArgs = Object.entries(args)
    .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
    .join(', ');
  const prompts = [
    `Please ${readable} with ${compactArgs}.`,
    `Can you ${readable} using ${compactArgs}?`,
    `${readable} now: ${compactArgs}.`,
  ];
  return prompts[variant % prompts.length] as string;
}

export function getExamplesForTool(tool: ToolDefinition, count = 3): ToolCallExample[] {
  const overrides = getToolExampleOverrides();
  const overridden = overrides[tool.function.name];
  if (overridden && overridden.length > 0) {
    return overridden.slice(0, count);
  }

  const curated = CURATED_EXAMPLES[tool.function.name];
  if (curated && curated.length >= count) return curated.slice(0, count);

  const properties = (tool.function.parameters?.properties || {}) as Record<string, ArgSchema>;
  const required = Array.isArray(tool.function.parameters?.required)
    ? (tool.function.parameters.required as string[])
    : [];
  const optional = Object.keys(properties).filter((k) => !required.includes(k));

  const examples: ToolCallExample[] = curated ? [...curated] : [];
  for (let variant = 0; variant < count; variant++) {
    if (examples.length >= count) break;
    const keys = chooseArgKeys(required, optional, variant);
    const args: Record<string, unknown> = {};
    for (const key of keys) {
      args[key] = sampleForArg(key, properties[key], variant);
    }

    examples.push({
      user: renderUtterance(tool.function.name, args, variant),
      calls: [{ name: tool.function.name, args }],
    });
  }
  return examples;
}

export function getResolvedExamplesForToolName(
  toolName: string,
  tools: ToolDefinition[],
  count = 5
): ToolCallExample[] {
  const tool = tools.find((t) => t.function.name === toolName);
  if (!tool) return [];
  return getExamplesForTool(tool, count);
}

export function buildPlannerExamplesBlock(tools: ToolDefinition[], examplesPerTool = 2): string {
  const lines: string[] = [];
  for (const tool of tools) {
    const examples = getExamplesForTool(tool, examplesPerTool);
    for (const ex of examples) {
      lines.push(
        `- User: ${ex.user}\n` +
        `  Output: ${JSON.stringify(ex.calls)}`
      );
    }
  }
  return lines.join('\n');
}
