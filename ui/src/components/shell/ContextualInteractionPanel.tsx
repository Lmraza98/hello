import { AlertTriangle, ArrowUpRight, CheckCircle2, ChevronDown, ChevronUp, Loader2, Pin, PinOff, Sparkles, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { api, type Contact } from '../../api';
import type { WorkspaceInteractionState } from './workspaceLayout';

const STORAGE_PIN_KEY = 'hello_live_ui_tray_pinned_v1';

type ContextualInteractionPanelProps = {
  interaction: WorkspaceInteractionState;
  onOpenRoute?: (route: string) => void;
  onDismiss?: () => void;
};

function routeLabel(route: string): string {
  if (route === '/admin/tests') return 'Admin';
  if (route.startsWith('/')) return route.slice(1) || 'dashboard';
  return route;
}

function parseStoredBool(raw: string | null, fallback: boolean): boolean {
  if (raw == null) return fallback;
  if (raw === '1' || raw.toLowerCase() === 'true') return true;
  if (raw === '0' || raw.toLowerCase() === 'false') return false;
  return fallback;
}

function statusUi(status: WorkspaceInteractionState['status']) {
  if (status === 'success') {
    return {
      label: 'Completed',
      icon: <CheckCircle2 className="h-4 w-4 text-success" />,
      tone: 'text-success',
    };
  }
  if (status === 'failed') {
    return {
      label: 'Failed',
      icon: <AlertTriangle className="h-4 w-4 text-error" />,
      tone: 'text-error',
    };
  }
  return {
    label: 'In progress',
    icon: <Loader2 className="h-4 w-4 animate-spin text-accent" />,
    tone: 'text-accent',
  };
}

function isZeroContactCreateScenario(interaction: WorkspaceInteractionState): boolean {
  return interaction.route === '/contacts' && interaction.resultCount === 0 && Boolean(interaction.createContactPrefill?.name);
}

export function ContextualInteractionPanel({ interaction, onOpenRoute, onDismiss }: ContextualInteractionPanelProps) {
  const route = interaction.route || '/dashboard';
  const hasRouteAction = Boolean(onOpenRoute && interaction.route);
  const [pinned, setPinned] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [appliedChips, setAppliedChips] = useState<string[]>(interaction.chips);
  const [createForm, setCreateForm] = useState({
    name: interaction.createContactPrefill?.name || '',
    email: interaction.createContactPrefill?.email || '',
    phone: interaction.createContactPrefill?.phone || '',
    company_name: interaction.createContactPrefill?.company_name || '',
    title: interaction.createContactPrefill?.title || '',
  });
  const [showMoreFields, setShowMoreFields] = useState(false);
  const [createState, setCreateState] = useState<'idle' | 'saving' | 'success' | 'error'>('idle');
  const [createError, setCreateError] = useState<string | null>(null);

  const statusMeta = useMemo(() => statusUi(interaction.status), [interaction.status]);
  const collapsedMeta = `${routeLabel(route)} • ${interaction.kind} • ${statusMeta.label.toLowerCase()}`;
  const showCreate = isZeroContactCreateScenario(interaction);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    setPinned(parseStoredBool(localStorage.getItem(STORAGE_PIN_KEY), false));
  }, []);

  useEffect(() => {
    setAppliedChips(interaction.chips);
    setCreateForm({
      name: interaction.createContactPrefill?.name || '',
      email: interaction.createContactPrefill?.email || '',
      phone: interaction.createContactPrefill?.phone || '',
      company_name: interaction.createContactPrefill?.company_name || '',
      title: interaction.createContactPrefill?.title || '',
    });
    setShowMoreFields(false);
    setCreateState('idle');
    setCreateError(null);
    setExpanded(pinned);
  }, [interaction, pinned]);

  useEffect(() => {
    localStorage.setItem(STORAGE_PIN_KEY, pinned ? '1' : '0');
    if (pinned) setExpanded(true);
  }, [pinned]);

  useEffect(() => {
    if (pinned || !expanded) return;
    if (interaction.status !== 'success') return;
    const timer = window.setTimeout(() => setExpanded(false), 1400);
    return () => window.clearTimeout(timer);
  }, [interaction.id, interaction.status, expanded, pinned]);

  const createContact = async () => {
    const name = createForm.name.trim();
    if (!name) {
      setCreateState('error');
      setCreateError('Name is required.');
      return;
    }
    setCreateState('saving');
    setCreateError(null);
    try {
      const payload: Partial<Contact> = {
        name,
        email: createForm.email.trim() || null,
        phone: createForm.phone.trim() || null,
        title: createForm.title.trim() || null,
        company_name: createForm.company_name.trim() || 'Unknown Company',
      };
      const created = await api.addContact(payload);
      setCreateState('success');
      if (onOpenRoute && typeof created.id === 'number') {
        onOpenRoute(`/contacts?selectedContactId=${created.id}`);
      }
    } catch (error) {
      setCreateState('error');
      setCreateError(error instanceof Error ? error.message : 'Could not create contact.');
    }
  };

  if (!expanded) {
    return (
      <div className="h-full min-h-0 overflow-y-auto p-3">
        <div className="animate-interaction-border-flow rounded-lg bg-[linear-gradient(110deg,rgba(79,70,229,0.18),rgba(99,102,241,0.62),rgba(96,165,250,0.45),rgba(79,70,229,0.18))] bg-[length:220%_220%] p-[1px]">
          <div className="flex h-11 items-center justify-between rounded-[7px] border border-border/70 bg-surface px-3">
            <div className="min-w-0 flex items-center gap-2">
              {statusMeta.icon}
              <p className="truncate text-sm font-medium text-text">{interaction.label}</p>
              <p className="hidden truncate text-xs text-text-dim md:block">{collapsedMeta}</p>
            </div>
            <div className="flex items-center gap-1">
              <span className="hidden items-center gap-1 rounded-full border border-border bg-bg px-2 py-0.5 text-[11px] text-text-muted sm:inline-flex">
                <Sparkles className="h-3.5 w-3.5 text-accent" />
                assistant-driven
              </span>
              <button
                type="button"
                onClick={() => setExpanded(true)}
                className="rounded border border-border p-1 text-text-muted hover:bg-surface-hover"
                title="Expand live interaction"
              >
                <ChevronDown className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => onDismiss?.()}
                className="rounded border border-border p-1 text-text-muted hover:bg-surface-hover"
                title="Dismiss live interaction"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full min-h-0 overflow-y-auto p-3">
      <div className="animate-interaction-border-flow rounded-xl bg-[linear-gradient(110deg,rgba(79,70,229,0.18),rgba(99,102,241,0.62),rgba(96,165,250,0.45),rgba(79,70,229,0.18))] bg-[length:220%_220%] p-[1px]">
        <div className="rounded-[11px] border border-border/70 bg-surface/95 p-3">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                {statusMeta.icon}
                <h3 className="truncate text-sm font-semibold text-text">{interaction.label}</h3>
              </div>
              <p className="truncate text-xs text-text-dim">{interaction.summary || collapsedMeta}</p>
            </div>
            <div className="flex items-center gap-1">
              {hasRouteAction ? (
                <button
                  type="button"
                  onClick={() => onOpenRoute?.(route)}
                  className="rounded border border-border p-1 text-text-muted hover:bg-surface-hover"
                  title="Open full page"
                >
                  <ArrowUpRight className="h-3.5 w-3.5" />
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => setPinned((prev) => !prev)}
                className="rounded border border-border p-1 text-text-muted hover:bg-surface-hover"
                title={pinned ? 'Unpin tray' : 'Pin tray open'}
              >
                {pinned ? <Pin className="h-3.5 w-3.5" /> : <PinOff className="h-3.5 w-3.5" />}
              </button>
              <button
                type="button"
                onClick={() => setExpanded(false)}
                className="rounded border border-border p-1 text-text-muted hover:bg-surface-hover"
                title="Collapse live interaction"
                disabled={pinned}
              >
                <ChevronUp className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => onDismiss?.()}
                className="rounded border border-border p-1 text-text-muted hover:bg-surface-hover"
                title="Dismiss live interaction"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-text-muted">
            <span className="inline-flex h-6 items-center rounded-full border border-border bg-bg px-2 py-0.5">Target: {routeLabel(route)}</span>
            <span className="inline-flex h-6 items-center rounded-full border border-border bg-bg px-2 py-0.5">Type: {interaction.kind}</span>
            <span className={`inline-flex h-6 items-center rounded-full border border-border bg-bg px-2 py-0.5 ${statusMeta.tone}`}>Status: {statusMeta.label}</span>
            <span className="inline-flex h-6 items-center gap-1 rounded-full border border-border bg-bg px-2 py-0.5">
              <Sparkles className="h-3.5 w-3.5 text-accent" />
              assistant-driven
            </span>
          </div>

          {interaction.resultLabel ? (
            <p className="mt-2 text-sm text-text">
              <span className="font-medium">Result:</span> {interaction.resultLabel}
            </p>
          ) : null}

          {appliedChips.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {appliedChips.map((chip) => (
                <span
                  key={chip}
                  className="inline-flex h-6 items-center rounded-full border border-accent/30 bg-accent/10 px-2 py-0.5 text-xs text-accent"
                >
                  {chip}
                </span>
              ))}
            </div>
          ) : null}

          {showCreate ? (
            <div className="mt-2">
              <p className="text-sm font-medium text-text">No contact found. Add details to create {createForm.name}.</p>
              {interaction.missingFields.length > 0 ? (
                <p className="mt-1 text-xs text-text-dim">Missing: {interaction.missingFields.join(', ')}</p>
              ) : null}
              <div className="mt-2 grid gap-2 md:grid-cols-2">
                <input
                  value={createForm.name}
                  onChange={(event) => setCreateForm((prev) => ({ ...prev, name: event.target.value }))}
                  placeholder="Name"
                  className="w-full rounded-md border border-border bg-bg px-2.5 py-2 text-sm text-text outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
                />
                <input
                  value={createForm.email}
                  onChange={(event) => setCreateForm((prev) => ({ ...prev, email: event.target.value }))}
                  placeholder="Email (optional)"
                  className="w-full rounded-md border border-border bg-bg px-2.5 py-2 text-sm text-text outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
                />
                <input
                  value={createForm.phone}
                  onChange={(event) => setCreateForm((prev) => ({ ...prev, phone: event.target.value }))}
                  placeholder="Phone (optional)"
                  className="w-full rounded-md border border-border bg-bg px-2.5 py-2 text-sm text-text outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
                />
                <input
                  value={createForm.company_name}
                  onChange={(event) => setCreateForm((prev) => ({ ...prev, company_name: event.target.value }))}
                  placeholder="Company (optional)"
                  className="w-full rounded-md border border-border bg-bg px-2.5 py-2 text-sm text-text outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
                />
                {showMoreFields ? (
                  <input
                    value={createForm.title}
                    onChange={(event) => setCreateForm((prev) => ({ ...prev, title: event.target.value }))}
                    placeholder="Title (optional)"
                    className="w-full rounded-md border border-border bg-bg px-2.5 py-2 text-sm text-text outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 md:col-span-2"
                  />
                ) : null}
              </div>
              {createState === 'error' ? <p className="mt-2 text-xs text-error">{createError || 'Unable to create contact.'}</p> : null}
              {createState === 'success' ? <p className="mt-2 text-xs text-success">Contact created.</p> : null}
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void createContact()}
                  disabled={createState === 'saving'}
                  className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-60"
                >
                  {createState === 'saving' ? 'Creating...' : 'Create Contact'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowMoreFields((prev) => !prev)}
                  className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-text-muted hover:bg-surface-hover"
                >
                  {showMoreFields ? 'Hide extra fields' : 'Add more details'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setCreateForm((prev) => ({ ...prev, email: '', phone: '', company_name: '', title: '' }));
                    setShowMoreFields(false);
                  }}
                  className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-text-muted hover:bg-surface-hover"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
