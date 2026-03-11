import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, Copy, FileText, RefreshCcw, Send, ShieldAlert, X } from 'lucide-react';
import { emailApi } from '../api/emailApi';
import type { EmailLibraryTemplate, EmailTemplateBlock, EmailTemplateRevision } from '../types/email';
import { PageSearchInput } from '../components/shared/PageSearchInput';
import { WorkspacePageShell } from '../components/shared/WorkspacePageShell';
import { EmailTabs } from '../components/email/EmailTabs';
import { useNotificationContext } from '../contexts/NotificationContext';
import { useRegisterCapabilities } from '../capabilities/useRegisterCapabilities';
import { getPageCapability } from '../capabilities/catalog';
import { useIsMobile } from '../hooks/useIsMobile';
import { useTemplateDetailsRouteState } from '../hooks/useTemplateDetailsRouteState';
import { SidePanelContainer } from '../components/contacts/SidePanelContainer';
import { BottomDrawerContainer } from '../components/contacts/BottomDrawerContainer';
import { useRouter } from 'next/navigation';
import { TableHeaderFilter } from '../components/shared/TableHeaderFilter';
import { EmptyState } from '../components/shared/EmptyState';
import { StandardEmailTable, type StandardEmailColumn } from '../components/email/StandardEmailTable';

const TOKENS = [
  '{{firstName}}',
  '{{lastName}}',
  '{{fullName}}',
  '{{email}}',
  '{{company}}',
  '{{title}}',
  '{{industry}}',
  '{{location}}',
  '{{unsubscribeUrl}}',
  '{{viewInBrowserUrl}}',
  '{{trackingPixel}}',
  '{{campaignName}}',
];

type DraftTemplate = Partial<EmailLibraryTemplate>;
const EMPTY_TEMPLATES: EmailLibraryTemplate[] = [];
const EMPTY_BLOCKS: EmailTemplateBlock[] = [];
const EMPTY_REVISIONS: EmailTemplateRevision[] = [];
const VALID_TEMPLATE_STATUS = new Set(['active', 'archived', 'all']);

function formatUpdatedAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleDateString();
}

function emptyDraft(): DraftTemplate {
  return {
    name: '',
    subject: '',
    preheader: '',
    from_name: '',
    from_email: '',
    reply_to: '',
    html_body: '',
    text_body: '',
    status: 'active',
  };
}

