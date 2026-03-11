import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { flexRender, getCoreRowModel, type ColumnDef, type RowSelectionState, useReactTable } from '@tanstack/react-table';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, Copy, FileText, Plus, RefreshCcw, Send, ShieldAlert, X } from 'lucide-react';
import { emailApi } from '../api/emailApi';
import type { EmailLibraryTemplate, EmailTemplateBlock, EmailTemplateRevision } from '../types/email';
import { HeaderActionButton } from '../components/shared/HeaderActionButton';
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
import {
  SHARED_SELECTION_COLUMN_WIDTH,
  SHARED_TABLE_ROW_HEIGHT_CLASS,
  SharedViewportControlsOverlay,
  SharedTableColGroupWithWidths,
  SharedTableHeader,
  filterCellsByIds,
  sharedCellClassName,
  useFittedTableLayout,
  usePersistentColumnSizing,
} from '../components/shared/resizableDataTable';

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
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
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
  const templateColumns = useMemo<ColumnDef<EmailLibraryTemplate>[]>(
    () => [
      {
        id: 'select',
        header: ({ table }) => (
          <button
            type="button"
            aria-label="Select all visible templates"
            aria-pressed={table.getIsAllRowsSelected()}
            onClick={() => table.toggleAllRowsSelected(!table.getIsAllRowsSelected())}
            className="block h-full w-full"
            data-row-control
          />
        ),
        cell: ({ row }) => (
          <button
            type="button"
            aria-label={`Select template ${row.original.name || row.original.id}`}
            aria-pressed={row.getIsSelected()}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              row.toggleSelected();
            }}
            className="block h-full w-full"
            data-row-control
          />
        ),
        size: SHARED_SELECTION_COLUMN_WIDTH,
        minSize: SHARED_SELECTION_COLUMN_WIDTH,
        maxSize: SHARED_SELECTION_COLUMN_WIDTH,
        enableResizing: false,
        meta: {
          label: 'Select',
          minWidth: SHARED_SELECTION_COLUMN_WIDTH,
          defaultWidth: SHARED_SELECTION_COLUMN_WIDTH,
          maxWidth: SHARED_SELECTION_COLUMN_WIDTH,
          resizable: false,
          align: 'center',
        },
      },
      {
        id: 'name',
        header: 'Name',
        accessorFn: (row) => row.name || '-',
        cell: ({ row }) => <span className="block truncate text-sm text-text">{row.original.name || '-'}</span>,
        size: 260,
        minSize: 220,
        maxSize: Number.MAX_SAFE_INTEGER,
        meta: {
          label: 'Name',
          minWidth: 220,
          defaultWidth: 260,
          maxWidth: 420,
          resizable: true,
          align: 'left',
          measureValue: (row: EmailLibraryTemplate) => row.name || '-',
        },
      },
      {
        id: 'subject',
        header: 'Subject',
        accessorFn: (row) => row.subject || '-',
        cell: ({ row }) => <span className="block truncate text-xs text-text-muted">{row.original.subject || '-'}</span>,
        size: 340,
        minSize: 240,
        maxSize: Number.MAX_SAFE_INTEGER,
        meta: {
          label: 'Subject',
          minWidth: 240,
          defaultWidth: 340,
          maxWidth: 520,
          resizable: true,
          align: 'left',
          measureValue: (row: EmailLibraryTemplate) => row.subject || '-',
        },
      },
      {
        id: 'status',
        header: () => (
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
        accessorFn: (row) => row.status,
        cell: ({ row }) => (
          <span
            className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium ${
              row.original.status === 'active'
                ? 'bg-emerald-500/15 text-emerald-700'
                : 'bg-amber-500/15 text-amber-700'
            }`}
          >
            {row.original.status}
          </span>
        ),
        size: 108,
        minSize: 96,
        maxSize: Number.MAX_SAFE_INTEGER,
        meta: {
          label: 'Status',
          minWidth: 96,
          defaultWidth: 108,
          maxWidth: 150,
          resizable: true,
          align: 'left',
          measureValue: (row: EmailLibraryTemplate) => row.status,
        },
      },
      {
        id: 'updated_at',
        header: 'Updated',
        accessorFn: (row) => row.updated_at,
        cell: ({ row }) => <span className="block truncate text-xs text-text-muted">{formatUpdatedAt(row.original.updated_at)}</span>,
        size: 132,
        minSize: 120,
        maxSize: Number.MAX_SAFE_INTEGER,
        meta: {
          label: 'Updated',
          minWidth: 120,
          defaultWidth: 132,
          maxWidth: 180,
          resizable: true,
          align: 'right',
          measureValue: (row: EmailLibraryTemplate) => formatUpdatedAt(row.updated_at),
        },
      },
    ],
    [openHeaderFilterId, status]
  );
  const { columnSizing, setColumnSizing, autoFitColumn } = usePersistentColumnSizing({
    columns: templateColumns,
    rows: templates,
    storageKey: 'templates-table',
  });
  const templatesTable = useReactTable({
    data: templates,
    columns: templateColumns,
    state: { columnSizing, rowSelection },
    onRowSelectionChange: setRowSelection,
    onColumnSizingChange: setColumnSizing,
    getRowId: (row) => String(row.id),
    getCoreRowModel: getCoreRowModel(),
    columnResizeMode: 'onChange',
  });
  const {
    containerRef: templatesTableRef,
    columnWidths: templatesColumnWidths,
    visibleColumnIds: templatesVisibleColumnIds,
    tableStyle: templatesTableStyle,
    fillWidth: templatesFillWidth,
    canShiftLeft: canShiftTemplatesLeft,
    canShiftRight: canShiftTemplatesRight,
    shiftLeft: shiftTemplatesLeft,
    shiftRight: shiftTemplatesRight,
  } = useFittedTableLayout(templatesTable);
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
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b border-border px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold text-text">{selectedId ? draftValue.name || 'Template' : 'New Template'}</h3>
            <p className="truncate text-xs text-text-muted">
              {selectedId ? `Template #${selectedId}` : 'Create a reusable template'}
            </p>
          </div>
          <button
            type="button"
            onClick={closeEditor}
            aria-label="Close template editor"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border text-text-muted hover:bg-surface-hover"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="shrink-0 border-b border-border p-3 flex items-center gap-2 overflow-x-auto no-scrollbar whitespace-nowrap">
        <button
          type="button"
          onClick={() => (selectedId ? saveMutation.mutate() : createMutation.mutate())}
          className="shrink-0 px-3 py-2 bg-accent text-white rounded-lg text-sm font-medium"
        >
          {selectedId ? 'Save' : 'Create'}
        </button>
        <button
          type="button"
          onClick={() => duplicateMutation.mutate()}
          disabled={!selectedId}
          className="inline-flex shrink-0 items-center gap-1 px-3 py-2 border border-border rounded-lg text-sm disabled:opacity-50"
        >
          <Copy className="w-3.5 h-3.5" />
          Duplicate
        </button>
        <button
          type="button"
          onClick={() => archiveMutation.mutate()}
          disabled={!selectedId}
          className="inline-flex shrink-0 items-center gap-1 px-3 py-2 border border-border rounded-lg text-sm disabled:opacity-50"
        >
          <Archive className="w-3.5 h-3.5" />
          Archive
        </button>
        <button
          type="button"
          onClick={() => validateMutation.mutate()}
          className="inline-flex shrink-0 items-center gap-1 px-3 py-2 border border-border rounded-lg text-sm"
        >
          <ShieldAlert className="w-3.5 h-3.5" />
          Validate
        </button>
        <button
          type="button"
          onClick={() => previewMutation.mutate()}
          disabled={!selectedId}
          className="inline-flex shrink-0 items-center gap-1 px-3 py-2 border border-border rounded-lg text-sm disabled:opacity-50"
        >
          <RefreshCcw className="w-3.5 h-3.5" />
          Render Preview
        </button>
        <input
          value={testEmail}
          onChange={(e) => setTestEmail(e.target.value)}
          placeholder="test@company.com"
          className="shrink-0 px-3 py-2 bg-bg border border-border rounded-lg text-sm w-52"
        />
        <button
          type="button"
          onClick={() => testSendMutation.mutate()}
          disabled={!selectedId || !testEmail.trim()}
          className="inline-flex shrink-0 items-center gap-1 px-3 py-2 border border-border rounded-lg text-sm disabled:opacity-50"
        >
          <Send className="w-3.5 h-3.5" />
          Test Send
        </button>
      </div>

      {showImport ? (
        <div className="shrink-0 p-3 border-b border-border bg-bg/60">
          <textarea
            value={importJson}
            onChange={(e) => setImportJson(e.target.value)}
            rows={5}
            placeholder="Paste template export JSON"
            className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-sm font-mono"
          />
          <div className="mt-2">
            <button
              type="button"
              onClick={() => importMutation.mutate()}
              className="px-3 py-2 bg-accent text-white rounded-lg text-sm"
            >
              Import
            </button>
          </div>
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto p-3 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <input
            value={draftValue.name || ''}
            onChange={(e) => setDraft((p) => ({ ...(draftValue.id && p.id !== draftValue.id ? draftValue : p), name: e.target.value }))}
            placeholder="Template name"
            className="px-3 py-2 bg-bg border border-border rounded-lg text-sm"
          />
          <input
            value={draftValue.subject || ''}
            onChange={(e) => setDraft((p) => ({ ...(draftValue.id && p.id !== draftValue.id ? draftValue : p), subject: e.target.value }))}
            placeholder="Subject"
            className="px-3 py-2 bg-bg border border-border rounded-lg text-sm"
          />
          <input
            value={draftValue.preheader || ''}
            onChange={(e) => setDraft((p) => ({ ...(draftValue.id && p.id !== draftValue.id ? draftValue : p), preheader: e.target.value }))}
            placeholder="Preheader"
            className="px-3 py-2 bg-bg border border-border rounded-lg text-sm"
          />
          <input
            value={draftValue.from_name || ''}
            onChange={(e) => setDraft((p) => ({ ...(draftValue.id && p.id !== draftValue.id ? draftValue : p), from_name: e.target.value }))}
            placeholder="From name"
            className="px-3 py-2 bg-bg border border-border rounded-lg text-sm"
          />
          <input
            value={draftValue.from_email || ''}
            onChange={(e) => setDraft((p) => ({ ...(draftValue.id && p.id !== draftValue.id ? draftValue : p), from_email: e.target.value }))}
            placeholder="From email"
            className="px-3 py-2 bg-bg border border-border rounded-lg text-sm"
          />
          <input
            value={draftValue.reply_to || ''}
            onChange={(e) => setDraft((p) => ({ ...(draftValue.id && p.id !== draftValue.id ? draftValue : p), reply_to: e.target.value }))}
            placeholder="Reply-to"
            className="px-3 py-2 bg-bg border border-border rounded-lg text-sm"
          />
        </div>

        <textarea
          value={draftValue.html_body || ''}
          onChange={(e) => setDraft((p) => ({ ...(draftValue.id && p.id !== draftValue.id ? draftValue : p), html_body: e.target.value }))}
          placeholder="HTML body"
          rows={16}
          className="w-full px-3 py-2 bg-bg border border-border rounded-lg text-sm font-mono"
        />
        <textarea
          value={draftValue.text_body || ''}
          onChange={(e) => setDraft((p) => ({ ...(draftValue.id && p.id !== draftValue.id ? draftValue : p), text_body: e.target.value }))}
          placeholder="Optional plain text body"
          rows={7}
          className="w-full px-3 py-2 bg-bg border border-border rounded-lg text-sm font-mono"
        />

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <input
            value={sampleContactId}
            onChange={(e) => setSampleContactId(e.target.value)}
            placeholder="Sample contact ID for preview"
            className="px-3 py-2 bg-bg border border-border rounded-lg text-sm"
          />
          <select
            value={selectedRevision || ''}
            onChange={(e) => setSelectedRevision(e.target.value ? Number(e.target.value) : null)}
            className="px-3 py-2 bg-bg border border-border rounded-lg text-sm"
          >
            <option value="">Revision history</option>
            {revisions.map((rev) => (
              <option key={rev.id} value={rev.revision_number}>
                Revision #{rev.revision_number}
              </option>
            ))}
          </select>
        </div>

        <div>
          <button
            type="button"
            onClick={() => revertMutation.mutate()}
            disabled={!selectedRevision || !selectedId}
            className="px-3 py-2 border border-border rounded-lg text-sm disabled:opacity-50"
          >
            Revert to revision
          </button>
        </div>

        {errors.length > 0 || warnings.length > 0 ? (
          <div className="border border-border rounded-lg p-3 bg-bg/50 space-y-2">
            {errors.length > 0 ? (
              <div>
                <h4 className="text-sm font-semibold text-red-600 mb-1">Errors</h4>
                <ul className="list-disc pl-5 text-sm text-red-700">
                  {errors.map((item) => (
                    <li key={`e-${item}`}>{item}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {warnings.length > 0 ? (
              <div>
                <h4 className="text-sm font-semibold text-amber-600 mb-1">Warnings</h4>
                <ul className="list-disc pl-5 text-sm text-amber-700">
                  {warnings.map((item) => (
                    <li key={`w-${item}`}>{item}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}

        <section className="border border-border rounded-lg p-3 bg-bg/30">
          <h3 className="text-xs uppercase tracking-wide font-semibold text-text-muted mb-2">Variables</h3>
          <div className="flex flex-wrap gap-1.5">
            {TOKENS.map((token) => (
              <button
                key={token}
                type="button"
                onClick={() => handleInsert(` ${token} `)}
                className="px-2 py-1 text-xs border border-border rounded-md hover:bg-surface-hover"
              >
                {token}
              </button>
            ))}
          </div>
        </section>

        <section className="border border-border rounded-lg p-3 bg-bg/30">
          <h3 className="text-xs uppercase tracking-wide font-semibold text-text-muted mb-2">Blocks</h3>
          <div className="space-y-2">
            {blocks.map((block) => (
              <button
                key={block.id}
                type="button"
                onClick={() => handleInsert(`\n${block.html}\n`)}
                className="w-full text-left p-2 border border-border rounded-lg hover:bg-surface-hover"
              >
                <div className="text-sm font-medium text-text">{block.name}</div>
                <div className="text-xs text-text-muted">{block.category || 'General'}</div>
              </button>
            ))}
          </div>
        </section>

        <section className="border border-border rounded-lg p-3 bg-bg/30">
          <h3 className="text-xs uppercase tracking-wide font-semibold text-text-muted mb-2">Live Preview</h3>
          <div className="border border-border rounded-lg bg-white min-h-28 p-2">
            {previewHtml ? (
              <iframe title="template-preview" className="w-full h-64 border-0" srcDoc={previewHtml} />
            ) : (
              <p className="text-sm text-text-muted p-2">Run Render Preview to view output.</p>
            )}
          </div>
          {previewText ? (
            <pre className="mt-2 p-2 border border-border rounded-lg bg-bg text-xs whitespace-pre-wrap">{previewText}</pre>
          ) : null}
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
            className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 border border-border rounded-lg text-sm"
          >
            <FileText className="w-4 h-4" />
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
      preHeaderClassName="-mt-3 md:-mt-4 h-14 flex items-end"
      toolbar={
        <div className="flex min-w-0 flex-wrap items-center">
          <div className="min-w-[220px] flex-1">
            <PageSearchInput value={search} onChange={setSearch} placeholder="Search templates..." />
          </div>
          <HeaderActionButton onClick={() => setShowImport((v) => !v)} variant="secondary">
            Import JSON
          </HeaderActionButton>
          <HeaderActionButton onClick={beginCreate} variant="primary" icon={<Plus className="w-4 h-4" />}>
            New Template
          </HeaderActionButton>
        </div>
      }
    >
      <div className="bg-surface overflow-hidden flex h-full min-h-0">
        <section ref={templatesTableRef} className="flex min-w-0 min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
            <div className="sticky top-0 z-[1] relative">
              <SharedViewportControlsOverlay
                canShiftLeft={canShiftTemplatesLeft}
                canShiftRight={canShiftTemplatesRight}
                onShiftLeft={shiftTemplatesLeft}
                onShiftRight={shiftTemplatesRight}
              />
              <table className="w-full border-collapse" style={templatesTableStyle}>
                <SharedTableColGroupWithWidths table={templatesTable} columnWidths={templatesColumnWidths} visibleColumnIds={templatesVisibleColumnIds} fillerWidth={templatesFillWidth} />
                <SharedTableHeader
                  table={templatesTable}
                  onAutoFitColumn={autoFitColumn}
                  visibleColumnIds={templatesVisibleColumnIds}
                  columnWidths={templatesColumnWidths}
                  fillerWidth={templatesFillWidth}
                />
              </table>
            </div>
            <table className="w-full border-collapse" style={templatesTableStyle}>
              <SharedTableColGroupWithWidths table={templatesTable} columnWidths={templatesColumnWidths} visibleColumnIds={templatesVisibleColumnIds} fillerWidth={templatesFillWidth} />
              <tbody>
                {templatesTable.getRowModel().rows.map((row) => (
                  <tr
                    key={row.id}
                    className={`group ${SHARED_TABLE_ROW_HEIGHT_CLASS} cursor-pointer border-b border-border-subtle transition-colors ${
                      row.original.id === selectedId ? 'bg-accent/10' : row.getIsSelected() ? 'bg-accent/8' : 'hover:bg-surface-hover/60'
                    }`}
                    onClick={() => selectTemplate(row.original)}
                  >
                    {filterCellsByIds(row.getVisibleCells(), templatesVisibleColumnIds).map((cell, index, cells) => (
                      <td key={cell.id} className={sharedCellClassName(cell, `${SHARED_TABLE_ROW_HEIGHT_CLASS} px-3 py-0 ${index === cells.length - 1 ? '__shared-last__' : ''}`)}>
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                    {templatesFillWidth > 0 ? <td aria-hidden="true" className={`${SHARED_TABLE_ROW_HEIGHT_CLASS} px-0 py-0`} /> : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {!isPhone && editorOpen ? <SidePanelContainer>{editorPane}</SidePanelContainer> : null}
      </div>
      {isPhone && editorOpen ? <BottomDrawerContainer onClose={closeEditor}>{editorPane}</BottomDrawerContainer> : null}
    </WorkspacePageShell>
  );
}
