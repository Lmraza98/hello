import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, Copy, FileText, Plus, RefreshCcw, Send, ShieldAlert } from 'lucide-react';
import { emailApi } from '../api/emailApi';
import type { EmailLibraryTemplate, EmailTemplateBlock, EmailTemplateRevision } from '../types/email';
import { PageHeader } from '../components/shared/PageHeader';
import { useNotificationContext } from '../contexts/NotificationContext';
import { useRegisterCapabilities } from '../capabilities/useRegisterCapabilities';
import { getPageCapability } from '../capabilities/catalog';
import { useLocation } from 'react-router-dom';
import { useEffect } from 'react';

const TOKENS = [
  '{{firstName}}',
  '{{lastName}}',
  '{{fullName}}',
  '{{email}}',
  '{{company}}',
  '{{title}}',
  '{{unsubscribeUrl}}',
  '{{viewInBrowserUrl}}',
  '{{trackingPixel}}',
  '{{campaignName}}',
];

type DraftTemplate = Partial<EmailLibraryTemplate>;

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
  useRegisterCapabilities(getPageCapability('templates'));
  const location = useLocation();
  const queryClient = useQueryClient();
  const { addNotification } = useNotificationContext();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'all' | 'active' | 'archived'>('active');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [draft, setDraft] = useState<DraftTemplate>(emptyDraft());
  const [sampleContactId, setSampleContactId] = useState<string>('');
  const [previewHtml, setPreviewHtml] = useState('');
  const [previewText, setPreviewText] = useState('');
  const [warnings, setWarnings] = useState<string[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [testEmail, setTestEmail] = useState('');
  const [showImport, setShowImport] = useState(false);
  const [importJson, setImportJson] = useState('');
  const [selectedRevision, setSelectedRevision] = useState<number | null>(null);

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
    queryFn: () => selectedId ? emailApi.getTemplateRevisions(selectedId) : Promise.resolve([] as EmailTemplateRevision[]),
    enabled: selectedId !== null,
  });

  const templates = templatesQuery.data || [];
  const blocks = blocksQuery.data || [];
  const revisions = revisionsQuery.data || [];

  const refreshAll = () => {
    queryClient.invalidateQueries({ queryKey: ['templates-library'] });
    queryClient.invalidateQueries({ queryKey: ['template-revisions'] });
    queryClient.invalidateQueries({ queryKey: ['template-blocks'] });
  };

  const createMutation = useMutation({
    mutationFn: () => emailApi.createTemplateLibraryItem(draft),
    onSuccess: (created) => {
      addNotification({ type: 'success', title: 'Template created' });
      setSelectedId(created.id);
      setDraft(created);
      refreshAll();
    },
  });

  const saveMutation = useMutation({
    mutationFn: () => {
      if (!selectedId) throw new Error('No template selected');
      return emailApi.updateTemplateLibraryItem(selectedId, draft);
    },
    onSuccess: (saved) => {
      addNotification({ type: 'success', title: 'Template saved' });
      setDraft(saved);
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
      setSelectedId(created.id);
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
      setSelectedId(null);
      setDraft(emptyDraft());
      refreshAll();
    },
  });

  const validateMutation = useMutation({
    mutationFn: () => emailApi.validateTemplateContent({
      subject: draft.subject || '',
      html: draft.html_body || '',
      from_email: draft.from_email || undefined,
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
      setSelectedId(created.id);
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

  const handleSelect = (item: EmailLibraryTemplate) => {
    setSelectedId(item.id);
    setDraft(item);
    setPreviewHtml('');
    setPreviewText('');
    setWarnings([]);
    setErrors([]);
  };

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const q = params.get('q');
    const st = params.get('status');
    const selected = params.get('selectedTemplateId');
    if (q !== null) setSearch(q);
    if (st === 'active' || st === 'archived' || st === 'all') {
      setStatus(st);
    }
    if (selected) {
      const id = Number(selected);
      if (Number.isFinite(id)) setSelectedId(id);
    }
  }, [location.search]);

  useEffect(() => {
    if (!selectedId) return;
    const item = templates.find((t) => t.id === selectedId);
    if (item) {
      setDraft(item);
    }
  }, [selectedId, templates]);

  const handleInsert = (text: string) => {
    setDraft((prev) => ({ ...prev, html_body: `${prev.html_body || ''}${text}` }));
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="pt-5 px-4 md:pt-8 md:px-8 pb-4 md:pb-8">
        <PageHeader
          title="Templates"
          subtitle={`${templates.length} templates`}
          desktopActions={(
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setSelectedId(null);
                  setDraft(emptyDraft());
                }}
                className="inline-flex items-center gap-2 px-3 py-2 bg-accent text-white rounded-lg text-sm font-medium hover:bg-accent-hover transition-colors"
              >
                <Plus className="w-4 h-4" />
                New Template
              </button>
              <button
                type="button"
                onClick={() => setShowImport((v) => !v)}
                className="px-3 py-2 border border-border rounded-lg text-sm text-text-muted hover:bg-surface-hover"
              >
                Import JSON
              </button>
            </div>
          )}
        />

        <div className="grid grid-cols-1 xl:grid-cols-[320px_minmax(0,1fr)] gap-4 h-[calc(100vh-180px)] min-h-[600px]">
          <section className="bg-surface border border-border rounded-lg overflow-hidden flex flex-col">
            <div className="p-3 border-b border-border space-y-2">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search templates"
                className="w-full px-3 py-2 bg-bg border border-border rounded-lg text-sm"
              />
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as 'all' | 'active' | 'archived')}
                className="w-full px-3 py-2 bg-bg border border-border rounded-lg text-sm"
              >
                <option value="active">Active</option>
                <option value="archived">Archived</option>
                <option value="all">All</option>
              </select>
            </div>
            <div className="flex-1 overflow-y-auto">
              {templates.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleSelect(item)}
                  className={`w-full text-left px-3 py-2 border-b border-border-subtle hover:bg-surface-hover ${item.id === selectedId ? 'bg-accent/10' : ''}`}
                >
                  <div className="text-sm font-medium text-text truncate">{item.name}</div>
                  <div className="text-xs text-text-muted truncate">{item.subject}</div>
                </button>
              ))}
            </div>
          </section>

          <section className="bg-surface border border-border rounded-lg overflow-hidden flex flex-col min-h-0">
            <div className="p-3 border-b border-border flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => selectedId ? saveMutation.mutate() : createMutation.mutate()}
                className="px-3 py-2 bg-accent text-white rounded-lg text-sm font-medium"
              >
                {selectedId ? 'Save' : 'Create'}
              </button>
              <button
                type="button"
                onClick={() => duplicateMutation.mutate()}
                disabled={!selectedId}
                className="inline-flex items-center gap-1 px-3 py-2 border border-border rounded-lg text-sm disabled:opacity-50"
              >
                <Copy className="w-3.5 h-3.5" />
                Duplicate
              </button>
              <button
                type="button"
                onClick={() => archiveMutation.mutate()}
                disabled={!selectedId}
                className="inline-flex items-center gap-1 px-3 py-2 border border-border rounded-lg text-sm disabled:opacity-50"
              >
                <Archive className="w-3.5 h-3.5" />
                Archive
              </button>
              <button
                type="button"
                onClick={() => validateMutation.mutate()}
                className="inline-flex items-center gap-1 px-3 py-2 border border-border rounded-lg text-sm"
              >
                <ShieldAlert className="w-3.5 h-3.5" />
                Validate
              </button>
              <button
                type="button"
                onClick={() => previewMutation.mutate()}
                disabled={!selectedId}
                className="inline-flex items-center gap-1 px-3 py-2 border border-border rounded-lg text-sm disabled:opacity-50"
              >
                <RefreshCcw className="w-3.5 h-3.5" />
                Render Preview
              </button>
              <input
                value={testEmail}
                onChange={(e) => setTestEmail(e.target.value)}
                placeholder="test@company.com"
                className="px-3 py-2 bg-bg border border-border rounded-lg text-sm w-52"
              />
              <button
                type="button"
                onClick={() => testSendMutation.mutate()}
                disabled={!selectedId || !testEmail.trim()}
                className="inline-flex items-center gap-1 px-3 py-2 border border-border rounded-lg text-sm disabled:opacity-50"
              >
                <Send className="w-3.5 h-3.5" />
                Test Send
              </button>
            </div>

            {showImport ? (
              <div className="p-3 border-b border-border bg-bg/60">
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

            <div className="flex-1 min-h-0 grid grid-cols-1 2xl:grid-cols-[minmax(0,1fr)_320px]">
              <div className="overflow-y-auto p-3 space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <input value={draft.name || ''} onChange={(e) => setDraft((p) => ({ ...p, name: e.target.value }))} placeholder="Template name" className="px-3 py-2 bg-bg border border-border rounded-lg text-sm" />
                  <input value={draft.subject || ''} onChange={(e) => setDraft((p) => ({ ...p, subject: e.target.value }))} placeholder="Subject" className="px-3 py-2 bg-bg border border-border rounded-lg text-sm" />
                  <input value={draft.preheader || ''} onChange={(e) => setDraft((p) => ({ ...p, preheader: e.target.value }))} placeholder="Preheader" className="px-3 py-2 bg-bg border border-border rounded-lg text-sm" />
                  <input value={draft.from_name || ''} onChange={(e) => setDraft((p) => ({ ...p, from_name: e.target.value }))} placeholder="From name" className="px-3 py-2 bg-bg border border-border rounded-lg text-sm" />
                  <input value={draft.from_email || ''} onChange={(e) => setDraft((p) => ({ ...p, from_email: e.target.value }))} placeholder="From email" className="px-3 py-2 bg-bg border border-border rounded-lg text-sm" />
                  <input value={draft.reply_to || ''} onChange={(e) => setDraft((p) => ({ ...p, reply_to: e.target.value }))} placeholder="Reply-to" className="px-3 py-2 bg-bg border border-border rounded-lg text-sm" />
                </div>
                <textarea
                  value={draft.html_body || ''}
                  onChange={(e) => setDraft((p) => ({ ...p, html_body: e.target.value }))}
                  placeholder="HTML body"
                  rows={16}
                  className="w-full px-3 py-2 bg-bg border border-border rounded-lg text-sm font-mono"
                />
                <textarea
                  value={draft.text_body || ''}
                  onChange={(e) => setDraft((p) => ({ ...p, text_body: e.target.value }))}
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

                {(errors.length > 0 || warnings.length > 0) ? (
                  <div className="border border-border rounded-lg p-3 bg-bg/50 space-y-2">
                    {errors.length > 0 ? (
                      <div>
                        <h4 className="text-sm font-semibold text-red-600 mb-1">Errors</h4>
                        <ul className="list-disc pl-5 text-sm text-red-700">
                          {errors.map((item) => <li key={`e-${item}`}>{item}</li>)}
                        </ul>
                      </div>
                    ) : null}
                    {warnings.length > 0 ? (
                      <div>
                        <h4 className="text-sm font-semibold text-amber-600 mb-1">Warnings</h4>
                        <ul className="list-disc pl-5 text-sm text-amber-700">
                          {warnings.map((item) => <li key={`w-${item}`}>{item}</li>)}
                        </ul>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>

              <aside className="border-t 2xl:border-t-0 2xl:border-l border-border p-3 overflow-y-auto space-y-3 bg-bg/30">
                <div>
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
                </div>
                <div>
                  <h3 className="text-xs uppercase tracking-wide font-semibold text-text-muted mb-2">Blocks</h3>
                  <div className="space-y-2">
                    {(blocks as EmailTemplateBlock[]).map((block) => (
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
                </div>
                <div>
                  <h3 className="text-xs uppercase tracking-wide font-semibold text-text-muted mb-2">Live Preview</h3>
                  <div className="border border-border rounded-lg bg-white min-h-28 p-2">
                    {previewHtml ? (
                      <iframe
                        title="template-preview"
                        className="w-full h-64 border-0"
                        srcDoc={previewHtml}
                      />
                    ) : (
                      <p className="text-sm text-text-muted p-2">Run Render Preview to view output.</p>
                    )}
                  </div>
                  {previewText ? (
                    <pre className="mt-2 p-2 border border-border rounded-lg bg-bg text-xs whitespace-pre-wrap">{previewText}</pre>
                  ) : null}
                </div>
                {selectedId ? (
                  <div>
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
                  </div>
                ) : null}
              </aside>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
