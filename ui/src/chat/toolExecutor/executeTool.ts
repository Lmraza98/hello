import { normalizeToolArgs } from '../../utils/filterNormalization';
import { apiFactory, qs } from './http';
import { API_BASE } from './config';
import {
  runBrowserSkillDelete,
  runBrowserSkillGet,
  runBrowserSkillList,
  runBrowserSkillMatch,
  runBrowserSkillRepair,
  runBrowserSkillUpsert,
} from './browserSkills';
import { listFilterValues } from './filterValues';

const api = apiFactory(API_BASE);

function parseGoogleSearchIntent(args: Record<string, unknown>): { isGoogleIntent: boolean; query: string } {
  const raw = typeof args.query === 'string' ? args.query.trim() : '';
  if (!raw) return { isGoogleIntent: false, query: '' };
  const lower = raw.toLowerCase();
  if (lower.startsWith('google ')) {
    return { isGoogleIntent: true, query: raw.slice(7).trim() };
  }
  if (lower.startsWith('search google for ')) {
    return { isGoogleIntent: true, query: raw.slice('search google for '.length).trim() };
  }
  if (lower.startsWith('search google ')) {
    return { isGoogleIntent: true, query: raw.slice('search google '.length).trim() };
  }
  return { isGoogleIntent: false, query: raw };
}

