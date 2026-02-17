import { TOOLS } from '../../tools';
import { classifyQueryTier, type QueryTier } from './queryTier';
import { stripPlannerHeuristicContext } from './sessionBlocks';

function preselectToolNames(userMessage: string): Set<string> | null {
  const lower = (userMessage || '').toLowerCase();
  if (!lower.trim()) return null;

  const candidates = new Set<string>();

  candidates.add('hybrid_search');
  candidates.add('resolve_entity');

  const isMutating =
    /\b(add|create|delete|remove|update|edit|start|stop|run|send|approve|reject|pause|activate|enroll|mark|import|bulk|scrape|collect|upload|export|schedule|reschedule)\b/.test(
      lower
    );
  const hasSalesNavMention = /\b(salesnav|sales\s*navigator|linkedin)\b/.test(lower);
  const hasBrowserWords =
    /https?:\/\//.test(lower) ||
    /\b(browser|tab|screenshot|snapshot|navigate|open|visit|go\s+to|click|type|fill|scroll)\b/.test(lower);
  const hasSkillAdminWords =
    /\b(browser\s+skill|website\s+skill|skill\s+file|repair\s+skill|update\s+skill|create\s+skill|delete\s+skill)\b/.test(
      lower
    );
  const hasCampaignWords = /\b(campaign|sequence)\b/.test(lower);
  const hasCompoundIntent =
    /\b(for each|for all|every|identify \d+|find \d+|that are|who have|which have|last \d+|recent|sales navigator|linkedin)\b/.test(lower) &&
    /\b(and|with|who|that)\b/.test(lower);
  const hasCampaignParamShape =
    /\b(number\s+of\s+emails|num\s*emails|days\s+between|days\s+between\s+emails)\b/.test(lower) ||
    /\b(num_emails|days_between_emails)\b/.test(lower);
  const hasNoteWords = /\b(note|notes)\b/.test(lower) && /\b(write|save|add|create|append|log|store)\b/.test(lower);

  const wantsSalesNavCollection =
    hasSalesNavMention &&
    /\b(find|search|list|show|get)\b.*\b(companies|company|accounts|account|leads|lead)\b/.test(lower) &&
    !hasBrowserWords;

  const wantsInteractiveBrowser = hasBrowserWords || (hasSalesNavMention && !wantsSalesNavCollection);

  const hasPersonWords =
    /\b(contact|contacts|person|people|lead|leads|prospect|prospects|employee|employees)\b/.test(lower);
  const isWhoIs = /^\s*who\s+is\b/.test(lower);
  const isFindLike = /^\s*(find|search|show|get|lookup|look\s+up)\b/.test(lower);
  const maybePersonLookup = isWhoIs || (isFindLike && !/\b(compan(y|ies)|campaign|sequence)\b/.test(lower));
  if (!hasSalesNavMention && (hasPersonWords || maybePersonLookup)) {
    candidates.add('search_contacts');
    candidates.add('get_contact');
  }

  if (!hasSalesNavMention && /\b(company|companies|account|accounts|org|firm|business)\b/.test(lower)) {
    candidates.add('search_companies');
    candidates.add('research_company');
    candidates.add('assess_icp_fit');
    candidates.add('get_pending_companies_count');
    if (isMutating) {
      candidates.add('add_company');
      candidates.add('mark_company_vetted');
      candidates.add('delete_company');
    }
  }

  if (hasCampaignWords || hasCampaignParamShape || /\b(enroll)\b/.test(lower)) {
    candidates.add('list_campaigns');
    candidates.add('get_campaign');
    candidates.add('get_campaign_contacts');
    candidates.add('get_campaign_stats');
    if (isMutating || hasCampaignParamShape || /\b(enroll)\b/.test(lower)) {
      candidates.add('create_campaign');
      candidates.add('activate_campaign');
      candidates.add('pause_campaign');
      candidates.add('enroll_contacts_in_campaign');
      candidates.add('enroll_contacts_by_filter');
    }
  }

  if (hasNoteWords) {
    candidates.add('create_note');
  }

  if (/\b(email|emails|send|mail|approve|reject|review|draft|reply|conversation|thread)\b/.test(lower)) {
    candidates.add('get_email_dashboard_metrics');
    candidates.add('get_review_queue');
    candidates.add('get_scheduled_emails');
    candidates.add('get_active_conversations');
    candidates.add('get_conversation_thread');
    candidates.add('preview_email');
    if (isMutating) {
      candidates.add('send_email_now');
      candidates.add('approve_email');
      candidates.add('reject_email');
      candidates.add('approve_all_emails');
      candidates.add('approve_campaign_review_queue');
      candidates.add('send_campaign_emails');
      candidates.add('prepare_email_batch');
      candidates.add('reschedule_campaign_emails');
      candidates.add('mark_conversation_handled');
    }
  }

  if (wantsInteractiveBrowser) {
    candidates.add('browser_health');
    candidates.add('browser_tasks_status');
    candidates.add('browser_tabs');
    candidates.add('browser_navigate');
    candidates.add('browser_snapshot');
    candidates.add('browser_find_ref');
    candidates.add('browser_act');
    candidates.add('browser_wait');
    candidates.add('browser_screenshot');
    candidates.add('browser_search_and_extract');
    candidates.add('google_search_browser');
    candidates.add('browser_list_sub_items');
    if (hasSkillAdminWords) {
      candidates.add('browser_skill_list');
      candidates.add('browser_skill_match');
      candidates.add('browser_skill_get');
      candidates.add('browser_skill_upsert');
      candidates.add('browser_skill_delete');
      candidates.add('browser_skill_repair');
    }
  }

  if (hasCompoundIntent) {
    candidates.add('compound_workflow_run');
    candidates.add('compound_workflow_status');
    candidates.add('compound_workflow_continue');
    candidates.add('compound_workflow_cancel');
    candidates.add('compound_workflow_list');
  }

  if (hasSalesNavMention) {
    if (/\b(collect|scrape|harvest|bulk|discover|ingest)\b/.test(lower) || wantsSalesNavCollection) {
      candidates.add('collect_companies_from_salesnav');
      candidates.add('salesnav_scrape_leads');
    }
  }

  if (/\b(pipeline|discovery)\b/.test(lower)) {
    candidates.add('start_pipeline');
    candidates.add('stop_pipeline');
    candidates.add('get_pipeline_status');
    candidates.add('run_email_discovery');
    candidates.add('run_phone_discovery');
  }

  if (/\b(phone|call|dial)\b/.test(lower)) {
    candidates.add('run_phone_discovery');
    candidates.add('bulk_collect_phone');
  }

  if (/\b(research|investigate|look\s+into|icp|fit)\b/.test(lower)) {
    candidates.add('research_company');
    candidates.add('research_person');
    candidates.add('assess_icp_fit');
  }

  if (/\b(salesforce|sf|sfdc|sync)\b/.test(lower)) {
    candidates.add('salesforce_search_contact');
    candidates.add('bulk_upload_to_salesforce');
    candidates.add('get_salesforce_auth_status');
    candidates.add('trigger_salesforce_reauth');
  }

  if (/\b(bulk|batch|all|export|csv)\b/.test(lower)) {
    candidates.add('bulk_upload_to_salesforce');
    candidates.add('bulk_send_linkedin_requests');
    candidates.add('bulk_collect_phone');
    candidates.add('bulk_delete_contacts');
    candidates.add('export_contacts_csv');
  }

  if (/\b(dashboard|stats|metrics|how\s+many|count|overview)\b/.test(lower)) {
    candidates.add('get_dashboard_stats');
    candidates.add('get_email_dashboard_metrics');
    candidates.add('get_pending_companies_count');
    if (/\b(task|browser)\b/.test(lower)) {
      candidates.add('browser_tasks_status');
    }
  }

  if (/\b(filter|vertical|tier|values|what\s+.*\b(do|are)\b)\b/.test(lower)) {
    candidates.add('list_filter_values');
  }

  if (/\b(add|create)\b/.test(lower)) {
    candidates.add('add_contact');
    candidates.add('add_company');
    candidates.add('create_campaign');
  }
  if (/\b(delete|remove)\b/.test(lower)) {
    candidates.add('delete_contact');
    candidates.add('delete_company');
    candidates.add('bulk_delete_contacts');
  }

  return candidates;
}