export default function Templates() {
  const router = useRouter();
  useRegisterCapabilities(getPageCapability('templates'));
  const isPhone = useIsMobile(640);
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const { addNotification } = useNotificationContext();
  const { templateId: selectedId, openTemplate, closeTemplate } = useTemplateDetailsRouteState();
  const querySearch = searchParams?.get('q') ?? '';
  const queryStatusRaw = searchParams?.get('status');
  const queryStatus =
    queryStatusRaw && VALID_TEMPLATE_STATUS.has(queryStatusRaw)
      ? (queryStatusRaw as 'all' | 'active' | 'archived')
      : 'active';

  const [search, setSearch] = useState(querySearch);
  const [status, setStatus] = useState<'all' | 'active' | 'archived'>(queryStatus);
  const [openHeaderFilterId, setOpenHeaderFilterId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [draft, setDraft] = useState<DraftTemplate>(emptyDraft());
  const [sampleContactId, setSampleContactId] = useState('');
  const [previewHtml, setPreviewHtml] = useState('');
  const [previewText, setPreviewText] = useState('');
  const [warnings, setWarnings] = useState<string[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [testEmail, setTestEmail] = useState('');
  const [showImport, setShowImport] = useState(false);
  const [importJson, setImportJson] = useState('');
  const [selectedRevision, setSelectedRevision] = useState<number | null>(null);
  const [viewportControlsTarget, setViewportControlsTarget] = useState<HTMLDivElement | null>(null);

  const editorOpen = isCreating || selectedId !== null;

  const templatesQuery = useQuery({
    queryKey: ['templates-library', search, status],
    queryFn: () => emailApi.listTemplateLibrary(search || undefined, status === 'all' ? undefined : status),
  });

  const blocksQuery = useQuery({
    queryKey: ['template-blocks'],
    queryFn: () => emailApi.listTemplateBlocks('active'),
  });

  const revisionsQuery = useQuery({
    queryKey: ['template-revisions', selectedId],
    queryFn: () =>
      selectedId ? emailApi.getTemplateRevisions(selectedId) : Promise.resolve([] as EmailTemplateRevision[]),
    enabled: selectedId !== null,
  });

  const templates = templatesQuery.data ?? EMPTY_TEMPLATES;
  const blocks = blocksQuery.data ?? EMPTY_BLOCKS;
  const revisions = revisionsQuery.data ?? EMPTY_REVISIONS;
  const selectedTemplate = useMemo(
    () => (selectedId ? templates.find((t) => t.id === selectedId) ?? null : null),
    [selectedId, templates]
  );
  const draftValue = useMemo(() => {
    if (!isCreating && selectedTemplate && draft.id !== selectedTemplate.id) return selectedTemplate;
    return draft;
  }, [draft, isCreating, selectedTemplate]);

  const refreshAll = () => {
    queryClient.invalidateQueries({ queryKey: ['templates-library'] });
    queryClient.invalidateQueries({ queryKey: ['template-revisions'] });
    queryClient.invalidateQueries({ queryKey: ['template-blocks'] });
  };

  const clearRunState = () => {
    setPreviewHtml('');
    setPreviewText('');
    setWarnings([]);
    setErrors([]);
    setSelectedRevision(null);
  };

  const createMutation = useMutation({
    mutationFn: () => emailApi.createTemplateLibraryItem(draftValue),
    onSuccess: (created) => {
      addNotification({ type: 'success', title: 'Template created' });
      setIsCreating(false);
      openTemplate(created.id);
      setDraft(created);
      refreshAll();
    },
  });

  const saveMutation = useMutation({
    mutationFn: () => {
      if (!selectedId) throw new Error('No template selected');
      return emailApi.updateTemplateLibraryItem(selectedId, draftValue);
    },
    onSuccess: (saved) => {
      addNotification({ type: 'success', title: 'Template saved' });
      setDraft(saved);
      setIsCreating(false);
      refreshAll();
    },
  });

  const duplicateMutation = useMutation({
    mutationFn: () => {
      if (!selectedId) throw new Error('No template selected');
      return emailApi.duplicateTemplateLibraryItem(selectedId);
    },
    onSuccess: (created) => {
      addNotification({ type: 'success', title: 'Template duplicated' });
      setIsCreating(false);
      openTemplate(created.id);
      setDraft(created);
      refreshAll();
    },
  });

  const archiveMutation = useMutation({
    mutationFn: () => {
      if (!selectedId) throw new Error('No template selected');
      return emailApi.archiveTemplateLibraryItem(selectedId);
    },
    onSuccess: () => {
      addNotification({ type: 'success', title: 'Template archived' });
      setIsCreating(false);
      closeTemplate();
      setDraft(emptyDraft());
      clearRunState();
      refreshAll();
    },
  });

  const validateMutation = useMutation({
    mutationFn: () =>
      emailApi.validateTemplateContent({
        subject: draftValue.subject || '',
        html: draftValue.html_body || '',
        from_email: draftValue.from_email || undefined,
      }),
    onSuccess: (result) => {
      setWarnings(result.warnings || []);
      setErrors(result.errors || []);
      addNotification({
        type: (result.errors || []).length > 0 ? 'error' : 'success',
        title: (result.errors || []).length > 0 ? 'Validation failed' : 'Validation complete',
      });
    },
  });

  const previewMutation = useMutation({
    mutationFn: () => {
      if (!selectedId) throw new Error('Select a template first');
      const cid = sampleContactId ? Number(sampleContactId) : undefined;
      return emailApi.renderTemplateLibraryItem(selectedId, { contact_id: cid });
    },
    onSuccess: (result) => {
      setPreviewHtml(result.sanitized_html || result.html || '');
      setPreviewText(result.text || '');
      setWarnings(result.warnings || []);
      setErrors(result.errors || []);
    },
  });

  const testSendMutation = useMutation({
    mutationFn: () => {
      if (!selectedId) throw new Error('Select a template first');
      return emailApi.testSendTemplate(selectedId, {
        to_email: testEmail,
        contact_id: sampleContactId ? Number(sampleContactId) : undefined,
      });
    },
    onSuccess: (result) => {
      addNotification({
        type: (result.errors || []).length > 0 ? 'error' : 'success',
        title: 'Test send complete',
        message: result.message,
      });
      setWarnings(result.warnings || []);
      setErrors(result.errors || []);
    },
  });

  const revertMutation = useMutation({
    mutationFn: () => {
      if (!selectedId || !selectedRevision) throw new Error('Select a revision first');
      return emailApi.revertTemplateRevision(selectedId, selectedRevision);
    },
    onSuccess: (saved) => {
      setDraft(saved);
      refreshAll();
      addNotification({ type: 'success', title: 'Template reverted' });
    },
  });

  const importMutation = useMutation({
    mutationFn: () => emailApi.importTemplateLibraryItem(JSON.parse(importJson)),
    onSuccess: (created) => {
      setIsCreating(false);
      openTemplate(created.id);
      setDraft(created);
      setShowImport(false);
      setImportJson('');
      refreshAll();
      addNotification({ type: 'success', title: 'Template imported' });
    },
    onError: (err: Error) => {
      addNotification({ type: 'error', title: 'Import failed', message: err.message });
    },
  });

  const selectTemplate = (item: EmailLibraryTemplate) => {
    setIsCreating(false);
    openTemplate(item.id);
    setDraft(item);
    clearRunState();
  };

  const closeEditor = () => {
    setIsCreating(false);
    closeTemplate();
  };

  const beginCreate = () => {
    setIsCreating(true);
    closeTemplate();
    setDraft(emptyDraft());
    clearRunState();
  };

  useEffect(() => {
    if (!selectedId || templatesQuery.isLoading) return;
    const found = templates.some((t) => t.id === selectedId);
    if (!found) closeTemplate();
  }, [selectedId, templates, templatesQuery.isLoading, closeTemplate]);

  const handleInsert = (text: string) => {
    setDraft((prev) => {
      const base = !isCreating && selectedTemplate && prev.id !== selectedTemplate.id ? selectedTemplate : prev;
      return { ...base, html_body: `${base.html_body || ''}${text}` };
    });
  };

  const listSubtitle = useMemo(() => `${templates.length} templates`, [templates.length]);
  const handleDuplicateTemplate = async (template: EmailLibraryTemplate) => {
    const created = await emailApi.duplicateTemplateLibraryItem(template.id);
    setIsCreating(false);
    openTemplate(created.id);
    setDraft(created);
    refreshAll();
    addNotification({ type: 'success', title: 'Template duplicated' });
  };

  const handleArchiveTemplate = async (template: EmailLibraryTemplate) => {
    await emailApi.archiveTemplateLibraryItem(template.id);
    if (selectedId === template.id) {
      setIsCreating(false);
      closeTemplate();
      setDraft(emptyDraft());
      clearRunState();
    }
    refreshAll();
    addNotification({ type: 'success', title: 'Template archived' });
  };

  const handleCopyTemplateExport = async (template: EmailLibraryTemplate) => {
    const exported = await emailApi.exportTemplateLibraryItem(template.id);
    await navigator.clipboard.writeText(JSON.stringify(exported, null, 2));
    addNotification({ type: 'success', title: 'Template JSON copied' });
  };

  const templateColumns = useMemo<StandardEmailColumn<EmailLibraryTemplate>[]>(
    () => [
      {
        key: 'name',
        label: 'Name',
        minWidth: 220,
        defaultWidth: 260,
        maxWidth: 420,
        render: (item) => <span className="block truncate text-sm text-text">{item.name || '-'}</span>,
        measureValue: (item) => item.name || '-',
      },
      {
        key: 'subject',
        label: 'Subject',
        minWidth: 240,
        defaultWidth: 340,
        maxWidth: 520,
        render: (item) => <span className="block truncate text-xs text-text-muted">{item.subject || '-'}</span>,
        measureValue: (item) => item.subject || '-',
      },
      {
        key: 'status',
        label: 'Status',
        header: (
          <div className="flex items-center gap-1">
            <span>Status</span>
            <TableHeaderFilter
              open={openHeaderFilterId === 'status'}
              active={status !== 'active'}
              label="Status"
              onToggle={() => setOpenHeaderFilterId((value) => (value === 'status' ? null : 'status'))}
            >
              <select
                value={status}
                onChange={(event) => setStatus(event.target.value as 'all' | 'active' | 'archived')}
                className="h-7 w-full rounded-none border border-border bg-surface px-2 text-[11px] text-text focus:border-accent focus:outline-none"
              >
                <option value="active">Active</option>
                <option value="archived">Archived</option>
                <option value="all">All</option>
              </select>
            </TableHeaderFilter>
          </div>
        ),
        minWidth: 96,
        defaultWidth: 108,
        maxWidth: 150,
        render: (item) => (
          <span
            className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium ${
              item.status === 'active' ? 'bg-emerald-500/15 text-emerald-700' : 'bg-amber-500/15 text-amber-700'
            }`}
          >
            {item.status}
          </span>
        ),
        measureValue: (item) => item.status,
      },
      {
        key: 'updated_at',
        label: 'Updated',
        minWidth: 120,
        defaultWidth: 132,
        maxWidth: 180,
        align: 'right',
        render: (item) => <span className="block truncate text-xs text-text-muted">{formatUpdatedAt(item.updated_at)}</span>,
        measureValue: (item) => formatUpdatedAt(item.updated_at),
      },
    ],
    [openHeaderFilterId, status],
  );
  const emailTabs = useMemo(
    () => [
      { id: 'campaigns', label: 'Campaigns' },
      { id: 'templates', label: 'Templates' },
      { id: 'review', label: 'Review' },
      { id: 'scheduled', label: 'Scheduled' },
      { id: 'history', label: 'Sent History' },
    ],
    []
  );

  const editorPane = (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      <div className="sticky top-0 z-20 shrink-0 border-b border-border bg-surface">
        <div className="px-3 pb-2 pt-3">
          <h3 className="truncate text-sm font-semibold text-text">{selectedId ? draftValue.name || 'Template' : 'New Template'}</h3>
          <p className="truncate text-xs text-text-muted">
            {selectedId ? `Template #${selectedId}` : 'Create a reusable template'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 px-3 pb-2">
          <span className="inline-flex h-5 items-center rounded-full border border-border bg-bg px-2 text-[11px] text-text-muted capitalize">
            {draftValue.status || 'active'}
          </span>
          {selectedId ? (
            <span className="inline-flex h-5 items-center rounded-full border border-border bg-bg px-2 text-[11px] text-text-muted">
              {revisions.length} revisions
            </span>
          ) : null}
          <span className="inline-flex h-5 items-center rounded-full border border-border bg-bg px-2 text-[11px] text-text-muted">
            {blocks.length} blocks
          </span>
          <button
            type="button"
            onClick={closeEditor}
            aria-label="Close template editor"
            className="ml-auto inline-flex h-7 w-7 items-center justify-center border border-border text-text-muted hover:bg-surface-hover"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar border-t border-border px-3 py-2 whitespace-nowrap">
          <button
            type="button"
            onClick={() => (selectedId ? saveMutation.mutate() : createMutation.mutate())}
            className="inline-flex h-7 shrink-0 items-center border border-border bg-bg px-2.5 text-xs text-text hover:bg-surface-hover"
          >
            {selectedId ? 'Save' : 'Create'}
          </button>
          <button
            type="button"
            onClick={() => duplicateMutation.mutate()}
            disabled={!selectedId}
            className="inline-flex h-7 shrink-0 items-center gap-1 border border-border bg-bg px-2.5 text-xs text-text hover:bg-surface-hover disabled:opacity-50"
          >
            <Copy className="h-3.5 w-3.5" />
            Duplicate
          </button>
          <button
            type="button"
            onClick={() => archiveMutation.mutate()}
            disabled={!selectedId}
            className="inline-flex h-7 shrink-0 items-center gap-1 border border-border bg-bg px-2.5 text-xs text-text hover:bg-surface-hover disabled:opacity-50"
          >
            <Archive className="h-3.5 w-3.5" />
            Archive
          </button>
          <button
            type="button"
            onClick={() => validateMutation.mutate()}
            className="inline-flex h-7 shrink-0 items-center gap-1 border border-border bg-bg px-2.5 text-xs text-text hover:bg-surface-hover"
          >
            <ShieldAlert className="h-3.5 w-3.5" />
            Validate
          </button>
          <button
            type="button"
            onClick={() => previewMutation.mutate()}
            disabled={!selectedId}
            className="inline-flex h-7 shrink-0 items-center gap-1 border border-border bg-bg px-2.5 text-xs text-text hover:bg-surface-hover disabled:opacity-50"
          >
            <RefreshCcw className="h-3.5 w-3.5" />
            Render Preview
          </button>
          <input
            value={testEmail}
            onChange={(e) => setTestEmail(e.target.value)}
            placeholder="test@company.com"
            className="h-7 w-52 shrink-0 border border-border bg-bg px-2.5 text-xs text-text focus:outline-none"
          />
          <button
            type="button"
            onClick={() => testSendMutation.mutate()}
            disabled={!selectedId || !testEmail.trim()}
            className="inline-flex h-7 shrink-0 items-center gap-1 border border-border bg-bg px-2.5 text-xs text-text hover:bg-surface-hover disabled:opacity-50"
          >
            <Send className="h-3.5 w-3.5" />
            Test Send
          </button>
        </div>
      </div>

      {showImport ? (
        <div className="shrink-0 border-b border-border bg-bg/60 px-3 py-2">
          <textarea
            value={importJson}
            onChange={(e) => setImportJson(e.target.value)}
            rows={5}
            placeholder="Paste template export JSON"
            className="w-full border border-border bg-surface px-2.5 py-2 text-xs font-mono text-text focus:outline-none"
          />
          <div className="mt-2">
            <button
              type="button"
              onClick={() => importMutation.mutate()}
              className="inline-flex h-7 items-center border border-border bg-bg px-2.5 text-xs text-text hover:bg-surface-hover"
            >
              Import
            </button>
          </div>
        </div>
      ) : null}

      <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
        <div className="shrink-0 grid grid-cols-1 gap-0 md:grid-cols-2">
          <input
            value={draftValue.name || ''}
            onChange={(e) => setDraft((p) => ({ ...(draftValue.id && p.id !== draftValue.id ? draftValue : p), name: e.target.value }))}
            placeholder="Template name"
            className="h-8 border-x-0 border-t-0 border-b border-border bg-bg px-2.5 text-xs text-text focus:outline-none"
          />
          <input
            value={draftValue.subject || ''}
            onChange={(e) => setDraft((p) => ({ ...(draftValue.id && p.id !== draftValue.id ? draftValue : p), subject: e.target.value }))}
            placeholder="Subject"
            className="h-8 border-x-0 border-t-0 border-b border-border bg-bg px-2.5 text-xs text-text focus:outline-none"
          />
          <input
            value={draftValue.preheader || ''}
            onChange={(e) => setDraft((p) => ({ ...(draftValue.id && p.id !== draftValue.id ? draftValue : p), preheader: e.target.value }))}
            placeholder="Preheader"
            className="h-8 border-x-0 border-t-0 border-b border-border bg-bg px-2.5 text-xs text-text focus:outline-none"
          />
          <input
            value={draftValue.from_name || ''}
            onChange={(e) => setDraft((p) => ({ ...(draftValue.id && p.id !== draftValue.id ? draftValue : p), from_name: e.target.value }))}
            placeholder="From name"
            className="h-8 border-x-0 border-t-0 border-b border-border bg-bg px-2.5 text-xs text-text focus:outline-none"
        />
        </div>

        <section className="shrink-0 border-x-0 border-b border-border bg-bg/30">
          <div className="flex flex-wrap gap-1 px-2.5 py-1">
            {TOKENS.map((token) => (
              <button
                key={token}
                type="button"
                onClick={() => handleInsert(` ${token} `)}
                className="inline-flex h-6 items-center border border-border bg-bg px-1.5 text-[10px] text-text hover:bg-surface-hover"
              >
                {token}
              </button>
            ))}
          </div>
        </section>

        <div className="min-h-0 flex-1 overflow-hidden">
          <textarea
            value={draftValue.html_body || ''}
            onChange={(e) => setDraft((p) => ({ ...(draftValue.id && p.id !== draftValue.id ? draftValue : p), html_body: e.target.value }))}
            placeholder="HTML body"
            rows={1}
            className="block h-full min-h-[220px] w-full resize-none overflow-y-auto no-scrollbar border-x-0 border-t-0 border-b border-border bg-bg px-2.5 py-2 text-xs font-mono text-text focus:outline-none"
          />
        </div>

        <div className="shrink-0 grid grid-cols-1 gap-0 md:grid-cols-2">
          <input
            value={sampleContactId}
            onChange={(e) => setSampleContactId(e.target.value)}
            placeholder="Sample contact ID for preview"
            className="h-8 border-x-0 border-t-0 border-b border-border bg-bg px-2.5 text-xs text-text focus:outline-none"
          />
          <select
            value={selectedRevision || ''}
            onChange={(e) => setSelectedRevision(e.target.value ? Number(e.target.value) : null)}
            className="h-8 border-x-0 border-t-0 border-b border-border bg-bg px-2.5 text-xs text-text focus:outline-none"
          >
            <option value="">Revision history</option>
            {revisions.map((rev) => (
              <option key={rev.id} value={rev.revision_number}>
                Revision #{rev.revision_number}
              </option>
            ))}
          </select>
        </div>

        <div className="shrink-0 px-2.5 py-1">
          <button
            type="button"
            onClick={() => revertMutation.mutate()}
            disabled={!selectedRevision || !selectedId}
            className="inline-flex h-7 items-center border border-border bg-bg px-2.5 text-xs text-text hover:bg-surface-hover disabled:opacity-50"
          >
            Revert to revision
          </button>
        </div>

        {errors.length > 0 || warnings.length > 0 ? (
          <div className="shrink-0 border-x-0 border-b border-border bg-bg/50 px-2.5 py-1.5 space-y-2">
            {errors.length > 0 ? (
              <div>
                <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-red-600">Errors</h4>
                <ul className="list-disc pl-5 text-xs text-red-700">
                  {errors.map((item) => (
                    <li key={`e-${item}`}>{item}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {warnings.length > 0 ? (
              <div>
                <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-amber-600">Warnings</h4>
                <ul className="list-disc pl-5 text-xs text-amber-700">
                  {warnings.map((item) => (
                    <li key={`w-${item}`}>{item}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}

        <section className="shrink-0 border-x-0 border-b border-border bg-bg/30">
          <h3 className="border-b border-border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-text-muted">Blocks</h3>
          <div className="space-y-1 px-2.5 py-1">
            {blocks.map((block) => (
              <button
                key={block.id}
                type="button"
                onClick={() => handleInsert(`\n${block.html}\n`)}
                className="w-full border border-border bg-bg px-2 py-1 text-left hover:bg-surface-hover"
              >
                <div className="text-xs font-medium text-text">{block.name}</div>
                <div className="text-[11px] text-text-muted">{block.category || 'General'}</div>
              </button>
            ))}
          </div>
        </section>

        {selectedId ? (
          <button
            type="button"
            onClick={async () => {
              const exported = await emailApi.exportTemplateLibraryItem(selectedId);
              const text = JSON.stringify(exported, null, 2);
              await navigator.clipboard.writeText(text);
              addNotification({ type: 'success', title: 'Template JSON copied' });
            }}
            className="shrink-0 inline-flex h-8 w-full items-center justify-center gap-2 border-x-0 border-t-0 border-b border-border bg-bg px-2.5 text-xs text-text hover:bg-surface-hover"
          >
            <FileText className="h-4 w-4" />
            Copy Export JSON
          </button>
        ) : null}
      </div>
    </div>
  );

  return (
    <WorkspacePageShell
      title="Templates"
      subtitle={listSubtitle}
      hideHeader
      preHeader={
        <EmailTabs
          tabs={emailTabs}
          activeTab="templates"
          onSelectTab={(tabId) => {
            if (tabId === 'campaigns') {
              router.push('/email?view=campaigns');
              return;
            }
            if (tabId === 'templates') {
              router.push('/templates');
              return;
            }
            if (tabId === 'review') {
              router.push('/email?view=review');
              return;
            }
            if (tabId === 'scheduled') {
              router.push('/email?view=scheduled');
              return;
            }
            if (tabId === 'history') {
              router.push('/email?view=history');
            }
          }}
        />
      }
      preHeaderAffectsLayout
      preHeaderClassName="h-14 flex items-end"
      toolbar={
        <div className="flex min-w-0 items-center gap-2">
          <div className="min-w-[220px] flex-1">
            <PageSearchInput value={search} onChange={setSearch} placeholder="Search templates..." />
          </div>
          <div ref={setViewportControlsTarget} className="flex h-8 w-14 shrink-0 items-center justify-center" />
        </div>
      }
    >
      <div className="bg-surface overflow-hidden flex h-full min-h-0">
        <section className="flex min-w-0 min-h-0 flex-1 flex-col">
          <StandardEmailTable
            columns={templateColumns}
            rows={templates}
            rowId={(item) => item.id}
            selectedId={selectedId}
            viewportControlsTarget={viewportControlsTarget}
            renderHeaderActionsMenu={(closeMenu) => (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setShowImport((v) => !v);
                    closeMenu();
                  }}
                  className="block h-8 w-full rounded-none px-2 text-left text-[11px] text-text hover:bg-surface-hover"
                >
                  {showImport ? 'Hide import' : 'Import JSON'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    beginCreate();
                    closeMenu();
                  }}
                  className="block h-8 w-full rounded-none px-2 text-left text-[11px] text-text hover:bg-surface-hover"
                >
                  New template
                </button>
              </>
            )}
            onSelectRow={(item) => selectTemplate(item)}
            getRowAriaLabel={(item) => `Open template ${item.name || item.id}`}
            emptyState={
              <EmptyState
                icon={FileText}
                title="No templates found"
                description="Create a template or adjust your filters."
              />
            }
            isCompact={isPhone}
            storageKey="templates-table"
            renderCompactRow={(item, isSelected) => (
              <div className={`p-3 ${isSelected ? 'bg-accent/10' : ''}`}>
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-text">{item.name || '-'}</div>
                  <div className="mt-1 truncate text-xs text-text-muted">{item.subject || '-'}</div>
                </div>
                <div className="mt-2 flex items-center justify-between gap-2">
                  <span
                    className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium ${
                      item.status === 'active' ? 'bg-emerald-500/15 text-emerald-700' : 'bg-amber-500/15 text-amber-700'
                    }`}
                  >
                    {item.status}
                  </span>
                  <span className="text-[11px] text-text-muted">{formatUpdatedAt(item.updated_at)}</span>
                </div>
              </div>
            )}
            renderRowActionsMenu={(item, closeMenu) => (
              <>
                <button
                  type="button"
                  onClick={() => {
                    selectTemplate(item);
                    closeMenu();
                  }}
                  className="block h-8 w-full rounded-none px-2 text-left text-[11px] text-text hover:bg-surface-hover"
                >
                  Open template
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void handleDuplicateTemplate(item);
                    closeMenu();
                  }}
                  className="block h-8 w-full rounded-none px-2 text-left text-[11px] text-text hover:bg-surface-hover"
                >
                  Duplicate
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void handleCopyTemplateExport(item);
                    closeMenu();
                  }}
                  className="block h-8 w-full rounded-none px-2 text-left text-[11px] text-text hover:bg-surface-hover"
                >
                  Copy export JSON
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void handleArchiveTemplate(item);
                    closeMenu();
                  }}
                  disabled={item.status === 'archived'}
                  className="block h-8 w-full rounded-none px-2 text-left text-[11px] text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                >
                  Archive
                </button>
              </>
            )}
          />
        </section>

        {!isPhone && editorOpen ? <SidePanelContainer>{editorPane}</SidePanelContainer> : null}
      </div>
      {isPhone && editorOpen ? <BottomDrawerContainer onClose={closeEditor}>{editorPane}</BottomDrawerContainer> : null}
    </WorkspacePageShell>
  );
}