export async function executeTool(
  toolName: string,
  args: Record<string, unknown>
): Promise<unknown> {
  const normalizedArgs = normalizeToolArgs(toolName, args);
  switch (toolName) {
    case 'resolve_entity': {
      const rawEntityTypes = Array.isArray(normalizedArgs.entity_types)
        ? normalizedArgs.entity_types
        : [];
      const mappedEntityTypes = rawEntityTypes
        .map((value) => String(value).trim().toLowerCase())
        .map((value) => {
          if (
            value === 'person' ||
            value === 'people' ||
            value === 'lead' ||
            value === 'leads' ||
            value === 'prospect' ||
            value === 'prospects' ||
            value === 'employee' ||
            value === 'employees'
          ) {
            return 'contact';
          }
          if (
            value === 'account' ||
            value === 'accounts' ||
            value === 'organization' ||
            value === 'organisations' ||
            value === 'org' ||
            value === 'business' ||
            value === 'firm'
          ) {
            return 'company';
          }
          if (value === 'campaigns') return 'campaign';
          return value;
        })
        .filter((value) => value === 'contact' || value === 'company' || value === 'campaign');

      const resolvePayload: Record<string, unknown> = {
        ...normalizedArgs,
        ...(mappedEntityTypes.length > 0 ? { entity_types: [...new Set(mappedEntityTypes)] } : {}),
      };
      const resolved = await api('POST', '/api/search/resolve', resolvePayload);

      const results = (
        resolved &&
        typeof resolved === 'object' &&
        Array.isArray((resolved as { results?: unknown[] }).results)
      )
        ? ((resolved as { results: unknown[] }).results)
        : [];

      // If deterministic resolver finds nothing, broaden via hybrid retrieval.
      if (results.length === 0) {
        const fallbackQuery =
          typeof normalizedArgs.name_or_identifier === 'string'
            ? normalizedArgs.name_or_identifier.trim()
            : '';
        if (fallbackQuery) {
          const kValue =
            typeof normalizedArgs.k === 'number' && Number.isFinite(normalizedArgs.k)
              ? normalizedArgs.k
              : 10;
          return api('POST', '/api/search/hybrid', {
            query: fallbackQuery,
            entity_types: mappedEntityTypes.length > 0 ? [...new Set(mappedEntityTypes)] : ['contact'],
            k: kValue,
          });
        }
      }

      return resolved;
    }
    case 'hybrid_search': {
      const hybrid = await api('POST', '/api/search/hybrid', normalizedArgs);
      const resultObj = hybrid && typeof hybrid === 'object' ? (hybrid as Record<string, unknown>) : null;
      const hasError = Boolean(resultObj?.error);
      if (!hasError) return hybrid;

      const { isGoogleIntent, query } = parseGoogleSearchIntent(normalizedArgs);
      if (!isGoogleIntent || !query) return hybrid;

      const maxResults =
        typeof normalizedArgs.k === 'number' && Number.isFinite(normalizedArgs.k)
          ? Math.max(1, Math.min(20, Math.trunc(normalizedArgs.k)))
          : 5;
      const google = await api('POST', '/api/google/search-browser', {
        query,
        max_results: maxResults,
      });
      return google;
    }
    case 'ask_documents':
      return api('POST', '/api/documents/ask', normalizedArgs);
    case 'search_documents':
      return api('POST', '/api/documents/search', normalizedArgs);
    case 'get_document_summary': {
      const documentId = typeof normalizedArgs.document_id === 'string' ? normalizedArgs.document_id.trim() : '';
      if (!documentId) {
        return {
          error: true,
          status: 422,
          message: 'Invalid arguments for tool get_document_summary: document_id is required',
          detail: { field: 'document_id', expected: 'string' },
        };
      }
      return api('GET', `/api/documents/${encodeURIComponent(documentId)}`);
    }
    case 'list_company_documents': {
      const companyId = normalizedArgs.company_id;
      if (typeof companyId !== 'number' || !Number.isFinite(companyId)) {
        return {
          error: true,
          status: 422,
          message: 'Invalid arguments for tool list_company_documents: company_id must be a number',
          detail: { field: 'company_id', expected: 'number' },
        };
      }
      return api('GET', `/api/documents${qs({ company_id: companyId, limit: normalizedArgs.limit })}`);
    }
    case 'search_contacts':
      return api('GET', `/api/contacts${qs(normalizedArgs)}`);
    case 'get_contact': {
      const rawContactId = args.contact_id;
      if (typeof rawContactId !== 'number' || !Number.isFinite(rawContactId) || !Number.isInteger(rawContactId) || rawContactId <= 0) {
        return {
          error: true,
          status: 422,
          message: 'Invalid arguments for tool get_contact: contact_id must be a positive integer',
          detail: { field: 'contact_id', expected: 'positive_integer' },
        };
      }
      const contactId = rawContactId;
      return api('GET', `/api/contacts/${contactId}`);
    }
    case 'add_contact':
      return api('POST', '/api/contacts', args);
    case 'delete_contact':
      return api('DELETE', `/api/contacts/${args.contact_id}`);
    case 'salesforce_search_contact':
      return api('POST', `/api/contacts/${args.contact_id}/salesforce-search`);
    case 'bulk_upload_to_salesforce':
      return api('POST', '/api/contacts/bulk-actions/salesforce-upload', {
        contact_ids: args.contact_ids,
      });
    case 'bulk_send_linkedin_requests':
      return api('POST', '/api/contacts/bulk-actions/linkedin-request', {
        contact_ids: args.contact_ids,
      });
    case 'bulk_collect_phone':
      return api('POST', '/api/contacts/bulk-actions/collect-phone', {
        contact_ids: args.contact_ids,
      });
    case 'bulk_delete_contacts':
      return api('POST', '/api/contacts/bulk-actions/delete', {
        contact_ids: args.contact_ids,
      });
    case 'export_contacts_csv':
      return api('GET', `/api/contacts/export${qs(args)}`);

    case 'search_companies':
      return api('GET', `/api/companies${qs(normalizedArgs)}`);
    case 'list_filter_values':
      return listFilterValues(api, normalizedArgs);
    case 'add_company':
      return api('POST', '/api/companies', args);
    case 'delete_company':
      return api('DELETE', `/api/companies/${args.company_id}`);
    case 'collect_companies_from_salesnav':
      return api('POST', '/api/companies/collect', args);
    case 'mark_company_vetted': {
      const companyId = args.company_id;
      const icpScore = args.icp_score;
      return api('POST', `/api/companies/${companyId}/mark-vetted${qs({ icp_score: icpScore })}`);
    }
    case 'get_pending_companies_count':
      return api('GET', '/api/companies/pending-count');

    case 'list_campaigns':
      return api('GET', `/api/emails/campaigns${qs(args)}`);
    case 'get_campaign':
      return api('GET', `/api/emails/campaigns/${args.campaign_id}`);
    case 'create_campaign': {
      const payload: Record<string, unknown> = {};
      if (typeof normalizedArgs.name === 'string' && normalizedArgs.name.trim()) payload.name = normalizedArgs.name.trim();
      if (typeof normalizedArgs.description === 'string' && normalizedArgs.description.trim()) {
        payload.description = normalizedArgs.description.trim();
      }
      const numEmailsRaw = normalizedArgs.num_emails;
      const daysRaw = normalizedArgs.days_between_emails;
      const numEmails =
        typeof numEmailsRaw === 'number'
          ? numEmailsRaw
          : typeof numEmailsRaw === 'string' && numEmailsRaw.trim()
            ? Number.parseInt(numEmailsRaw, 10)
            : undefined;
      const daysBetween =
        typeof daysRaw === 'number'
          ? daysRaw
          : typeof daysRaw === 'string' && daysRaw.trim()
            ? Number.parseInt(daysRaw, 10)
            : undefined;
      if (Number.isFinite(numEmails as number)) payload.num_emails = numEmails;
      if (Number.isFinite(daysBetween as number)) payload.days_between_emails = daysBetween;

      const result = await api('POST', '/api/emails/campaigns', payload);
      if (
        result &&
        typeof result === 'object' &&
        (result as Record<string, unknown>).error === true &&
        (result as Record<string, unknown>).status === 409
      ) {
        const detail = (result as Record<string, unknown>).detail as
          | { existing_campaign?: Record<string, unknown>; message?: string }
          | undefined;
        if (detail?.existing_campaign) {
          return {
            ...detail.existing_campaign,
            already_existed: true,
            note: detail.message || 'Campaign with this name already exists.',
          };
        }
      }
      return result;
    }
    case 'create_note': {
      const entity_type = typeof args.entity_type === 'string' ? args.entity_type : '';
      const entity_id = args.entity_id != null ? String(args.entity_id) : '';
      const content = typeof args.content === 'string' ? args.content : '';
      return api('POST', '/api/notes', { entity_type, entity_id, content });
    }
    case 'activate_campaign':
      return api('POST', `/api/emails/campaigns/${args.campaign_id}/activate`);
    case 'pause_campaign':
      return api('POST', `/api/emails/campaigns/${args.campaign_id}/pause`);
    case 'enroll_contacts_in_campaign':
      return api('POST', `/api/emails/campaigns/${args.campaign_id}/enroll`, {
        contact_ids: args.contact_ids,
      });
    case 'enroll_contacts_by_filter':
      return api('POST', `/api/emails/campaigns/${args.campaign_id}/enroll-by-filter`, {
        query: args.query,
        vertical: args.vertical,
        company: args.company,
        has_email: args.has_email,
        today_only: args.today_only,
      });
    case 'get_campaign_contacts':
      return api(
        'GET',
        `/api/emails/campaigns/${args.campaign_id}/contacts${qs({ status: args.status })}`
      );
    case 'get_campaign_stats':
      return api('GET', `/api/emails/campaigns/${args.campaign_id}/stats`);

    case 'get_email_dashboard_metrics':
      return api('GET', `/api/emails/dashboard-metrics${qs(args)}`);
    case 'get_review_queue':
      return api('GET', '/api/emails/review-queue');
    case 'approve_email': {
      const emailId = args.email_id;
      const edits = {
        subject: args.subject,
        body: args.body,
      };
      const hasEdits = Boolean(edits.subject || edits.body);
      return api(
        'POST',
        `/api/emails/review-queue/${emailId}/approve`,
        hasEdits ? edits : undefined
      );
    }
    case 'reject_email':
      return api('POST', `/api/emails/review-queue/${args.email_id}/reject`);
    case 'approve_all_emails':
      return api('POST', '/api/emails/review-queue/approve-all', {
        email_ids: args.email_ids,
      });
    case 'approve_campaign_review_queue':
      return api('POST', '/api/emails/review-queue/approve-campaign', {
        campaign_id: args.campaign_id,
        limit: args.limit,
      });
    case 'send_campaign_emails':
      return api('POST', '/api/emails/send', normalizedArgs);
    case 'prepare_email_batch':
      return api('POST', '/api/emails/prepare-batch');
    case 'get_scheduled_emails':
      return api('GET', `/api/emails/scheduled-emails${qs(normalizedArgs)}`);
    case 'reschedule_campaign_emails':
      return api('PUT', '/api/emails/scheduled-emails/reschedule-by-offset', {
        campaign_id: args.campaign_id,
        days_from_now: args.days_from_now,
        limit: args.limit,
      });
    case 'send_email_now':
      return api('POST', `/api/emails/scheduled-emails/${args.email_id}/send-now`);
    case 'get_active_conversations':
      return api('GET', `/api/emails/active-conversations${qs(args)}`);
    case 'get_conversation_thread':
      return api('GET', `/api/emails/conversations/${args.contact_id}/thread`);
    case 'preview_email': {
      const campaignId = args.campaign_id;
      const contactId = args.contact_id;
      const stepNumber = args.step_number;
      return api(
        'POST',
        `/api/emails/preview${qs({
          campaign_id: campaignId,
          contact_id: contactId,
          step_number: stepNumber,
        })}`
      );
    }
    case 'mark_conversation_handled':
      return api('POST', `/api/emails/conversations/${args.reply_id}/mark-handled`);

    case 'start_pipeline':
      return api('POST', `/api/pipeline/start${qs(normalizedArgs)}`);
    case 'stop_pipeline':
      return api('POST', '/api/pipeline/stop');
    case 'get_pipeline_status':
      return api('GET', '/api/pipeline/status');
    case 'run_email_discovery':
      return api('POST', `/api/pipeline/emails${qs(normalizedArgs)}`);
    case 'run_phone_discovery':
      return api('POST', `/api/pipeline/phones${qs(normalizedArgs)}`);

    case 'salesnav_scrape_leads':
      return api('POST', '/api/salesnav/scrape-leads', normalizedArgs);
    case 'browser_health':
      return api('GET', '/api/browser/health');
    case 'browser_tasks_status':
      return api('GET', `/api/browser/workflows/tasks${qs({
        include_finished:
          typeof normalizedArgs.include_finished === 'boolean'
            ? normalizedArgs.include_finished
            : false,
        limit:
          typeof normalizedArgs.limit === 'number' && Number.isFinite(normalizedArgs.limit)
            ? normalizedArgs.limit
            : 50,
      })}`);
    case 'compound_workflow_run':
      return api('POST', '/api/compound_workflow/run', {
        spec: normalizedArgs.spec,
        user_id: normalizedArgs.user_id,
      });
    case 'compound_workflow_status':
      return api('GET', `/api/compound_workflow/${normalizedArgs.workflow_id}/status`);
    case 'compound_workflow_continue':
      return api('POST', `/api/compound_workflow/${normalizedArgs.workflow_id}/continue`);
    case 'compound_workflow_cancel':
      return api('POST', `/api/compound_workflow/${normalizedArgs.workflow_id}/cancel`);
    case 'compound_workflow_list':
      return api('GET', `/api/compound_workflow${qs({
        status: normalizedArgs.status,
        limit:
          typeof normalizedArgs.limit === 'number' && Number.isFinite(normalizedArgs.limit)
            ? normalizedArgs.limit
            : 50,
      })}`);
    case 'browser_tabs':
      return api('GET', '/api/browser/tabs');
    case 'browser_navigate':
      return api('POST', '/api/browser/navigate', normalizedArgs);
    case 'browser_snapshot':
      return api('POST', '/api/browser/snapshot', normalizedArgs);
    case 'browser_act':
      return api('POST', '/api/browser/act', normalizedArgs);
    case 'browser_find_ref':
      return api('POST', '/api/browser/find_ref', normalizedArgs);
    case 'browser_wait':
      return api('POST', '/api/browser/wait', normalizedArgs);
    case 'browser_screenshot':
      return api('POST', '/api/browser/screenshot', normalizedArgs);
    case 'browser_search_and_extract':
      return api('POST', '/api/browser/workflows/search-and-extract', normalizedArgs);
    case 'google_search_browser':
      return api('POST', '/api/google/search-browser', normalizedArgs);
    case 'browser_list_sub_items':
      return api('POST', '/api/browser/workflows/list-sub-items', normalizedArgs);
    case 'browser_skill_list':
      return runBrowserSkillList(api, qs, normalizedArgs);
    case 'browser_skill_match':
      return runBrowserSkillMatch(api, normalizedArgs);
    case 'browser_skill_get':
      return runBrowserSkillGet(api, normalizedArgs);
    case 'browser_skill_upsert':
      return runBrowserSkillUpsert(api, normalizedArgs);
    case 'browser_skill_delete':
      return runBrowserSkillDelete(api, normalizedArgs);
    case 'browser_skill_repair':
      return runBrowserSkillRepair(api, normalizedArgs);

    case 'research_company':
      return api('POST', '/api/research/company', normalizedArgs);
    case 'research_person':
      return api('POST', '/api/research/person', normalizedArgs);
    case 'assess_icp_fit':
      return api('POST', '/api/research/icp-assess', normalizedArgs);

    case 'get_salesforce_auth_status':
      return api('GET', '/api/salesforce/auth-status');
    case 'trigger_salesforce_reauth':
      return api('POST', '/api/salesforce/reauth');
    case 'get_dashboard_stats':
      return api('GET', '/api/stats');

    // ── Workflow endpoints (multi-step backend operations) ──
    case 'workflow_resolve_contact':
      return api('POST', '/api/workflows/resolve-contact', normalizedArgs);
    case 'workflow_enroll_and_draft':
      return api('POST', '/api/workflows/enroll-and-draft', normalizedArgs);
    case 'workflow_prospect':
      return api('POST', '/api/workflows/prospect', normalizedArgs);
    case 'workflow_scrape_leads_batch':
      return api('POST', '/api/workflows/scrape-leads-batch', normalizedArgs);
    case 'workflow_lookup_and_research':
      return api('POST', '/api/workflows/lookup-and-research', normalizedArgs);
    case 'workflow_vet_batch':
      return api('POST', '/api/workflows/vet-batch', normalizedArgs);

    default:
      return { error: true, message: `Unknown tool: ${toolName}` };
  }
}