function shouldAllowBrowserTools(userMessage: string): boolean {
  const lower = (userMessage || '').toLowerCase();
  if (!lower.trim()) return false;
  if (/https?:\/\//.test(lower)) return true;
  if (/\b(browser|tab|screenshot|snapshot|navigate|open|visit|go to|click|type|fill|scroll)\b/.test(lower)) return true;
  if (/\b(sales\s*navigator|salesnav|linkedin)\b/.test(lower)) return true;
  if (/\bskill\b|\bworkflow\b|\btask=/.test(lower)) return true;
  // Live/current data queries that require a browser to answer
  if (/\b(youtube|twitter|reddit|instagram|facebook|tiktok|amazon|ebay|zillow|glassdoor|yelp|google\s*maps)\b/.test(lower)) return true;
  if (/\b(views|price|rating|reviews|followers|subscribers|stock|weather|score|live|current|right now|today)\b/.test(lower) &&
      /\b(how many|what|check|get|find|show|look up)\b/.test(lower)) return true;
  if (/\b(what.*(page|site|website)|on the page|from the page|already open)\b/.test(lower)) return true;
  return false;
}

function shouldAllowSalesNavCollection(userMessage: string): boolean {
  const lower = (userMessage || '').toLowerCase();
  if (!/\b(sales\s*navigator|salesnav|linkedin)\b/.test(lower)) return false;
  if (/\b(collect|scrape|harvest|bulk|discover|ingest)\b/.test(lower)) return true;
  if (/\b(find|search|list|show|get)\b.*\b(companies|accounts|leads)\b/.test(lower) && /\b(sales\s*navigator|salesnav)\b/.test(lower)) return true;
  return false;
}

function selectToolsForMessage(
  userMessage: string,
  allowedToolNames?: readonly string[],
  tier?: QueryTier
): (typeof TOOLS)[number][] {
  const selectionMessage = stripPlannerHeuristicContext(userMessage);

  const allowBrowser = shouldAllowBrowserTools(selectionMessage);
  const allowCollect = shouldAllowSalesNavCollection(selectionMessage);

  const allowed = allowedToolNames && allowedToolNames.length > 0 ? new Set(allowedToolNames) : null;

  const effectiveTier = tier ?? classifyQueryTier(selectionMessage);
  const preselected = !allowed && effectiveTier !== 'full' ? preselectToolNames(selectionMessage) : null;

  let candidates: (typeof TOOLS)[number][];
  if (preselected && preselected.size > 0) {
    candidates = TOOLS.filter((tool) => {
      const name = tool.function.name;
      if (!preselected.has(name)) return false;
      if (allowed && !allowed.has(name)) return false;
      return true;
    });
  } else {
    candidates = allowed ? TOOLS.filter((tool) => allowed.has(tool.function.name)) : TOOLS;
  }

  if (!allowBrowser) {
    candidates = candidates.filter((tool) => {
      const name = tool.function.name;
      if (name.startsWith('browser_')) return false;
      if (name.startsWith('browserSkill_')) return false;
      if (name.startsWith('browser_skill_')) return false;
      if (name === 'collect_companies_from_salesnav') return false;
      return true;
    });
  } else if (!allowCollect) {
    candidates = candidates.filter((tool) => tool.function.name !== 'collect_companies_from_salesnav');
  }

  if (candidates.length > 0) return candidates;
  return allowed ? TOOLS.filter((tool) => allowed.has(tool.function.name)) : TOOLS;
}

export function selectToolNamesForMessage(
  userMessage: string,
  allowedToolNames?: readonly string[],
  tier?: QueryTier
): string[] {
  return selectToolsForMessage(userMessage, allowedToolNames, tier).map((t) => t.function.name);
}

export { selectToolsForMessage };
