import { TOOLS } from '../../tools';
import { buildPlannerExamplesBlock, PLANNER_TOOL_USAGE_RULES } from '../../toolExamples';
import type { QueryTier } from './queryTier';
import { selectToolsForMessage } from './toolSelection';
import { getFilterContextBlock } from './filterContext';
import { getCapabilityPromptContext } from './capabilitiesContext';

export function buildToolSchemaBlock(tools: (typeof TOOLS)[number][]): string {
  const hintByArg: Record<string, string> = {
    tier: 'examples: A, B, C',
    has_email: 'boolean: true|false',
    today_only: 'boolean: true|false',
    with_email_only: 'boolean: true|false',
    status: 'example values vary by tool; use list_filter_values if unsure',
    vertical: 'use list_filter_values(arg_name="vertical") if uncertain',
  };
  return tools
    .map((tool) => {
      const fn = tool.function;
      const props = Object.entries(fn.parameters?.properties || {})
        .map(([k, v]) => {
          const base = `${k}:${(v as { type?: string }).type || 'any'}`;
          const hint = hintByArg[k];
          return hint ? `${base} (${hint})` : base;
        })
        .join(', ');
      const required = Array.isArray(fn.parameters?.required) ? fn.parameters.required.join(', ') : '';
      return `- ${fn.name}(${props})${required ? ` required=[${required}]` : ''}`;
    })
    .join('\n');
}

