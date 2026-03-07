import { useCallback } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { UIAction } from '../capabilities/generated/schema';
import { capabilityRegistry } from '../capabilities/registry';
import type { ActionParamSchema, ConditionSchema } from '../capabilities/types';
import type { ChatAction } from './actions';
import { normalizeQueryFilterParam } from '../utils/filterNormalization';
import { api } from '../api';
import { dispatchBrowserWorkflowCommand } from '../components/browser/workbenchBridge';
import type { WorkspaceMode } from '../components/shell/workspaceLayout';
import { isContextPreviewAllowed } from '../components/assistant/contextPreviewRules';

export interface ActionExecutorOptions {
  openModal?: (modal: 'create_campaign' | 'email_contact' | 'confirm_delete', payload?: Record<string, unknown>) => void;
  onToast?: (level: 'success' | 'error' | 'info', message: string) => void;
  workspace?: {
    openWorkspace: (options?: { source?: 'sidebar' | 'chat' | 'system'; preferredMode?: WorkspaceMode }) => void;
    closeWorkspace: () => void;
    setWorkspaceMode: (mode: WorkspaceMode) => void;
    setWorkspaceSource: (source: 'sidebar' | 'chat' | 'system') => void;
    ensureVisibleForRoute: (route: string, options?: { source?: 'sidebar' | 'chat' | 'system'; preferredMode?: WorkspaceMode }) => void;
    signalInteraction: (
      kind: 'navigation' | 'filter' | 'workflow' | 'selection',
      label: string,
      options?: {
        route?: string;
        summary?: string;
        chips?: string[];
        source?: 'sidebar' | 'chat' | 'system';
        openWorkspace?: boolean;
        status?: 'in_progress' | 'success' | 'failed';
        resultLabel?: string;
        resultCount?: number;
        createContactPrefill?: { name?: string; email?: string; phone?: string; company_name?: string; title?: string };
        missingFields?: string[];
      }
    ) => void;
    clearInteraction: () => void;
  };
  guidance?: {
    startFlow: (flowId: 'create_contact') => void;
    highlight: (options: {
      elementId: string;
      scrollTargetId?: string | null;
      activeStep?: string | null;
      interaction?: 'highlight' | 'click';
      pointerMode?: 'passthrough' | 'interactive';
      autoClick?: boolean;
    }) => void;
    clearHighlight: () => void;
  };
}

type ActionResult = { success: true } | { success: false; error: string };

export function shouldPreferFullscreenForBrowserAction(actionId: string): boolean {
  return (
    actionId === 'browser.observe' ||
    actionId === 'browser.annotate' ||
    actionId === 'browser.validate' ||
    actionId === 'browser.synthesize'
  );
}

function isCapabilityAction(action: ChatAction): action is UIAction {
  return Boolean(action && typeof action === 'object' && 'action' in action && typeof (action as { action?: unknown }).action === 'string');
}

