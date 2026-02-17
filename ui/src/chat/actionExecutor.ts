import { useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { UIAction } from '../capabilities/generated/schema';
import { capabilityRegistry } from '../capabilities/registry';
import type { ActionParamSchema, ConditionSchema } from '../capabilities/types';
import type { ChatAction } from './actions';
import { normalizeQueryFilterParam } from '../utils/filterNormalization';
import { api } from '../api';

export interface ActionExecutorOptions {
  openModal?: (modal: 'create_campaign' | 'email_contact' | 'confirm_delete', payload?: Record<string, unknown>) => void;
  onToast?: (level: 'success' | 'error' | 'info', message: string) => void;
}

type ActionResult = { success: true } | { success: false; error: string };

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
  const navigate = useNavigate();
  const location = useLocation();

  const executeActions = useCallback(
    async (actions: ChatAction[]) => {
      let currentPath = location.pathname;
      let currentParams = new URLSearchParams(location.search);

      const applyRoute = (to: string, replace = false) => {
        const [path, query = ''] = to.split('?');
        currentPath = path || currentPath;
        currentParams = new URLSearchParams(query);
        navigate(
          `${currentPath}${currentParams.toString() ? `?${currentParams.toString()}` : ''}`,
          { replace }
        );
      };

      const executeCapabilityAction = async (action: UIAction): Promise<ActionResult> => {
        const actionRecord = action as unknown as Record<string, unknown>;
        const registration = capabilityRegistry.findAction(String(actionRecord.action));
        if (!registration) {
          return { success: false, error: `Unknown action: ${String(actionRecord.action)}` };
        }

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

        if (registration.action.category === 'navigation') {
          applyRoute(registration.page.route);
          return { success: true };
        }

        if (registration.action.category === 'filter') {
          for (const param of registration.action.params) {
            const value = actionRecord[param.name];
            const normalized = normalizeQueryFilterParam(param.name, value as string | number | boolean | null | undefined);
            if (normalized === null) currentParams.delete(param.name);
            else currentParams.set(param.name, normalized);
          }
          navigate(`${currentPath}${currentParams.toString() ? `?${currentParams.toString()}` : ''}`, { replace: true });
          return { success: true };
        }

        if (registration.action.id === 'companies.expand_row') {
          const companyId = Number(actionRecord.company_id);
          applyRoute(`/companies?selectedCompanyId=${companyId}`);
          return { success: true };
        }
        if (registration.action.id === 'contacts.select_row') {
          const contactId = Number(actionRecord.contact_id);
          applyRoute(`/contacts?selectedContactId=${contactId}`);
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
        if (registration.action.id === 'admin.tests.run_suite') {
          applyRoute('/admin/tests');
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
          const currentUrl = `${location.pathname}${location.search || ''}`;
          if (nextUrl !== currentUrl) {
            navigate(nextUrl, { replace: true });
          }
          continue;
        }

        if (action.type === 'select_contact') {
          applyRoute(`/contacts?selectedContactId=${action.contactId}`);
          continue;
        }

        if (action.type === 'select_company') {
          applyRoute(`/companies?selectedCompanyId=${action.companyId}`);
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
    [location.pathname, location.search, navigate, options]
  );

  return { executeActions };
}