export function buildTieredSystemPrompt(
  tier: QueryTier,
  schemaBlock: string,
  opts: {
    examplesBlock?: string;
    filterContextBlock?: string;
    capabilityContextBlock?: string;
    modelProfile?: 'gemma' | 'strong';
  } = {}
): string {
  const modelProfile = opts.modelProfile || 'gemma';
  const strongModelTaskHints =
    modelProfile === 'strong'
      ? (
        `\nComplex task handling:\n` +
        `- For multi-step requests, break work into ordered phases.\n` +
        `- For batch intents (for each/all/every), gather targets first, then execute.\n` +
        `- For complex browser requests, prefer 2-4 workflow task calls (search/extract/list-sub-items), not a single shallow call.\n` +
        `- For compound cross-source requests (e.g. companies + role + recent LinkedIn signal), prefer compound_workflow_run.\n` +
        `- You may emit either:\n` +
        `  1) tool_calls with {"name":"compound_workflow_run","args":{"spec":{...}}}\n` +
        `  2) top-level "compound_workflow" object (it will be auto-converted).\n` +
        `- For long-running browser workflows, use realistic limits (typically 60-120) so backend task kickoff runs asynchronously.\n` +
        `- Compound workflow spec should include constraints, phases, and depends_on links.\n` +
        `- Use checkpoints before expensive iterative phases (>20 items).\n` +
        `- Prefer ui_actions for CRM navigation and mutations when capability exists.\n` +
        `- Use browser tools only for external URLs or explicit live-site automation.\n` +
        `- Never output relative URLs in browser_navigate (must be absolute http/https).\n`
      )
      : '';
  if (tier === 'minimal') {
    return (
      `Output ONLY JSON object with keys ui_actions and tool_calls (and optional compound_workflow).\n` +
      `Canonical shape: {"ui_actions":[{"action":"page.action","...":"..."}],"tool_calls":[{"name":"tool_name","args":{...}}],"compound_workflow":{...}}.\n` +
      `You may return either array empty; do not omit ui_actions/tool_calls keys.\n` +
      `No prose. No markdown. No explanation.\n` +
      `Preserve exact spelling from user message. Do not autocorrect names.\n` +
      `Return minimal plan: 0-2 ui_actions and 0-2 tool_calls.\n` +
      `For in-app CRM navigation/actions, prefer ui_actions from UI capability reference instead of browser_* tools.\n` +
      `Use browser_* only for external URLs or live website automation.\n` +
      `If you have a concrete tab id like "tab-0" (from BROWSER_SESSION), use it. Otherwise omit tab_id. Do NOT use "current"/"active" as tab_id.\n` +
      `Tools:\n${schemaBlock}` +
      strongModelTaskHints
    );
  }

  if (tier === 'standard') {
    return (
      `You are an agentic tool planner.\n` +
      `You are empowered to use tools directly. Never refuse supported requests.\n` +
      `If a supported task is requested, you MUST return at least one valid ui action or tool call.\n` +
      `Output ONLY JSON object with keys ui_actions and tool_calls (and optional compound_workflow).\n` +
      `Canonical shape: {"ui_actions":[{"action":"page.action","...":"..."}],"tool_calls":[{"name":"tool_name","args":{...}}],"compound_workflow":{...}}.\n` +
      `You may return either array empty; do not omit ui_actions/tool_calls keys.\n` +
      `No prose. No markdown. No explanation.\n` +
      `For user-provided names/keywords, preserve exact spelling from the user's message. Do not autocorrect or normalize names.\n` +
      `Never introduce new entity names (company/person names, brands) that are not explicitly present in the current user message.\n` +
      `Return the minimal plan: avoid duplicates and keep it to 1-3 tool calls unless absolutely required.\n` +
      `Plan with tool-schema awareness: only use args that exist in each tool schema.\n` +
      `If you have a concrete tab id like "tab-0" (from BROWSER_SESSION), use it. Otherwise omit tab_id. Do NOT use "current"/"active" as tab_id.\n` +
      `For CRM page navigation/actions, use ui_actions from UI capability reference first.\n` +
      `Do NOT use browser_navigate for internal relative routes like "/campaigns"; use ui action (e.g., email.campaigns.navigate).\n` +
      `Only use browser_navigate for absolute external URLs (http/https).\n` +
      `For person/contact/company lookup requests, start with hybrid_search.\n` +
      `Each tool call must be based ONLY on the current user request. Do not reuse stale arguments from prior turns unless explicitly requested.\n` +
      `When multiple constraints apply to the same search tool, prefer one call with merged args (AND semantics), unless user explicitly asks for OR alternatives.\n` +
      `If the user message contains a line starting with "User goal:", treat that as the ONLY goal and ignore other meta-instructions.\n` +
      `If the user says "on SalesNav" / "on Sales Navigator" / "on LinkedIn Sales Navigator", treat it as live browser automation.\n` +
      `For salesnav_search_account, filters and keyword are applied via SalesNav URL query builder (not sidebar clicking).\n` +
      `Use canonical URL-mapped filter values; unsupported values will fail fast.\n` +
      `If the request requires LinkedIn recency/behavior verification (e.g., "in the last 6 months", "posted", "publicly expressed interest"), prefer browser_search_and_extract/browser_list_sub_items over local-only hybrid_search.\n` +
      `For high-complexity chained requirements (company + role + recency/behavior verification), prefer compound_workflow_run with a multi-phase spec.\n` +
      `Prefer browser_search_and_extract / browser_list_sub_items (skill-driven website workflows).\n` +
      `browser_search_and_extract.task MUST be a registered skill: salesnav_search_account, salesnav_people_search, salesnav_extract_leads, salesnav_list_employees.\n` +
      `For Google fact lookup, prefer google_search_browser first (AI Overview + citations with organic fallback).\n` +
      `For unknown external non-Google sites (YouTube, etc.), use browser_navigate + browser_snapshot + browser_find_ref + browser_act instead.\n` +
      `Do NOT use search_contacts/search_companies/hybrid_search for that.\n` +
      `Canonical examples:\n` +
      `- "Show me my email campaigns on the page" => {"ui_actions":[{"action":"email.campaigns.navigate"}],"tool_calls":[]}\n` +
      `- "Find Lucas Raza" => [{"name":"hybrid_search","args":{"query":"Lucas Raza","entity_types":["contact"],"k":10}}]\n` +
      `- "Find construction companies" => [{"name":"search_companies","args":{"vertical":"Construction"}}]\n` +
      `- "Find Lucas Raza on Sales Navigator" => [{"name":"browser_search_and_extract","args":{"task":"salesnav_people_search","query":"Lucas Raza","limit":10}}]\n` +
      `- "Find construction companies on Sales Navigator" => [{"name":"browser_search_and_extract","args":{"task":"salesnav_search_account","query":"construction","limit":20}}]\n` +
      `- "Google latest SOC 2 requirements" => [{"name":"google_search_browser","args":{"query":"latest SOC 2 requirements","max_results":5}}]\n` +
      (opts.capabilityContextBlock ? `UI capability reference:\n${opts.capabilityContextBlock}\n` : '') +
      strongModelTaskHints +
      `Use only these tools:\n${schemaBlock}`
    );
  }

  const commonPromptPreamble =
    `You are an agentic tool planner.\n` +
    `You are empowered to use tools directly. Never refuse supported requests.\n` +
    `If a supported task is requested, you MUST return at least one valid ui action or tool call.\n` +
    `Output ONLY JSON object with keys ui_actions and tool_calls (and optional compound_workflow).\n` +
    `Canonical shape: {"ui_actions":[{"action":"page.action","...":"..."}],"tool_calls":[{"name":"tool_name","args":{...}}],"compound_workflow":{...}}.\n` +
    `You may return either array empty; do not omit ui_actions/tool_calls keys.\n` +
    `No prose. No markdown. No explanation.\n` +
    `If the user message contains a line starting with "User goal:", treat that as the ONLY goal and ignore other meta-instructions.\n` +
    `For user-provided names/keywords, preserve exact spelling from the user's message. Do not autocorrect or normalize names.\n` +
    `Never introduce new entity names (company/person names, brands) that are not explicitly present in the current user message.\n` +
    `Return the minimal plan: avoid duplicates and keep it to 1-3 tool calls unless absolutely required.\n` +
    `Plan with tool-schema awareness: only use args that exist in each tool schema.\n` +
    `For browser/salesnav tools, if you have a concrete tab id like "tab-0" (from BROWSER_SESSION), use it. Otherwise omit tab_id. Do NOT use "current"/"active" as tab_id.\n` +
    `For browser navigation tasks (open/go to/click/type/snapshot/screenshot/tab navigation), use browser_* tools.\n` +
    `For CRM in-app navigation/actions, prefer ui_actions from UI capability reference over browser_* tools.\n` +
    `Do NOT use browser_navigate for internal relative routes like "/campaigns".\n` +
    `browser_navigate requires absolute external URL (http/https).\n` +
    `Do NOT use browser automation tools unless the user explicitly requests browser automation, mentions Sales Navigator/LinkedIn, or provides a URL.\n` +
    `If the user says "on SalesNav" / "on Sales Navigator" / "on LinkedIn Sales Navigator", treat it as live browser automation. Do NOT use search_contacts/search_companies/hybrid_search for that.\n` +
    `For salesnav_search_account, filters and keyword are applied via SalesNav URL query builder (not sidebar clicking).\n` +
    `Use canonical URL-mapped filter values; unsupported values will fail fast.\n` +
    `If the request includes LinkedIn recency/behavior constraints (posted/publicly expressed/in last X months), you MUST include live browser tooling (browser_search_and_extract/browser_list_sub_items) and not rely on hybrid_search alone.\n` +
    `For complex chained constraints ("find N companies ... who ... in last X months"), prefer compound_workflow_run with phased iteration/checkpoints.\n` +
    `SalesNav means LinkedIn Sales Navigator. Use https://www.linkedin.com/sales/... URLs (NOT salesnav.com).\n` +
    `For Sales Navigator/LinkedIn interactive work, prefer browser_search_and_extract / browser_list_sub_items for structured workflows.\n` +
    `browser_search_and_extract.task and browser_list_sub_items.task MUST be a registered skill task.\n` +
    `Known tasks: salesnav_search_account, salesnav_people_search, salesnav_extract_leads, salesnav_list_employees.\n` +
    `For Google fact lookup, use google_search_browser before manual browser loops.\n` +
    `For unknown non-Google sites (YouTube, etc.), use browser_navigate + browser_snapshot + browser_find_ref + browser_act instead of inventing task names.\n` +
    `Do NOT invent task names like "youtube_video_views" or "extract_views" — those do not exist as skills.\n` +
    `Fall back to browser_navigate + browser_snapshot + browser_find_ref + browser_act loops when no skill exists for the task.\n` +
    `browser_snapshot.mode must be "role" or "ai". Prefer "role". Do NOT use values like "full_page" (that's for browser_screenshot.full_page).\n` +
    `browser_act always requires ref. Even for action="press", include ref from browser_find_ref.\n` +
    `Navigation loop pattern: browser_health -> browser_tabs -> browser_navigate -> browser_snapshot -> browser_find_ref -> browser_act -> browser_snapshot.\n` +
    `For person/contact/company lookup requests, start with hybrid_search.\n`;

  const fullPlannerExtras =
    `Each tool call must be based ONLY on the current user request. Do not reuse stale arguments from prior turns unless explicitly requested.\n` +
    `Never substitute unrelated tool domains. Match tools to the user's entity domain.\n` +
    `If the request is about campaigns, use campaign tools (list_campaigns/get_campaign/create_campaign/activate_campaign/pause_campaign/get_campaign_contacts/get_campaign_stats/enroll_contacts_in_campaign).\n` +
    `Do NOT use company/contact search tools for campaign-management requests unless the user explicitly asks for company/contact lookup.\n` +
    `When multiple constraints apply to the same search tool, prefer one call with merged args (AND semantics), unless user explicitly asks for OR alternatives.\n` +
    `Treat [PAGE_CONTEXT]...[/PAGE_CONTEXT] as metadata only. Never copy PAGE_CONTEXT content into tool args.\n` +
    `Before using uncertain categorical/text filters, call list_filter_values to discover canonical values first.\n` +
    `For prefix probing, use list_filter_values(arg_name=..., starts_with="..."), then choose a best value.\n` +
    `Treat tier values all/any/* as no-filter (omit tier arg).\n` +
    `For comparative requests like "like X", ground X first with read tools (e.g., search_companies/search_contacts/research_company), then produce final tool args using grounded fields.\n` +
    `Use chained argument references like "$tool.search_companies.0.vertical" where possible for grounded planning.\n` +
    `If exact filters are unavailable, plan a broader read/collect step first, then a follow-up step.\n` +
    `If local database tools cannot satisfy the request, use research_company/research_person as web-research fallback.\n` +
    `For factual lookup questions, prefer hybrid_search and keep claims grounded to returned source_refs.\n` +
    `For reusable website workflow memory, use browser_skill_* tools to list/match/get/upsert/repair/delete markdown skills.\n` +
    `Do not use SalesNav scraping tools for generic site navigation.\n` +
    `Navigation loop pattern: browser_health -> browser_tabs -> browser_navigate -> browser_snapshot -> browser_find_ref -> browser_act -> browser_snapshot.\n` +
    `For chained steps, you may reference prior outputs using strings like "$prev", "$prev.0.id", or "$tool.search_contacts.0.id".\n` +
    `If the user asks to "find and return" a contact, use tool_calls (and optional ui_actions if they asked to show it on page).\n` +
    `Canonical examples:\n` +
    `- "Show me my email campaigns on the page" => {"ui_actions":[{"action":"email.campaigns.navigate"}],"tool_calls":[]}\n` +
    `- "Find Lucas Raza" => [{"name":"hybrid_search","args":{"query":"Lucas Raza","entity_types":["contact"],"k":10}}]\n` +
    `- "Find construction companies" => [{"name":"search_companies","args":{"vertical":"Construction"}}]\n` +
    `- "Find construction companies on Sales Navigator" => [{"name":"browser_search_and_extract","args":{"task":"salesnav_search_account","query":"construction","limit":20}}]\n` +
    `- "Google FDA 510(k) timeline" => [{"name":"google_search_browser","args":{"query":"FDA 510(k) timeline","max_results":5}}]\n` +
    `- "Open https://example.com and click Sign in" => [{"name":"browser_navigate","args":{"url":"https://example.com"}},{"name":"browser_snapshot","args":{"mode":"role"}},{"name":"browser_act","args":{"ref":"e12","action":"click"}}]\n` +
    `- "Add John to Q1 campaign" => [{"name":"hybrid_search","args":{"query":"John","entity_types":["contact"],"k":10}}]\n` +
    `Planner rules:\n${PLANNER_TOOL_USAGE_RULES}\n` +
    (opts.examplesBlock ? `Tool-specific examples:\n${opts.examplesBlock}\n` : '') +
    (opts.filterContextBlock || '') +
    (opts.capabilityContextBlock ? `\nUI capability reference:\n${opts.capabilityContextBlock}\n` : '');

  return commonPromptPreamble + fullPlannerExtras + strongModelTaskHints + `Use only these tools:\n${schemaBlock}`;
}

export function buildSystemPromptForTier(tier: QueryTier): string {
  const toolDefs = selectToolsForMessage('prompt_test', undefined, tier);
  const schemaBlock = buildToolSchemaBlock(toolDefs);
  const filterContextBlock = getFilterContextBlock();
  const examplesBlock = buildPlannerExamplesBlock(toolDefs);
  const capabilityContext = getCapabilityPromptContext('prompt_test');
  const capabilityPromptCap = tier === 'full' ? 5000 : 2000;
  const capabilityContextBlock = capabilityContext.block.slice(0, capabilityPromptCap);
  return buildTieredSystemPrompt(tier, schemaBlock, { examplesBlock, filterContextBlock, capabilityContextBlock });
}