function isParamTypeValid(value: unknown, schema: ActionParamSchema): boolean {
  if (value == null) return !schema.required;
  if (schema.type === 'string') return typeof value === 'string';
  if (schema.type === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (schema.type === 'boolean') return typeof value === 'boolean';
  if (schema.type === 'string[]') return Array.isArray(value) && value.every((x) => typeof x === 'string');
  if (schema.type === 'number[]') return Array.isArray(value) && value.every((x) => typeof x === 'number' && Number.isFinite(x));
  return false;
}

function checkConditions(action: UIAction, conditions: ConditionSchema[] | undefined): ActionResult {
  const record = action as unknown as Record<string, unknown>;
  if (!conditions || conditions.length === 0) return { success: true };
  for (const condition of conditions) {
    if (condition.type === 'min_selection') {
      const needed = Number(condition.value ?? 1);
      const ids = record.contact_ids || record.company_ids;
      if (!Array.isArray(ids) || ids.length < needed) {
        return { success: false, error: condition.description || `Minimum selection ${needed} not met.` };
      }
    }
    if (condition.type === 'selection_required') {
      const hasSelection =
        Array.isArray(record.contact_ids) ||
        Array.isArray(record.company_ids) ||
        typeof record.contact_id === 'number' ||
        typeof record.company_id === 'number';
      if (!hasSelection) {
        return { success: false, error: condition.description || 'Selection required.' };
      }
    }
  }
  return { success: true };
}

export function useActionExecutor(options: ActionExecutorOptions = {}) {
  const router = useRouter();
  const pathname = usePathname() ?? '';
  const searchParams = useSearchParams();

  const executeActions = useCallback(
    async (actions: ChatAction[]) => {
      let currentPath = pathname;
      let currentParams = new URLSearchParams(searchParams?.toString() ?? '');
      const go = (to: string, replace = false) => {
        if (replace) {
          router.replace(to, { scroll: false });
          return;
        }
        router.push(to, { scroll: false });
      };

      const applyRoute = (
        to: string,
        optionsForRoute: {
          replace?: boolean;
          revealWorkspace?: boolean;
          source?: 'sidebar' | 'chat' | 'system';
          interaction?: {
            kind: 'navigation' | 'filter' | 'workflow' | 'selection';
            label: string;
            summary?: string;
            chips?: string[];
            status?: 'in_progress' | 'success' | 'failed';
            resultLabel?: string;
            resultCount?: number;
            createContactPrefill?: { name?: string; email?: string; phone?: string; company_name?: string; title?: string };
            missingFields?: string[];
          };
        } = {}
      ) => {
        const [path, query = ''] = to.split('?');
        currentPath = path || currentPath;
        currentParams = new URLSearchParams(query);
        const source = optionsForRoute.source || 'chat';
        if (optionsForRoute.revealWorkspace) {
          options.workspace?.ensureVisibleForRoute(currentPath, { source });
        } else {
          options.workspace?.setWorkspaceSource(source);
          options.workspace?.clearInteraction();
        }
        if (optionsForRoute.interaction) {
          const previewAllowed = isContextPreviewAllowed({
            kind: optionsForRoute.interaction.kind,
            route: currentPath,
          });
          options.workspace?.signalInteraction(
            optionsForRoute.interaction.kind,
            optionsForRoute.interaction.label,
            {
              source,
              route: currentPath,
              summary: optionsForRoute.interaction.summary,
              chips: optionsForRoute.interaction.chips,
              openWorkspace: previewAllowed,
              status: optionsForRoute.interaction.status || 'success',
              resultLabel: optionsForRoute.interaction.resultLabel,
              resultCount: optionsForRoute.interaction.resultCount,
              createContactPrefill: optionsForRoute.interaction.createContactPrefill,
              missingFields: optionsForRoute.interaction.missingFields,
            }
          );
        }
        go(
          `${currentPath}${currentParams.toString() ? `?${currentParams.toString()}` : ''}`,
          optionsForRoute.replace ?? false
        );
      };

      const executeCapabilityAction = async (action: UIAction): Promise<ActionResult> => {
        const actionRecord = action as unknown as Record<string, unknown>;
        const registration = capabilityRegistry.findAction(String(actionRecord.action));
        if (!registration) {
          return { success: false, error: `Unknown action: ${String(actionRecord.action)}` };
        }
        const apiJson = async (url: string, init?: RequestInit) => {
          const res = await fetch(url, {
            headers: { 'Content-Type': 'application/json' },
            ...init,
          });
          if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            throw new Error((body as { detail?: string }).detail || `Request failed: ${res.status}`);
          }
          return res.json().catch(() => ({}));
        };

        for (const param of registration.action.params) {
          const value = actionRecord[param.name];
          if (param.required && value === undefined) {
            return { success: false, error: `Missing required param: ${param.name}` };
          }
          if (!isParamTypeValid(value, param)) {
            return { success: false, error: `Invalid type for param: ${param.name}` };
          }
          if (param.enum && value != null && !param.enum.includes(String(value))) {
            return { success: false, error: `Invalid value for param: ${param.name}` };
          }
        }

        const conditionResult = checkConditions(action, registration.action.conditions);
        if (!conditionResult.success) return conditionResult;

        if (registration.action.destructive) {
          console.warn(`Destructive action "${String(actionRecord.action)}" reached executor; requiring safety confirmation.`);
          const ok = window.confirm(`Confirm: ${registration.action.label}\n\n${registration.action.description}`);
          if (!ok) return { success: false, error: 'User cancelled' };
        }
        const preferFullscreen = shouldPreferFullscreenForBrowserAction(registration.action.id);

        if (registration.action.id === 'workspace.open') {
          options.workspace?.openWorkspace({ source: 'chat' });
          return { success: true };
        }
        if (registration.action.id === 'workspace.close') {
          options.workspace?.clearInteraction();
          options.workspace?.closeWorkspace();
          return { success: true };
        }
        if (registration.action.id === 'workspace.expand') {
          options.workspace?.setWorkspaceMode('fullscreen');
          options.workspace?.openWorkspace({ source: 'chat', preferredMode: 'fullscreen' });
          return { success: true };
        }
        if (registration.action.id === 'workspace.dock') {
          options.workspace?.setWorkspaceMode('drawer');
          options.workspace?.openWorkspace({ source: 'chat', preferredMode: 'drawer' });
          return { success: true };
        }

        if (registration.action.id === 'browser.observe') {
          if (preferFullscreen) options.workspace?.setWorkspaceMode('fullscreen');
          applyRoute('/browser', {
            revealWorkspace: true,
            interaction: {
              kind: 'workflow',
              label: 'Observing page structure',
              summary: 'Browser workbench is scanning interactive elements and extracting likely targets.',
              status: 'in_progress',
              resultLabel: 'Scanning page...',
            },
          });
          dispatchBrowserWorkflowCommand({ action: 'observe', source: 'chat', preferFullscreen });
          return { success: true };
        }
        if (registration.action.id === 'browser.annotate') {
          const hrefPattern = typeof actionRecord.href_pattern === 'string' ? actionRecord.href_pattern : undefined;
          if (preferFullscreen) options.workspace?.setWorkspaceMode('fullscreen');
          applyRoute('/browser', {
            revealWorkspace: true,
            interaction: {
              kind: 'workflow',
              label: 'Annotating examples',
              summary: hrefPattern
                ? `Applying hints with href pattern "${hrefPattern}".`
                : 'Marking positive and negative examples for extraction.',
              chips: hrefPattern ? [`href pattern: ${hrefPattern}`] : [],
              status: 'in_progress',
              resultLabel: 'Annotating candidates...',
            },
          });
          dispatchBrowserWorkflowCommand({ action: 'annotate', source: 'chat', hrefPattern: hrefPattern || undefined, preferFullscreen });
          return { success: true };
        }
        if (registration.action.id === 'browser.synthesize') {
          if (preferFullscreen) options.workspace?.setWorkspaceMode('fullscreen');
          applyRoute('/browser', {
            revealWorkspace: true,
            interaction: {
              kind: 'workflow',
              label: 'Synthesizing extraction rule',
              summary: 'Combining selected examples into a deterministic browser workflow pattern.',
              status: 'in_progress',
              resultLabel: 'Synthesizing rule...',
            },
          });
          dispatchBrowserWorkflowCommand({ action: 'synthesize', source: 'chat', preferFullscreen });
          return { success: true };
        }
        if (registration.action.id === 'browser.validate') {
          if (preferFullscreen) options.workspace?.setWorkspaceMode('fullscreen');
          applyRoute('/browser', {
            revealWorkspace: true,
            interaction: {
              kind: 'workflow',
              label: 'Validating extracted rows',
              summary: 'Running candidate selectors against the current page and checking sample output quality.',
              status: 'in_progress',
              resultLabel: 'Validating extracted rows...',
            },
          });
          dispatchBrowserWorkflowCommand({ action: 'validate', source: 'chat', preferFullscreen });
          return { success: true };
        }

        if (registration.action.category === 'navigation') {
          applyRoute(registration.page.route);
          return { success: true };
        }

        if (registration.action.category === 'filter') {
          const [routePath, routeQuery = ''] = registration.page.route.split('?');
          if (currentPath !== routePath) {
            currentPath = routePath || currentPath;
            currentParams = new URLSearchParams(routeQuery);
          }
          for (const param of registration.action.params) {
            const value = actionRecord[param.name];
            const normalized = normalizeQueryFilterParam(param.name, value as string | number | boolean | null | undefined);
            if (normalized === null) currentParams.delete(param.name);
            else currentParams.set(param.name, normalized);
          }
          options.workspace?.setWorkspaceSource('chat');
          options.workspace?.clearInteraction();
          go(`${currentPath}${currentParams.toString() ? `?${currentParams.toString()}` : ''}`, true);
          return { success: true };
        }

        if (registration.action.id === 'companies.expand_row') {
          applyRoute('/contacts');
          return { success: true };
        }
        if (registration.action.id === 'contacts.select_row') {
          const contactId = Number(actionRecord.contact_id);
          applyRoute(`/contacts?selectedContactId=${contactId}`);
          return { success: true };
        }
        if (registration.action.id === 'documents.select_row') {
          const documentId = String(actionRecord.document_id || '').trim();
          if (!documentId) return { success: false, error: 'document_id is required' };
          applyRoute(`/documents?selectedDocumentId=${encodeURIComponent(documentId)}`);
          return { success: true };
        }

        if (registration.action.id === 'companies.delete_selected') {
          await api.bulkDeleteCompanies(((actionRecord.company_ids as number[]) || []).map(Number));
          return { success: true };
        }
        if (registration.action.id === 'companies.reset_all') {
          await api.resetCompanies();
          return { success: true };
        }
        if (registration.action.id === 'contacts.bulk_delete') {
          await api.bulkDeleteContacts(((actionRecord.contact_ids as number[]) || []).map(Number));
          return { success: true };
        }
        if (registration.action.id === 'contacts.bulk_send_email') {
          await api.sendEmailsToContacts(((actionRecord.contact_ids as number[]) || []).map(Number));
          return { success: true };
        }
        if (registration.action.id === 'contacts.bulk_linkedin_request') {
          await fetch('/api/contacts/bulk-actions/linkedin-request', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contact_ids: ((actionRecord.contact_ids as number[]) || []).map(Number) }),
          });
          return { success: true };
        }
        if (registration.action.id === 'email.campaigns.activate') {
          await fetch(`/api/emails/campaigns/${Number(actionRecord.campaign_id)}/activate`, { method: 'POST' });
          return { success: true };
        }
        if (registration.action.id === 'email.campaigns.pause') {
          await fetch(`/api/emails/campaigns/${Number(actionRecord.campaign_id)}/pause`, { method: 'POST' });
          return { success: true };
        }
        if (registration.action.id === 'email.review.approve') {
          await api.approveEmail(Number(actionRecord.email_id));
          return { success: true };
        }
        if (registration.action.id === 'email.review.reject') {
          await api.discardEmail(Number(actionRecord.email_id));
          return { success: true };
        }
        if (registration.action.id === 'email.scheduled.send_now') {
          await fetch(`/api/emails/scheduled-emails/${Number(actionRecord.email_id)}/send-now`, { method: 'POST' });
          return { success: true };
        }
        if (registration.action.id === 'documents.retry_processing') {
          const documentId = String(actionRecord.document_id || '').trim();
          if (!documentId) return { success: false, error: 'document_id is required' };
          await api.retryDocumentProcessing(documentId);
          return { success: true };
        }
        if (registration.action.id === 'documents.link_entities') {
          const documentId = String(actionRecord.document_id || '').trim();
          if (!documentId) return { success: false, error: 'document_id is required' };
          const companyId = typeof actionRecord.company_id === 'number' ? Number(actionRecord.company_id) : undefined;
          const contactIds = Array.isArray(actionRecord.contact_ids)
            ? (actionRecord.contact_ids as number[]).map(Number).filter((id) => Number.isFinite(id))
            : undefined;
          await api.linkDocumentToEntities({
            document_id: documentId,
            company_id: companyId,
            contact_ids: contactIds,
          });
          return { success: true };
        }
        if (registration.action.id === 'documents.ask') {
          const question = String(actionRecord.question || '').trim();
          if (!question) return { success: false, error: 'question is required' };
          const documentIds = Array.isArray(actionRecord.document_ids)
            ? (actionRecord.document_ids as string[]).map((item) => String(item).trim()).filter(Boolean)
            : undefined;
          const result = await api.askDocuments({ question, document_ids: documentIds });
          options.onToast?.('info', result.answer || 'Documents query completed.');
          if (documentIds && documentIds.length > 0) {
            applyRoute(`/documents?selectedDocumentId=${encodeURIComponent(documentIds[0])}`);
          } else {
            applyRoute('/documents');
          }
          return { success: true };
        }
        if (registration.action.id === 'admin.tests.run_suite') {
          applyRoute('/admin/tests');
          return { success: true };
        }
        if (registration.action.id === 'templates.create') {
          const payload = {
            name: String(actionRecord.name || ''),
            subject: String(actionRecord.subject || ''),
            html_body: String(actionRecord.html_body || ''),
            preheader: actionRecord.preheader ? String(actionRecord.preheader) : undefined,
            from_name: actionRecord.from_name ? String(actionRecord.from_name) : undefined,
            from_email: actionRecord.from_email ? String(actionRecord.from_email) : undefined,
            reply_to: actionRecord.reply_to ? String(actionRecord.reply_to) : undefined,
            text_body: actionRecord.text_body ? String(actionRecord.text_body) : undefined,
          };
          const created = await apiJson('/api/emails/templates', { method: 'POST', body: JSON.stringify(payload) }) as { id?: number };
          if (typeof created.id === 'number') {
            applyRoute(`/templates?selectedTemplateId=${created.id}`);
          } else {
            applyRoute('/templates');
          }
          return { success: true };
        }
        if (registration.action.id === 'templates.update') {
          const templateId = Number(actionRecord.template_id);
          const payload: Record<string, unknown> = {};
          const fields = ['name', 'subject', 'html_body', 'preheader', 'from_name', 'from_email', 'reply_to', 'text_body', 'status'];
          for (const field of fields) {
            if (field in actionRecord && actionRecord[field] != null) payload[field] = actionRecord[field];
          }
          await apiJson(`/api/emails/templates/${templateId}`, { method: 'PUT', body: JSON.stringify(payload) });
          applyRoute(`/templates?selectedTemplateId=${templateId}`);
          return { success: true };
        }
        if (registration.action.id === 'templates.duplicate') {
          const templateId = Number(actionRecord.template_id);
          const duplicated = await apiJson(`/api/emails/templates/${templateId}/duplicate`, { method: 'POST' }) as { id?: number };
          if (typeof duplicated.id === 'number') {
            applyRoute(`/templates?selectedTemplateId=${duplicated.id}`);
          } else {
            applyRoute('/templates');
          }
          return { success: true };
        }
        if (registration.action.id === 'templates.archive') {
          const templateId = Number(actionRecord.template_id);
          await apiJson(`/api/emails/templates/${templateId}/archive`, { method: 'POST' });
          applyRoute('/templates?status=archived');
          return { success: true };
        }
        if (registration.action.id === 'templates.validate') {
          const payload = {
            subject: String(actionRecord.subject || ''),
            html: String(actionRecord.html || ''),
            from_email: actionRecord.from_email ? String(actionRecord.from_email) : undefined,
          };
          const result = await apiJson('/api/emails/templates/validate', { method: 'POST', body: JSON.stringify(payload) }) as { errors?: string[]; warnings?: string[] };
          const errCount = (result.errors || []).length;
          const warnCount = (result.warnings || []).length;
          options.onToast?.(errCount > 0 ? 'error' : 'success', `Template validation complete (${errCount} errors, ${warnCount} warnings).`);
          applyRoute('/templates');
          return { success: true };
        }
        if (registration.action.id === 'templates.test_send') {
          const templateId = Number(actionRecord.template_id);
          const payload = {
            to_email: String(actionRecord.to_email || ''),
            contact_id: typeof actionRecord.contact_id === 'number' ? Number(actionRecord.contact_id) : undefined,
          };
          const result = await apiJson(`/api/emails/templates/${templateId}/test-send`, { method: 'POST', body: JSON.stringify(payload) }) as { message?: string };
          options.onToast?.('success', result.message || 'Template test send completed.');
          applyRoute(`/templates?selectedTemplateId=${templateId}`);
          return { success: true };
        }
        return { success: false, error: `No executor mapping for action: ${registration.action.id}` };
      };

      for (const action of actions) {
        if (isCapabilityAction(action)) {
          const result = await executeCapabilityAction(action);
          if (!result.success) {
            options.onToast?.('error', result.error);
          }
          continue;
        }

        if (action.type === 'navigate') {
          applyRoute(action.to);
          continue;
        }

        if (action.type === 'set_filter') {
          const normalized = normalizeQueryFilterParam(action.key, action.value);
          if (normalized === null) currentParams.delete(action.key);
          else currentParams.set(action.key, normalized);
          const nextUrl = `${currentPath}${currentParams.toString() ? `?${currentParams.toString()}` : ''}`;
          const currentQuery = searchParams?.toString() ?? '';
          const currentUrl = `${pathname}${currentQuery ? `?${currentQuery}` : ''}`;
          if (nextUrl !== currentUrl) {
            options.workspace?.setWorkspaceSource('chat');
            options.workspace?.clearInteraction();
            go(nextUrl, true);
          }
          continue;
        }

        if (action.type === 'select_contact') {
          applyRoute(`/contacts?selectedContactId=${action.contactId}`);
          continue;
        }

        if (action.type === 'select_company') {
          applyRoute('/contacts');
          continue;
        }

        if (action.type === 'assistant_guide') {
          const elementId = String(action.highlightedElementId || '').trim();
          if (!elementId) {
            options.guidance?.clearHighlight();
          } else {
            options.guidance?.highlight({
              elementId,
              scrollTargetId: action.scrollTargetId,
              activeStep: action.activeStep,
              interaction: action.interaction,
              pointerMode: action.pointerMode,
              autoClick: action.autoClick,
            });
          }
          continue;
        }

        if (action.type === 'assistant_guide_clear') {
          options.guidance?.clearHighlight();
          continue;
        }

        if (action.type === 'assistant_ui_set_target') {
          const elementId = String(action.targetId || '').trim();
          if (!elementId) {
            options.guidance?.clearHighlight();
          } else {
            options.guidance?.highlight({
              elementId,
              scrollTargetId: action.scrollTargetId,
              activeStep: action.instruction,
              interaction: action.interaction,
              pointerMode: action.pointerMode,
              autoClick: action.autoClick,
            });
          }
          continue;
        }

        if (action.type === 'assistant_ui_start_flow') {
          options.guidance?.startFlow(action.flowId);
          continue;
        }

        if (action.type === 'assistant_ui_clear') {
          options.guidance?.clearHighlight();
          continue;
        }

        if (action.type === 'open_modal') {
          options.openModal?.(action.modal, action.payload);
          continue;
        }

        if (action.type === 'toast') {
          options.onToast?.(action.level, action.message);
          continue;
        }

        if (action.type === 'run_command') {
          const destructive = action.command === 'delete_contact';
          if (destructive) {
            const ok = window.confirm('Confirm destructive action: delete contact?');
            if (!ok) continue;
          }
          if (action.command === 'sync_to_sf') {
            const id = Number(action.payload.contactId);
            if (Number.isFinite(id)) await api.syncToSalesforce(id);
          } else if (action.command === 'delete_contact') {
            const id = Number(action.payload.contactId);
            if (Number.isFinite(id)) await api.deleteContact(id);
          } else if (action.command === 'add_to_campaign') {
            const campaignId = Number(action.payload.campaignId);
            const contactId = Number(action.payload.contactId);
            if (Number.isFinite(campaignId) && Number.isFinite(contactId)) {
              await api.enrollInCampaign(campaignId, [contactId]);
            }
          }
        }
      }
    },
    [pathname, searchParams, router, options]
  );

  return { executeActions };
}
