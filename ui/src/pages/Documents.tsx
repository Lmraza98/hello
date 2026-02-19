import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileText, Link2, RefreshCw, Search, Upload } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { api, type DocumentAnswerResponse, type DocumentRecord } from '../api';
import { PageHeader } from '../components/shared/PageHeader';
import { LoadingSpinner } from '../components/shared/LoadingSpinner';
import { EmptyState } from '../components/shared/EmptyState';
import { usePageContext } from '../contexts/PageContextProvider';
import { useRegisterCapabilities } from '../capabilities/useRegisterCapabilities';
import { getPageCapability } from '../capabilities/catalog';

type CollectionKey =
  | 'all'
  | 'recent'
  | 'unlinked'
  | 'needs_review'
  | 'ready'
  | 'processing'
  | 'failed';

const COLLECTIONS: Array<{ key: CollectionKey; label: string }> = [
  { key: 'all', label: 'All Documents' },
  { key: 'recent', label: 'Recent' },
  { key: 'unlinked', label: 'Unlinked' },
  { key: 'needs_review', label: 'Needs Review' },
  { key: 'ready', label: 'Ready' },
  { key: 'processing', label: 'Processing' },
  { key: 'failed', label: 'Failed' },
];

function formatBytes(bytes?: number | null): string {
  const value = Number(bytes || 0);
  if (!value) return '-';
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function prettyDate(iso?: string | null): string {
  if (!iso) return '-';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString();
}

function statusBadge(status: string): string {
  const s = String(status || '').toLowerCase();
  if (s === 'ready') return 'bg-green-100 text-green-700';
  if (s === 'failed') return 'bg-red-100 text-red-700';
  if (s === 'pending' || s === 'extracting' || s === 'chunking' || s === 'embedding' || s === 'analyzing') {
    return 'bg-blue-100 text-blue-700';
  }
  return 'bg-accent/10 text-accent';
}

export default function DocumentsPage() {
  const location = useLocation();
  useRegisterCapabilities(getPageCapability('documents'));
  const { setPageContext } = usePageContext();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [collection, setCollection] = useState<CollectionKey>('all');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<DocumentAnswerResponse | null>(null);
  const [askLoading, setAskLoading] = useState(false);
  const [selectedContactIds, setSelectedContactIds] = useState<number[]>([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState<number | ''>('');
  const [uploadError, setUploadError] = useState<string | null>(null);

  const listParams = useMemo(() => {
    const params: {
      q?: string;
      collection?: string;
      status?: string;
    } = {};
    if (query.trim()) params.q = query.trim();
    if (collection === 'unlinked' || collection === 'needs_review') params.collection = collection;
    if (collection === 'ready') params.status = 'ready';
    if (collection === 'failed') params.status = 'failed';
    if (collection === 'processing') params.status = 'extracting';
    return params;
  }, [collection, query]);

  const docsQ = useQuery({
    queryKey: ['documents', listParams],
    queryFn: () => api.listDocuments(listParams),
    refetchInterval: 2500,
  });

  const selectedDocument = useMemo<DocumentRecord | null>(() => {
    if (!selectedId) return null;
    return (docsQ.data?.documents || []).find((doc) => doc.id === selectedId) || null;
  }, [docsQ.data?.documents, selectedId]);

  const detailsQ = useQuery({
    queryKey: ['documents', 'detail', selectedId],
    queryFn: () => api.getDocument(String(selectedId)),
    enabled: Boolean(selectedId),
    refetchInterval: selectedDocument?.status === 'ready' || selectedDocument?.status === 'failed' ? false : 2500,
  });

  useEffect(() => {
    const detail = detailsQ.data?.document;
    if (!detail) return;
    setSelectedCompanyId(typeof detail.linked_company_id === 'number' ? detail.linked_company_id : '');
    setSelectedContactIds(
      (detailsQ.data?.contacts || [])
        .filter((contact) => Boolean(contact.confirmed))
        .map((contact) => contact.contact_id)
    );
  }, [detailsQ.data]);

  const companiesQ = useQuery({
    queryKey: ['companies', 'for-doc-linking'],
    queryFn: () => api.getCompanies(),
  });

  useEffect(() => {
    const first = docsQ.data?.documents?.[0];
    if (!selectedId && first) setSelectedId(first.id);
  }, [docsQ.data?.documents, selectedId]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const selectedFromQuery = params.get('selectedDocumentId');
    if (selectedFromQuery) {
      setSelectedId(selectedFromQuery);
    }
    const q = params.get('q');
    if (q !== null) {
      setQuery(q);
    }
  }, [location.search]);

  useEffect(() => {
    setPageContext({
      listContext: 'documents',
      selected: selectedId ? { documentId: selectedId } : {},
      loadedIds: { documentIds: (docsQ.data?.documents || []).slice(0, 200).map((d) => d.id) },
    });
  }, [docsQ.data?.documents, selectedId, setPageContext]);

  const onUploadClick = () => fileInputRef.current?.click();

  const onUploadChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploadError(null);
    try {
      await api.uploadDocument(file);
      await docsQ.refetch();
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : 'Upload failed');
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const onRetry = async () => {
    if (!selectedId) return;
    await api.retryDocumentProcessing(selectedId);
    await docsQ.refetch();
    await detailsQ.refetch();
  };

  const onLink = async () => {
    if (!selectedId) return;
    await api.linkDocumentToEntities({
      document_id: selectedId,
      company_id: selectedCompanyId === '' ? undefined : Number(selectedCompanyId),
      contact_ids: selectedContactIds,
    });
    await docsQ.refetch();
    await detailsQ.refetch();
  };

  const onAsk = async () => {
    const trimmed = question.trim();
    if (!trimmed) return;
    setAskLoading(true);
    try {
      const response = await api.askDocuments({
        question: trimmed,
        document_ids: selectedId ? [selectedId] : undefined,
      });
      setAnswer(response);
    } finally {
      setAskLoading(false);
    }
  };

  const docs = docsQ.data?.documents || [];

  return (
    <div className="h-full overflow-hidden">
      <div className="pt-5 px-4 md:pt-8 md:px-8 pb-4 md:pb-8 h-full flex flex-col">
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          onChange={onUploadChange}
          accept=".pdf,.docx,.csv,.txt,.png,.jpg,.jpeg,.webp"
        />
        <PageHeader
          title="Documents"
          subtitle={`${docsQ.data?.count || 0} documents indexed`}
          desktopActions={(
            <>
              <button
                type="button"
                onClick={() => docsQ.refetch()}
                className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium text-text-muted hover:bg-surface-hover"
              >
                <RefreshCw className="h-4 w-4" /> Refresh
              </button>
              <button
                type="button"
                onClick={onUploadClick}
                className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover"
              >
                <Upload className="h-4 w-4" /> Upload
              </button>
            </>
          )}
          mobileActions={(
            <>
              <button
                type="button"
                onClick={onUploadClick}
                className="inline-flex items-center rounded-md bg-accent p-2 text-white"
              >
                <Upload className="h-4 w-4" />
              </button>
            </>
          )}
        />
        {uploadError ? <div className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{uploadError}</div> : null}
        <div className="mb-3 rounded-lg border border-border bg-surface px-3 py-2 flex items-center gap-2">
          <Search className="h-4 w-4 text-text-dim" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search filename, summary, or content"
            className="w-full bg-transparent text-sm text-text outline-none placeholder:text-text-dim"
          />
        </div>

        <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-border bg-surface grid grid-cols-1 lg:grid-cols-[220px_minmax(0,1fr)_340px]">
          <aside className="border-r border-border p-2 overflow-y-auto">
            {COLLECTIONS.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => setCollection(item.key)}
                className={`w-full rounded-md px-3 py-2 text-left text-sm ${
                  collection === item.key ? 'bg-accent/10 text-accent' : 'text-text-muted hover:bg-surface-hover'
                }`}
              >
                {item.label}
              </button>
            ))}
          </aside>

          <section className="min-h-0 overflow-y-auto border-r border-border">
            {docsQ.isLoading ? (
              <LoadingSpinner />
            ) : docs.length === 0 ? (
              <EmptyState
                icon={FileText}
                title="No documents yet"
                description="Upload your first file to start indexing and Q&A."
                action={{ label: 'Upload Document', icon: Upload, onClick: onUploadClick }}
              />
            ) : (
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10 bg-surface-hover/70">
                  <tr className="border-b border-border text-xs uppercase tracking-wide text-text-dim">
                    <th className="px-3 py-2 text-left">Name</th>
                    <th className="px-3 py-2 text-left">Type</th>
                    <th className="px-3 py-2 text-left">Company</th>
                    <th className="px-3 py-2 text-left">Status</th>
                    <th className="px-3 py-2 text-left">Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {docs.map((doc) => (
                    <tr
                      key={doc.id}
                      onClick={() => setSelectedId(doc.id)}
                      className={`cursor-pointer border-b border-border-subtle hover:bg-surface-hover/60 ${
                        selectedId === doc.id ? 'bg-accent/10' : ''
                      }`}
                    >
                      <td className="px-3 py-2">
                        <div className="font-medium text-text">{doc.filename}</div>
                        <div className="text-xs text-text-dim">{formatBytes(doc.file_size_bytes)}</div>
                      </td>
                      <td className="px-3 py-2 text-text-dim">{doc.document_type || '-'}</td>
                      <td className="px-3 py-2 text-text-dim">{doc.linked_company_name || '-'}</td>
                      <td className="px-3 py-2">
                        <span className={`rounded px-2 py-0.5 text-[11px] ${statusBadge(doc.status)}`}>{doc.status}</span>
                      </td>
                      <td className="px-3 py-2 text-text-dim">{prettyDate(doc.uploaded_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <aside className="min-h-0 overflow-y-auto p-3">
            {!selectedId ? (
              <div className="text-sm text-text-dim">Select a document to inspect details.</div>
            ) : detailsQ.isLoading ? (
              <LoadingSpinner />
            ) : detailsQ.data ? (
              <div className="space-y-3">
                <div>
                  <div className="text-base font-semibold text-text">{detailsQ.data.document.filename}</div>
                  <div className="text-xs text-text-dim">{detailsQ.data.document.mime_type}</div>
                </div>
                <div className="rounded border border-border p-2 text-xs">
                  <div className="mb-1 text-text-muted">Summary</div>
                  <div className="text-text">{detailsQ.data.document.summary || 'No summary yet.'}</div>
                </div>
                <div className="rounded border border-border p-2 text-xs">
                  <div className="mb-1 text-text-muted">Quick Facts</div>
                  <div className="text-text">Pages: {detailsQ.data.document.page_count ?? '-'}</div>
                  <div className="text-text">Chunks: {detailsQ.data.chunk_count}</div>
                  <div className="text-text">Company: {detailsQ.data.document.linked_company_name || '-'}</div>
                </div>

                <div className="rounded border border-border p-2">
                  <div className="mb-2 text-xs font-medium text-text">Linking</div>
                  <select
                    value={selectedCompanyId}
                    onChange={(event) => {
                      const next = event.target.value;
                      setSelectedCompanyId(next ? Number(next) : '');
                    }}
                    className="mb-2 w-full rounded border border-border px-2 py-1 text-sm bg-surface"
                  >
                    <option value="">No linked company</option>
                    {(companiesQ.data || []).map((company) => (
                      <option key={company.id} value={company.id}>
                        {company.company_name}
                      </option>
                    ))}
                  </select>
                  <div className="mb-2 max-h-28 overflow-y-auto rounded border border-border p-2 text-xs">
                    {(detailsQ.data.contacts || []).length === 0 ? (
                      <div className="text-text-dim">No extracted contacts.</div>
                    ) : (
                      detailsQ.data.contacts.map((contact) => {
                        const checked = selectedContactIds.includes(contact.contact_id);
                        return (
                          <label key={contact.contact_id} className="flex items-center gap-2 py-0.5 text-text">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(event) => {
                                setSelectedContactIds((prev) => {
                                  if (event.target.checked) return Array.from(new Set([...prev, contact.contact_id]));
                                  return prev.filter((id) => id !== contact.contact_id);
                                });
                              }}
                            />
                            <span>{contact.name}</span>
                          </label>
                        );
                      })
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => void onLink()}
                    className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-xs text-text hover:bg-surface-hover"
                  >
                    <Link2 className="h-3.5 w-3.5" /> Confirm Links
                  </button>
                </div>

                <div className="rounded border border-border p-2">
                  <div className="mb-2 text-xs font-medium text-text">Ask This Document</div>
                  <textarea
                    value={question}
                    onChange={(event) => setQuestion(event.target.value)}
                    rows={3}
                    placeholder="Ask a question about this document"
                    className="w-full resize-y rounded border border-border bg-surface px-2 py-1 text-sm outline-none"
                  />
                  <div className="mt-2 flex items-center gap-2">
                    <button
                      type="button"
                      disabled={askLoading}
                      onClick={() => void onAsk()}
                      className="rounded bg-accent px-2.5 py-1.5 text-xs font-medium text-white disabled:opacity-60"
                    >
                      {askLoading ? 'Asking...' : 'Ask'}
                    </button>
                    <button
                      type="button"
                      onClick={() => void onRetry()}
                      className="rounded border border-border px-2.5 py-1.5 text-xs font-medium text-text hover:bg-surface-hover"
                    >
                      Reprocess
                    </button>
                  </div>
                  {answer ? (
                    <div className="mt-3 space-y-2 rounded border border-border-subtle bg-bg p-2 text-xs">
                      <div className="text-text whitespace-pre-wrap">{answer.answer}</div>
                      {(answer.sources || []).length > 0 ? (
                        <div className="space-y-1">
                          {(answer.sources || []).map((source, idx) => (
                            <div key={`${source.document_id}-${idx}`} className="text-text-dim">
                              {source.filename} {source.page ? `(page ${source.page})` : ''} {typeof source.similarity === 'number' ? `- ${source.similarity.toFixed(2)}` : ''}
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </div>
            ) : (
              <div className="text-sm text-red-600">Could not load document details.</div>
            )}
          </aside>
        </div>
      </div>
    </div>
  );
}
