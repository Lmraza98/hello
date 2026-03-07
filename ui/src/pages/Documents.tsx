import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type CSSProperties, type MouseEvent, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ChevronRight,
  FileText,
  Folder,
  FolderOpen,
  Link2,
  MoreHorizontal,
  MoveRight,
  RotateCcw,
  Plus,
  RefreshCw,
  SlidersHorizontal,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api, type DocumentAnswerResponse, type DocumentFolderRecord, type DocumentRecord } from '../api';
import { useIsMobile } from '../hooks/useIsMobile';
import { HeaderActionButton } from '../components/shared/HeaderActionButton';
import { PageSearchInput } from '../components/shared/PageSearchInput';
import { LoadingSpinner } from '../components/shared/LoadingSpinner';
import { EmptyState } from '../components/shared/EmptyState';
import { SidePanelContainer } from '../components/contacts/SidePanelContainer';
import { BottomDrawerContainer } from '../components/contacts/BottomDrawerContainer';
import { EmailTabs } from '../components/email/EmailTabs';
import { WorkspacePageShell } from '../components/shared/WorkspacePageShell';
import { usePageContext } from '../contexts/PageContextProvider';
import { useNotificationContext } from '../contexts/NotificationContext';
import { useRegisterCapabilities } from '../capabilities/useRegisterCapabilities';
import { getPageCapability } from '../capabilities/catalog';

type DocumentsView = 'all' | 'extracting' | 'chunking' | 'tagging' | 'ready' | 'failed';
type ColumnId = 'name' | 'type' | 'company' | 'status' | 'updated';
type FolderNode = { path: string; name: string; folders: Map<string, FolderNode>; docs: DocumentRecord[] };
type TreeRow =
  | { kind: 'folder'; key: string; depth: number; path: string; name: string; count: number; latest: string | null; explicit: boolean }
  | { kind: 'doc'; key: string; depth: number; doc: DocumentRecord };
type InspectorActivity = { id: string; label: string; detail?: string; ts?: string };

const COLUMNS: Array<{ id: ColumnId; label: string }> = [
  { id: 'name', label: 'Name' },
  { id: 'type', label: 'Type' },
  { id: 'company', label: 'Company' },
  { id: 'status', label: 'Status' },
  { id: 'updated', label: 'Updated' },
];

const COLUMN_TRACKS: Record<ColumnId, string> = {
  name: 'minmax(0, 1fr)',
  type: '104px',
  company: '128px',
  status: '104px',
  updated: '152px',
};

const PATH_SEP = '/';

function parseDocumentsView(value: string | null): DocumentsView {
  if (value === 'extracting' || value === 'chunking' || value === 'tagging' || value === 'ready' || value === 'failed' || value === 'all') {
    return value;
  }
  return 'all';
}

function matchesDocumentsView(doc: DocumentRecord, view: DocumentsView): boolean {
  const status = String(doc.status || '').trim().toLowerCase();
  if (view === 'all') return true;
  if (view === 'extracting') return status === 'pending' || status === 'extracting';
  if (view === 'chunking') return status === 'chunking' || status === 'embedding';
  if (view === 'tagging') return status === 'analyzing';
  if (view === 'ready') return status === 'ready';
  if (view === 'failed') return status === 'failed';
  return true;
}

function stageLabel(view: DocumentsView): string {
  if (view === 'extracting') return 'Extracting';
  if (view === 'chunking') return 'Chunking';
  if (view === 'tagging') return 'Tagging';
  if (view === 'ready') return 'Ready';
  if (view === 'failed') return 'Failed';
  return 'All Documents';
}

function normalizePath(value?: string | null): string {
  const raw = String(value || '').replace(/\\/g, '/').trim();
  if (!raw) return '';
  return raw
    .split('/')
    .map((p) => p.trim())
    .filter((p) => p && p !== '.' && p !== '..')
    .join(PATH_SEP);
}

function parentPath(path: string): string {
  const normalized = normalizePath(path);
  if (!normalized.includes(PATH_SEP)) return '';
  return normalized.split(PATH_SEP).slice(0, -1).join(PATH_SEP);
}

function statusBadge(status: string): string {
  const s = String(status || '').toLowerCase();
  if (s === 'ready') return 'bg-green-100 text-green-700';
  if (s === 'failed') return 'bg-red-100 text-red-700';
  if (['pending', 'extracting', 'chunking', 'embedding', 'analyzing'].includes(s)) return 'bg-blue-100 text-blue-700';
  return 'bg-accent/10 text-accent';
}

function prettyDate(iso?: string | null): string {
  if (!iso) return '-';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString();
}

function sortByNewest(a?: string | null, b?: string | null): number {
  const ta = a ? Date.parse(a) : Number.NaN;
  const tb = b ? Date.parse(b) : Number.NaN;
  if (Number.isFinite(ta) && Number.isFinite(tb)) return tb - ta;
  if (Number.isFinite(tb)) return 1;
  if (Number.isFinite(ta)) return -1;
  return 0;
}

function formatBytes(value?: number | null): string {
  if (!value || value <= 0) return '';
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function fallbackFolderPath(doc: DocumentRecord): string {
  const p = String(doc.storage_path || '').replace(/\\/g, '/').split('/').filter(Boolean);
  if (p[p.length - 1]?.toLowerCase() === doc.filename.toLowerCase()) p.pop();
  return normalizePath(p.join('/'));
}

function docFolderPath(doc: DocumentRecord): string {
  return normalizePath(doc.folder_path || fallbackFolderPath(doc));
}

function buildTree(docs: DocumentRecord[], folders: DocumentFolderRecord[], expanded: Record<string, boolean>): TreeRow[] {
  const root: FolderNode = { path: '', name: '', folders: new Map(), docs: [] };
  const explicitFolders = new Set<string>();
  const folderNodes = new Map<string, FolderNode>([['', root]]);

  const ensureFolder = (path: string): FolderNode => {
    const normalized = normalizePath(path);
    if (folderNodes.has(normalized)) return folderNodes.get(normalized)!;
    const parent = normalizePath(parentPath(normalized));
    const parentNode = ensureFolder(parent);
    const name = normalized.split(PATH_SEP).slice(-1)[0] || '';
    const node: FolderNode = { path: normalized, name, folders: new Map(), docs: [] };
    parentNode.folders.set(name, node);
    folderNodes.set(normalized, node);
    return node;
  };

  for (const f of folders) {
    const path = normalizePath(f.path);
    if (!path) continue;
    ensureFolder(path);
    explicitFolders.add(path);
  }
  for (const doc of docs) {
    ensureFolder(docFolderPath(doc)).docs.push(doc);
  }

  const rows: TreeRow[] = [];
  const walk = (node: FolderNode, depth: number) => {
    const folderList = Array.from(node.folders.values()).sort((a, b) => a.name.localeCompare(b.name));
    const docList = [...node.docs].sort((a, b) => sortByNewest(a.uploaded_at, b.uploaded_at));

    for (const folder of folderList) {
      const stats = collectFolderStats(folder);
      rows.push({
        kind: 'folder',
        key: `folder:${folder.path}`,
        depth,
        path: folder.path,
        name: folder.name,
        count: stats.count,
        latest: stats.latest,
        explicit: explicitFolders.has(folder.path),
      });
      if (expanded[folder.path] ?? true) walk(folder, depth + 1);
    }
    for (const doc of docList) {
      rows.push({ kind: 'doc', key: `doc:${doc.id}`, depth, doc });
    }
  };
  walk(root, 0);
  return rows;
}

function collectFolderStats(node: FolderNode): { count: number; latest: string | null } {
  let count = node.docs.length;
  let latest: string | null = null;
  for (const doc of node.docs) {
    if (sortByNewest(doc.uploaded_at, latest) < 0) latest = doc.uploaded_at || null;
  }
  for (const child of node.folders.values()) {
    const childStats = collectFolderStats(child);
    count += childStats.count;
    if (sortByNewest(childStats.latest, latest) < 0) latest = childStats.latest;
  }
  return { count, latest };
}

type TreeCellProps = {
  label: string;
  depth: number;
  kind: 'folder' | 'doc';
  isExpanded?: boolean;
  onToggle?: () => void;
  meta?: string;
  trailing?: ReactNode;
  onLabelDoubleClick?: (event: MouseEvent<HTMLElement>) => void;
};

function TreeCell({ label, depth, kind, isExpanded = false, onToggle, meta, trailing, onLabelDoubleClick }: TreeCellProps) {
  const indentPx = 12 + depth * 14;
  return (
    <div className="flex min-w-0 items-center gap-1.5" style={{ paddingLeft: `${indentPx}px` }}>
      {kind === 'folder' ? (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onToggle?.();
          }}
          aria-label={isExpanded ? `Collapse ${label}` : `Expand ${label}`}
          className="inline-flex h-5 w-5 items-center justify-center rounded border border-transparent text-text-dim hover:bg-surface-hover"
          data-row-control
        >
          <ChevronRight className={`h-3.5 w-3.5 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
        </button>
      ) : (
        <span className="inline-flex h-5 w-5 items-center justify-center">
          <FileText className="h-3.5 w-3.5 text-text-dim" />
        </span>
      )}
      {kind === 'folder' ? (
        isExpanded ? <FolderOpen className="h-3.5 w-3.5 shrink-0 text-amber-500" /> : <Folder className="h-3.5 w-3.5 shrink-0 text-amber-500" />
      ) : null}
      <div className="min-w-0 flex-1" onDoubleClick={onLabelDoubleClick}>
        <p className="truncate text-[12px] font-medium leading-4 text-text" title={label}>
          {label}
        </p>
        {kind === 'doc' && meta ? (
          <p className="truncate text-[10px] leading-4 text-text-dim" title={meta}>
            {meta}
          </p>
        ) : null}
      </div>
      {trailing ? <div className="ml-1 shrink-0">{trailing}</div> : null}
    </div>
  );
}

export default function DocumentsPage() {
  const router = useRouter();
  const isPhone = useIsMobile(640);
  const searchParams = useSearchParams();
  useRegisterCapabilities(getPageCapability('documents'));
  const { setPageContext } = usePageContext();
  const queryClient = useQueryClient();
  const { addNotification } = useNotificationContext();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const filterMenuRef = useRef<HTMLDivElement>(null);
  const lastFocusedRowRef = useRef<HTMLElement | null>(null);
  const detailsPanelRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showFiltersMenu, setShowFiltersMenu] = useState(false);
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({});
  const [columnVisibility, setColumnVisibility] = useState<Record<ColumnId, boolean>>({ name: true, type: true, company: true, status: true, updated: true });
  const [activeFolderPath, setActiveFolderPath] = useState<string>('');
  const [inlineFolderParentPath, setInlineFolderParentPath] = useState<string | null>(null);
  const [inlineFolderName, setInlineFolderName] = useState('');
  const [draggingItem, setDraggingItem] = useState<{ kind: 'folder'; path: string } | { kind: 'doc'; id: string } | null>(null);
  const [dropTargetFolderPath, setDropTargetFolderPath] = useState<string | null>(null);
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<DocumentAnswerResponse | null>(null);
  const [askLoading, setAskLoading] = useState(false);
  const [linkEvents, setLinkEvents] = useState<Array<{ ts: string; companyId: number | ''; contactIds: number[] }>>([]);
  const [qaEvents, setQaEvents] = useState<Array<{ ts: string; question: string }>>([]);
  const [selectedContactIds, setSelectedContactIds] = useState<number[]>([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState<number | ''>('');
  const [savedCompanyId, setSavedCompanyId] = useState<number | ''>('');
  const [savedContactIds, setSavedContactIds] = useState<number[]>([]);
  const [renaming, setRenaming] = useState<null | { kind: 'folder' | 'doc'; id: string | number; originalName: string }>(null);
  const [renameValue, setRenameValue] = useState('');
  const [renameError, setRenameError] = useState<string | null>(null);
  const [renameSaving, setRenameSaving] = useState(false);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const renameOriginRef = useRef<HTMLElement | null>(null);
  const [contextMenu, setContextMenu] = useState<null | { x: number; y: number; row: TreeRow; origin: HTMLElement | null }>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const [showInspectorMenu, setShowInspectorMenu] = useState(false);
  const inspectorMenuRef = useRef<HTMLDivElement>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const inlineFolderInputRef = useRef<HTMLInputElement>(null);
  const view = useMemo(() => parseDocumentsView(searchParams?.get('view') ?? null), [searchParams]);

  const baseListParams = useMemo(() => {
    const params: { q?: string } = {};
    if (query.trim()) params.q = query.trim();
    return params;
  }, [query]);

  const docsQ = useQuery({ queryKey: ['documents', baseListParams], queryFn: () => api.listDocuments(baseListParams), refetchInterval: 2500 });
  const foldersQ = useQuery({ queryKey: ['document-folders'], queryFn: () => api.listDocumentFolders() });
  const allDocuments = useMemo(() => docsQ.data?.documents || [], [docsQ.data?.documents]);
  const docsByStage = useMemo(() => allDocuments.filter((doc) => matchesDocumentsView(doc, view)), [allDocuments, view]);
  const docs = useMemo(
    () =>
      docsByStage.filter((doc) => {
        const matchesType = !typeFilter || String(doc.document_type || '').toLowerCase() === typeFilter.toLowerCase();
        const matchesStatus = !statusFilter || String(doc.status || '').toLowerCase() === statusFilter.toLowerCase();
        return matchesType && matchesStatus;
      }),
    [docsByStage, statusFilter, typeFilter]
  );
  const selectedDocument = useMemo(() => (selectedId ? docs.find((doc) => doc.id === selectedId) || null : null), [docs, selectedId]);
  const detailsQ = useQuery({
    queryKey: ['documents', 'detail', selectedId],
    queryFn: () => api.getDocument(String(selectedId)),
    enabled: Boolean(selectedId),
    refetchInterval: selectedDocument?.status === 'ready' || selectedDocument?.status === 'failed' ? false : 2500,
  });
  const companiesQ = useQuery({ queryKey: ['companies', 'for-doc-linking'], queryFn: () => api.getCompanies() });

  const rows = useMemo(() => buildTree(docs, foldersQ.data?.folders || [], expandedFolders), [docs, expandedFolders, foldersQ.data?.folders]);
  const typeOptions = useMemo(
    () =>
      Array.from(new Set((docsQ.data?.documents || []).map((doc) => String(doc.document_type || '').trim()).filter(Boolean))).sort((a, b) =>
        a.localeCompare(b)
      ),
    [docsQ.data?.documents]
  );
  const statusOptions = useMemo(
    () =>
      Array.from(new Set((docsQ.data?.documents || []).map((doc) => String(doc.status || '').trim()).filter(Boolean))).sort((a, b) =>
        a.localeCompare(b)
      ),
    [docsQ.data?.documents]
  );
  const visibleColumns = useMemo(() => {
    const selected = COLUMNS.filter((column) => columnVisibility[column.id] ?? true);
    return selected.length > 0 ? selected : COLUMNS;
  }, [columnVisibility]);
  const rowGridStyle: CSSProperties = {
    gridTemplateColumns: visibleColumns.map((column) => COLUMN_TRACKS[column.id]).join(' '),
  };

  const updateDocumentsRoute = useCallback(
    (mutate: (params: URLSearchParams) => void, options?: { replace?: boolean }) => {
      const params = new URLSearchParams(searchParams?.toString() ?? '');
      mutate(params);
      const search = params.toString();
      const nextUrl = `/documents${search ? `?${search}` : ''}`;
      if (options?.replace ?? false) {
        router.replace(nextUrl, { scroll: false });
      } else {
        router.push(nextUrl, { scroll: false });
      }
    },
    [router, searchParams]
  );

  const openDocument = useCallback(
    (documentId: string) => {
      updateDocumentsRoute((params) => {
        params.set('selectedDocumentId', documentId);
      });
    },
    [updateDocumentsRoute]
  );

  const closeDocumentRoute = useCallback(() => {
    updateDocumentsRoute(
      (params) => {
        params.delete('selectedDocumentId');
      },
      { replace: true }
    );
  }, [updateDocumentsRoute]);

  const setDocumentsView = useCallback(
    (nextView: DocumentsView) => {
      updateDocumentsRoute((params) => {
        params.set('view', nextView);
        params.delete('selectedDocumentId');
      });
    },
    [updateDocumentsRoute]
  );

  const handleSearchChange = useCallback(
    (value: string) => {
      setQuery(value);
      updateDocumentsRoute(
        (params) => {
          const trimmed = value.trim();
          if (trimmed) params.set('q', trimmed);
          else params.delete('q');
        },
        { replace: true }
      );
    },
    [updateDocumentsRoute]
  );

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (filterMenuRef.current && !filterMenuRef.current.contains(event.target as Node)) setShowFiltersMenu(false);
    }
    if (!showFiltersMenu) return;
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showFiltersMenu]);

  useEffect(() => {
    function handleInspectorMenuOutside(event: MouseEvent) {
      if (inspectorMenuRef.current && !inspectorMenuRef.current.contains(event.target as Node)) {
        setShowInspectorMenu(false);
      }
    }
    if (!showInspectorMenu) return;
    document.addEventListener('mousedown', handleInspectorMenuOutside);
    return () => document.removeEventListener('mousedown', handleInspectorMenuOutside);
  }, [showInspectorMenu]);

  useEffect(() => {
    function handleContextMenuOutside(event: MouseEvent) {
      if (contextMenuRef.current && !contextMenuRef.current.contains(event.target as Node)) {
        setContextMenu(null);
      }
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setContextMenu(null);
    };
    if (!contextMenu) return;
    document.addEventListener('mousedown', handleContextMenuOutside);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleContextMenuOutside);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [contextMenu]);

  useEffect(() => {
    if (!renaming) return;
    const id = window.requestAnimationFrame(() => {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    });
    return () => window.cancelAnimationFrame(id);
  }, [renaming]);

  useEffect(() => {
    const detail = detailsQ.data?.document;
    if (!detail) return;
    const nextCompanyId = typeof detail.linked_company_id === 'number' ? detail.linked_company_id : '';
    const nextContactIds = (detailsQ.data?.contacts || []).filter((contact) => Boolean(contact.confirmed)).map((contact) => contact.contact_id);
    setSelectedCompanyId(nextCompanyId);
    setSelectedContactIds(nextContactIds);
    setSavedCompanyId(nextCompanyId);
    setSavedContactIds(nextContactIds);
    setShowInspectorMenu(false);
  }, [detailsQ.data]);

  useEffect(() => {
    if (inlineFolderParentPath === null) return;
    const id = window.requestAnimationFrame(() => inlineFolderInputRef.current?.focus());
    return () => window.cancelAnimationFrame(id);
  }, [inlineFolderParentPath]);

  useEffect(() => {
    // Keep details closed by default; only clear stale selection if a selected doc disappears.
    if (selectedId && !docs.some((d) => d.id === selectedId)) closeDocumentRoute();
  }, [closeDocumentRoute, docs, selectedId]);

  useEffect(() => {
    const params = new URLSearchParams(searchParams?.toString() ?? '');
    const selectedFromQuery = params.get('selectedDocumentId');
    setSelectedId(selectedFromQuery || null);
    const q = params.get('q');
    setQuery(q ?? '');
  }, [searchParams]);

  useEffect(() => {
    if (isPhone || !selectedId) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeDocumentRoute();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [closeDocumentRoute, isPhone, selectedId]);

  useEffect(() => {
    if (isPhone || !selectedId) return;
    const id = window.requestAnimationFrame(() => detailsPanelRef.current?.focus());
    return () => window.cancelAnimationFrame(id);
  }, [isPhone, selectedId]);

  useEffect(() => {
    if (isPhone || selectedId) return;
    lastFocusedRowRef.current?.focus();
  }, [isPhone, selectedId]);

  useEffect(() => {
    setPageContext({
      listContext: 'documents',
      selected: selectedId ? { documentId: selectedId } : {},
      loadedIds: { documentIds: docs.slice(0, 200).map((d) => d.id) },
    });
  }, [docs, selectedId, setPageContext]);

  const refreshAll = async () => {
    await Promise.all([docsQ.refetch(), foldersQ.refetch(), selectedId ? detailsQ.refetch() : Promise.resolve()]);
  };

  const closeInspector = useCallback(() => {
    closeDocumentRoute();
  }, [closeDocumentRoute]);

  const isInteractiveTarget = useCallback((target: EventTarget | null) => {
    if (!(target instanceof HTMLElement)) return false;
    return !!target.closest('input, button, a, select, textarea, [role="button"], [data-row-control], [data-rename-input], [data-doc-context-menu]');
  }, []);

  const validateRename = useCallback((value: string, originalName: string): string | null => {
    const trimmed = value.trim();
    if (!trimmed) return 'Name is required';
    if (trimmed.length > 255) return 'Name must be 255 characters or less';
    if (trimmed.includes('/') || trimmed.includes('\\')) return 'Name cannot contain slashes';
    for (const char of trimmed) {
      const code = char.charCodeAt(0);
      if ((code >= 0 && code <= 31) || code === 127) return 'Name contains invalid characters';
    }
    if (trimmed === originalName.trim()) return null;
    return null;
  }, []);

  const startRename = useCallback(
    (row: TreeRow, origin?: HTMLElement | null) => {
      setContextMenu(null);
      setRenameError(null);
      if (row.kind === 'folder') {
        setRenaming({ kind: 'folder', id: row.path, originalName: row.name });
        setRenameValue(row.name);
      } else {
        setRenaming({ kind: 'doc', id: row.doc.id, originalName: row.doc.filename });
        setRenameValue(row.doc.filename);
      }
      renameOriginRef.current = origin || null;
    },
    []
  );

  const cancelRename = useCallback(() => {
    setRenaming(null);
    setRenameValue('');
    setRenameError(null);
    setRenameSaving(false);
    renameOriginRef.current?.focus();
  }, []);

  const applyOptimisticDocumentRename = useCallback(
    (documentId: string, nextName: string) => {
      queryClient.setQueriesData({ queryKey: ['documents'] }, (old: unknown) => {
        if (!old || typeof old !== 'object') return old;
        const maybeList = old as { documents?: DocumentRecord[]; document?: DocumentRecord };
        if (Array.isArray(maybeList.documents)) {
          return {
            ...maybeList,
            documents: maybeList.documents.map((doc) => (doc.id === documentId ? { ...doc, filename: nextName } : doc)),
          };
        }
        if (maybeList.document && maybeList.document.id === documentId) {
          return { ...maybeList, document: { ...maybeList.document, filename: nextName } };
        }
        return old;
      });
    },
    [queryClient]
  );

  const applyOptimisticFolderRename = useCallback(
    (fromPath: string, nextName: string) => {
      const fromNorm = normalizePath(fromPath);
      const parent = normalizePath(parentPath(fromNorm));
      const toNorm = normalizePath(parent ? `${parent}/${nextName}` : nextName);
      if (fromNorm === toNorm) return { fromNorm, toNorm };

      queryClient.setQueriesData({ queryKey: ['document-folders'] }, (old: unknown) => {
        if (!old || typeof old !== 'object') return old;
        const maybe = old as { folders?: DocumentFolderRecord[] };
        if (!Array.isArray(maybe.folders)) return old;
        const folders = maybe.folders.map((folder) => {
          const path = normalizePath(folder.path);
          if (path !== fromNorm && !path.startsWith(`${fromNorm}/`)) return folder;
          const suffix = path.slice(fromNorm.length);
          const nextPath = normalizePath(`${toNorm}${suffix}`);
          const nextParent = normalizePath(parentPath(nextPath));
          return { ...folder, path: nextPath, parent_path: nextParent, name: nextPath.split('/').pop() || folder.name };
        });
        return { ...maybe, folders };
      });

      queryClient.setQueriesData({ queryKey: ['documents'] }, (old: unknown) => {
        if (!old || typeof old !== 'object') return old;
        const maybe = old as { documents?: DocumentRecord[] };
        if (!Array.isArray(maybe.documents)) return old;
        return {
          ...maybe,
          documents: maybe.documents.map((doc) => {
            const folderPath = normalizePath(doc.folder_path || '');
            if (folderPath !== fromNorm && !folderPath.startsWith(`${fromNorm}/`)) return doc;
            const suffix = folderPath.slice(fromNorm.length);
            return { ...doc, folder_path: normalizePath(`${toNorm}${suffix}`) };
          }),
        };
      });

      setExpandedFolders((prev) => {
        const next: Record<string, boolean> = {};
        for (const [key, value] of Object.entries(prev)) {
          const norm = normalizePath(key);
          if (norm === fromNorm || norm.startsWith(`${fromNorm}/`)) {
            const suffix = norm.slice(fromNorm.length);
            next[normalizePath(`${toNorm}${suffix}`)] = value;
          } else {
            next[key] = value;
          }
        }
        return next;
      });
      setActiveFolderPath((prev) => {
        const norm = normalizePath(prev);
        if (norm === fromNorm || norm.startsWith(`${fromNorm}/`)) {
          const suffix = norm.slice(fromNorm.length);
          return normalizePath(`${toNorm}${suffix}`);
        }
        return prev;
      });
      return { fromNorm, toNorm };
    },
    [queryClient]
  );

  const confirmRename = useCallback(async () => {
    if (!renaming || renameSaving) return;
    const nextName = renameValue.trim();
    if (nextName === renaming.originalName.trim()) {
      cancelRename();
      return;
    }
    const validationError = validateRename(renameValue, renaming.originalName);
    if (validationError) {
      setRenameError(validationError);
      return;
    }

    setRenameSaving(true);
    setRenameError(null);
    try {
      if (renaming.kind === 'doc') {
        const snapshotDocs = queryClient.getQueriesData({ queryKey: ['documents'] });
        applyOptimisticDocumentRename(String(renaming.id), nextName);
        try {
          await api.renameDocument(String(renaming.id), { name: nextName });
        } catch (error) {
          for (const [key, value] of snapshotDocs) queryClient.setQueryData(key, value);
          throw error;
        }
      } else {
        const originalPath = String(renaming.id);
        const snapshotFolders = queryClient.getQueryData(['document-folders']);
        const snapshotDocs = queryClient.getQueriesData({ queryKey: ['documents'] });
        const snapshotExpanded = expandedFolders;
        const snapshotActiveFolder = activeFolderPath;
        applyOptimisticFolderRename(originalPath, nextName);
        try {
          await api.renameDocumentFolder(originalPath, { name: nextName });
        } catch (error) {
          queryClient.setQueryData(['document-folders'], snapshotFolders);
          for (const [key, value] of snapshotDocs) queryClient.setQueryData(key, value);
          setExpandedFolders(snapshotExpanded);
          setActiveFolderPath(snapshotActiveFolder);
          throw error;
        }
      }
      addNotification({ type: 'success', title: 'Rename saved' });
      setRenaming(null);
      setRenameValue('');
      setRenameError(null);
      setRenameSaving(false);
      renameOriginRef.current?.focus();
    } catch (error) {
      setRenameSaving(false);
      setRenameError(error instanceof Error ? error.message : 'Rename failed');
      addNotification({ type: 'error', title: 'Rename failed', message: error instanceof Error ? error.message : 'Please retry.' });
    }
  }, [
    renaming,
    renameSaving,
    renameValue,
    cancelRename,
    validateRename,
    addNotification,
    applyOptimisticDocumentRename,
    applyOptimisticFolderRename,
    queryClient,
    expandedFolders,
    activeFolderPath,
  ]);

  const ensureFolderPath = async (path: string) => {
    const normalized = normalizePath(path);
    if (!normalized) return;
    const parts = normalized.split(PATH_SEP);
    let current = '';
    for (const part of parts) {
      const parent = current;
      current = current ? `${current}/${part}` : part;
      try {
        await api.createDocumentFolder({ name: part, parent_path: parent });
      } catch {
        // ignore "already exists" and continue
      }
    }
  };

  const createFolder = () => {
    const parent = normalizePath(activeFolderPath);
    if (parent) {
      setExpandedFolders((prev) => ({ ...prev, [parent]: true }));
    }
    setInlineFolderParentPath(parent);
    setInlineFolderName('');
    setErrorMessage(null);
  };

  const cancelInlineFolder = () => {
    setInlineFolderParentPath(null);
    setInlineFolderName('');
  };

  const submitInlineFolder = async () => {
    if (inlineFolderParentPath === null) return;
    const name = inlineFolderName.trim();
    if (!name) return;
    setErrorMessage(null);
    try {
      await api.createDocumentFolder({ name, parent_path: inlineFolderParentPath });
      await foldersQ.refetch();
      cancelInlineFolder();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to create folder');
    }
  };

  const moveFolder = async (fromPath: string) => {
    const toParentRaw = window.prompt(`Move "${fromPath}" to parent folder path (blank = root):`, parentPath(fromPath));
    if (toParentRaw === null) return;
    const toParent = normalizePath(toParentRaw);
    setErrorMessage(null);
    try {
      if (toParent) await ensureFolderPath(toParent);
      await api.moveDocumentFolder({ from_path: fromPath, to_parent_path: toParent });
      await refreshAll();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to move folder');
    }
  };

  const moveDocument = async (documentId: string, currentFolder: string) => {
    const toRaw = window.prompt('Move file to folder path (blank = root):', currentFolder);
    if (toRaw === null) return;
    const toFolder = normalizePath(toRaw);
    setErrorMessage(null);
    try {
      if (toFolder) await ensureFolderPath(toFolder);
      await api.moveDocumentToFolder(documentId, { to_folder_path: toFolder });
      await docsQ.refetch();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to move file');
    }
  };

  const moveDocumentByDrop = async (documentId: string, toFolderPath: string) => {
    setErrorMessage(null);
    try {
      await api.moveDocumentToFolder(documentId, { to_folder_path: normalizePath(toFolderPath) });
      await docsQ.refetch();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to move file');
    }
  };

  const moveFolderByDrop = async (fromPath: string, toParentPath: string) => {
    setErrorMessage(null);
    try {
      await api.moveDocumentFolder({ from_path: fromPath, to_parent_path: normalizePath(toParentPath) });
      await refreshAll();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to move folder');
    }
  };

  const handleDropOnFolder = async (targetFolderPath: string) => {
    if (!draggingItem) return;
    if (draggingItem.kind === 'doc') {
      await moveDocumentByDrop(draggingItem.id, targetFolderPath);
    } else {
      await moveFolderByDrop(draggingItem.path, targetFolderPath);
    }
    setDropTargetFolderPath(null);
    setDraggingItem(null);
  };

  const handleDropOnRoot = async () => {
    if (!draggingItem) return;
    if (draggingItem.kind === 'doc') {
      await moveDocumentByDrop(draggingItem.id, '');
    } else {
      await moveFolderByDrop(draggingItem.path, '');
    }
    setDropTargetFolderPath(null);
    setDraggingItem(null);
  };

  const deleteEmptyFolder = async (path: string) => {
    if (!window.confirm(`Delete empty folder "${path}"?`)) return;
    setErrorMessage(null);
    try {
      await api.deleteDocumentFolder(path);
      await foldersQ.refetch();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to delete folder');
    }
  };

  const onUploadChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setErrorMessage(null);
    try {
      await api.uploadDocument(file);
      await docsQ.refetch();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Upload failed');
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const onLink = async () => {
    if (!selectedId) return;
    await api.linkDocumentToEntities({
      document_id: selectedId,
      company_id: selectedCompanyId === '' ? undefined : Number(selectedCompanyId),
      contact_ids: selectedContactIds,
    });
    setLinkEvents((prev) => [{ ts: new Date().toISOString(), companyId: selectedCompanyId, contactIds: selectedContactIds }, ...prev].slice(0, 20));
    setSavedCompanyId(selectedCompanyId);
    setSavedContactIds([...selectedContactIds]);
    await refreshAll();
  };

  const onAsk = async () => {
    const trimmed = question.trim();
    if (!trimmed) return;
    setAskLoading(true);
    try {
      setQaEvents((prev) => [{ ts: new Date().toISOString(), question: trimmed }, ...prev].slice(0, 20));
      setAnswer(await api.askDocuments({ question: trimmed, document_ids: selectedId ? [selectedId] : undefined }));
    } finally {
      setAskLoading(false);
    }
  };

  const inspectorDocument = detailsQ.data?.document || selectedDocument;
  const inspectorStatus = String(inspectorDocument?.status || '').toLowerCase();
  const inspectorSubtitle = `${inspectorDocument?.mime_type || inspectorDocument?.document_type || 'Unknown type'} · ${prettyDate(
    inspectorDocument?.uploaded_at
  )}`;
  const openHref = useMemo(() => {
    const source = String(inspectorDocument?.source || '').trim();
    if (/^https?:\/\//i.test(source)) return source;
    const storagePath = String(inspectorDocument?.storage_path || '').trim();
    if (/^https?:\/\//i.test(storagePath)) return storagePath;
    return '';
  }, [inspectorDocument?.source, inspectorDocument?.storage_path]);
  const hasRetryAction = inspectorDocument?.id && inspectorStatus !== 'ready';
  const sortedSelectedContactIds = useMemo(() => [...selectedContactIds].sort((a, b) => a - b), [selectedContactIds]);
  const sortedSavedContactIds = useMemo(() => [...savedContactIds].sort((a, b) => a - b), [savedContactIds]);
  const linksDirty = selectedCompanyId !== savedCompanyId || sortedSelectedContactIds.join(',') !== sortedSavedContactIds.join(',');
  const linkedCompanyLabel =
    selectedCompanyId === ''
      ? ''
      : (companiesQ.data || []).find((company) => company.id === selectedCompanyId)?.company_name || `Company ${selectedCompanyId}`;
  const suggestedQuestions = useMemo(() => {
    const haystack = `${inspectorDocument?.filename || ''} ${inspectorDocument?.document_type || ''} ${inspectorDocument?.mime_type || ''}`.toLowerCase();
    if (haystack.includes('estimate') || haystack.includes('quote')) {
      return ['What is the total estimate?', 'List scope items with quantities.', 'What assumptions are included?', 'What is excluded?'];
    }
    if (haystack.includes('workflow') || haystack.includes('process')) {
      return ['Summarize the workflow steps.', 'What are the dependencies?', 'What is the critical path?', 'What risks are called out?'];
    }
    return ['Summarize this document.', 'List key action items.', 'What decisions are documented?', 'What should happen next?'];
  }, [inspectorDocument?.document_type, inspectorDocument?.filename, inspectorDocument?.mime_type]);
  const inspectorActivities: InspectorActivity[] = useMemo(() => {
    if (!inspectorDocument) return [];
    const items: InspectorActivity[] = [];
    if (inspectorDocument.uploaded_at) {
      items.push({
        id: `uploaded-${inspectorDocument.id}`,
        label: 'Indexed',
        detail: inspectorDocument.filename,
        ts: inspectorDocument.uploaded_at,
      });
    }
    items.push({
      id: `status-${inspectorDocument.id}`,
      label: 'Status',
      detail: inspectorDocument.status,
      ts: inspectorDocument.uploaded_at || new Date().toISOString(),
    });
    for (const evt of linkEvents) {
      items.push({
        id: `link-${evt.ts}`,
        label: 'Linking updated',
        detail: `Company: ${evt.companyId || 'none'}, Contacts: ${evt.contactIds.length}`,
        ts: evt.ts,
      });
    }
    for (const evt of qaEvents) {
      items.push({ id: `qa-${evt.ts}`, label: 'Question asked', detail: evt.question, ts: evt.ts });
    }
    return items
      .sort((a, b) => sortByNewest(a.ts, b.ts))
      .slice(0, 20);
  }, [inspectorDocument, linkEvents, qaEvents]);

  const documentTabs = useMemo(
    () => [
      { id: 'all', label: 'All', count: allDocuments.length },
      { id: 'extracting', label: 'Extracting', count: allDocuments.filter((doc) => matchesDocumentsView(doc, 'extracting')).length },
      { id: 'chunking', label: 'Chunking', count: allDocuments.filter((doc) => matchesDocumentsView(doc, 'chunking')).length },
      { id: 'tagging', label: 'Tagging', count: allDocuments.filter((doc) => matchesDocumentsView(doc, 'tagging')).length },
      { id: 'ready', label: 'Ready', count: allDocuments.filter((doc) => matchesDocumentsView(doc, 'ready')).length },
      { id: 'failed', label: 'Failed', count: allDocuments.filter((doc) => matchesDocumentsView(doc, 'failed')).length },
    ],
    [allDocuments]
  );

  const inlineControls = (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <div className="min-w-[240px] flex-1">
        <PageSearchInput value={query} onChange={handleSearchChange} placeholder="Search filename, summary, or content" />
      </div>
      <select
        value={typeFilter}
        onChange={(e) => setTypeFilter(e.target.value)}
        className="h-8 shrink-0 rounded-md border border-border bg-surface px-2.5 text-[12px] text-text focus:outline-none focus:border-accent"
        aria-label="Filter documents by type"
      >
        <option value="">All types</option>
        {typeOptions.map((type) => (
          <option key={type} value={type}>
            {type}
          </option>
        ))}
      </select>
      <select
        value={statusFilter}
        onChange={(e) => setStatusFilter(e.target.value)}
        className="h-8 shrink-0 rounded-md border border-border bg-surface px-2.5 text-[12px] text-text focus:outline-none focus:border-accent"
        aria-label="Filter documents by status"
      >
        <option value="">All statuses</option>
        {statusOptions.map((status) => (
          <option key={status} value={status}>
            {status}
          </option>
        ))}
      </select>
      <div className="relative shrink-0" ref={filterMenuRef}>
        <button
          type="button"
          onClick={() => setShowFiltersMenu((v) => !v)}
          className="h-8 w-8 inline-flex items-center justify-center rounded-md border border-border text-text-muted hover:bg-surface-hover"
          title="Visible columns"
          aria-label="Open visible columns menu"
        >
          <SlidersHorizontal className="w-4 h-4" />
        </button>
        {showFiltersMenu ? (
          <div className="absolute right-0 top-10 z-20 w-[260px] rounded-md border border-border bg-surface p-3 shadow-lg">
            <div className="space-y-2">
              <p className="text-[11px] font-medium uppercase tracking-wide text-text-muted">Visible Columns</p>
              {COLUMNS.map((column) => (
                <label key={column.id} className="flex items-center gap-2 text-[12px] text-text">
                  <input
                    type="checkbox"
                    checked={columnVisibility[column.id]}
                    disabled={column.id === 'name'}
                    onChange={(event) => {
                      if (column.id === 'name') return;
                      setColumnVisibility((prev) => ({ ...prev, [column.id]: event.target.checked }));
                    }}
                    className="w-3.5 h-3.5 rounded border-gray-300 text-accent focus:ring-accent"
                  />
                  <span>
                    {column.label}
                    {column.id === 'name' ? ' (required)' : ''}
                  </span>
                </label>
              ))}
            </div>
          </div>
        ) : null}
      </div>
      <HeaderActionButton onClick={() => fileInputRef.current?.click()} variant="primary" icon={<Upload className="h-4 w-4" />}>
        Upload
      </HeaderActionButton>
      <HeaderActionButton onClick={createFolder} variant="secondary" icon={<Plus className="h-4 w-4" />}>
        New Folder
      </HeaderActionButton>
      <HeaderActionButton onClick={refreshAll} variant="secondary" icon={<RefreshCw className="h-4 w-4" />}>
        Refresh
      </HeaderActionButton>
    </div>
  );

  return (
    <div className="h-full flex flex-col">
      <input ref={fileInputRef} type="file" className="hidden" onChange={onUploadChange} accept=".pdf,.docx,.csv,.txt,.png,.jpg,.jpeg,.webp" />
      <WorkspacePageShell
        title="Documents"
        subtitle={
          view === 'all'
            ? `${docs.length} document${docs.length === 1 ? '' : 's'}${query.trim() ? ' matching search' : ''}`
            : `${docs.length} document${docs.length === 1 ? '' : 's'} in ${stageLabel(view).toLowerCase()}${query.trim() ? ' matching search' : ''}`
        }
        contentClassName="overflow-hidden"
        hideHeader
        preHeader={
          <EmailTabs
            tabs={documentTabs}
            activeTab={view}
            onSelectTab={(tabId) => {
              if (tabId === 'all' || tabId === 'extracting' || tabId === 'chunking' || tabId === 'tagging' || tabId === 'ready' || tabId === 'failed') {
                setDocumentsView(tabId);
              }
            }}
          />
        }
        preHeaderAffectsLayout
        preHeaderClassName="-mt-3 md:-mt-4 h-14 flex items-end"
        toolbar={inlineControls}
      >
        {errorMessage ? <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{errorMessage}</div> : null}
        <div className={`min-h-0 flex-1 overflow-hidden ${errorMessage ? 'pt-2' : 'pt-2'}`}>
          {docsQ.isLoading ? (
            <LoadingSpinner />
          ) : docsQ.isError ? (
            <EmptyState
              icon={FileText}
              title="Could not load documents"
              description={docsQ.error instanceof Error ? docsQ.error.message : 'Please retry.'}
              action={{ label: 'Retry', icon: RefreshCw, onClick: () => void refreshAll() }}
            />
          ) : docs.length === 0 ? (
            <EmptyState
              icon={FileText}
              title={query || typeFilter || statusFilter ? 'No documents match these filters' : 'No documents yet'}
              description={query || typeFilter || statusFilter ? 'Try adjusting search or filters.' : 'Upload your first file to start indexing and Q&A.'}
              action={{ label: 'Upload Document', icon: Upload, onClick: () => fileInputRef.current?.click() }}
            />
          ) : (
            <div className="bg-surface overflow-hidden flex h-full min-h-0">
              <div className="flex min-w-0 min-h-0 flex-1 flex-col">
                <div className="shrink-0 border-b border-border-subtle bg-surface-hover/30">
                  <div className="grid h-9 items-center" style={rowGridStyle}>
                    {visibleColumns.map((c) => (
                      <div
                        key={`header-${c.id}`}
                        className={`min-w-0 px-3 py-2 text-[11px] font-medium uppercase tracking-wide ${c.id === 'updated' ? 'text-right text-text-dim' : 'text-text-muted'}`}
                      >
                        {c.label}
                      </div>
                    ))}
                  </div>
                </div>
                <div
                  className="min-h-0 flex-1 overflow-auto"
                  onDragOver={(e) => {
                    if (!draggingItem) return;
                    if (e.target !== e.currentTarget) return;
                    e.preventDefault();
                  }}
                  onDrop={(e) => {
                    if (e.target !== e.currentTarget) return;
                    e.preventDefault();
                    void handleDropOnRoot();
                  }}
                >
                  {rows.map((row) => {
                    const isDoc = row.kind === 'doc';
                    const selected = isDoc && row.doc.id === selectedId;
                    const isDropTarget = row.kind === 'folder' && dropTargetFolderPath === row.path;
                    return (
                      <Fragment key={`row-frag-${row.key}`}>
                        {inlineFolderParentPath === '' && row === rows[0] ? (
                          <div className="grid border-b border-border-subtle bg-accent/5" style={rowGridStyle}>
                            {visibleColumns.map((column) => (
                              <div key={`inline-root-${column.id}`} className="min-w-0 px-3 py-2 text-[12px] text-text-dim">
                                {column.id === 'name' ? (
                                  <div className="flex min-w-0 items-center gap-2">
                                    <Folder className="w-3.5 h-3.5 text-amber-500" />
                                    <input
                                      ref={inlineFolderInputRef}
                                      value={inlineFolderName}
                                      onChange={(e) => setInlineFolderName(e.target.value)}
                                      onKeyDown={(e) => {
                                        if (e.key === 'Enter') void submitInlineFolder();
                                        if (e.key === 'Escape') cancelInlineFolder();
                                      }}
                                      onBlur={() => {
                                        if (inlineFolderName.trim()) void submitInlineFolder();
                                        else cancelInlineFolder();
                                      }}
                                      placeholder="New folder name"
                                      className="h-7 w-full rounded border border-border bg-surface px-2 text-[12px] text-text focus:outline-none focus:border-accent"
                                    />
                                  </div>
                                ) : (
                                  '-'
                                )}
                              </div>
                            ))}
                          </div>
                        ) : null}
                        <div
                          draggable
                          onDragStart={(e) => {
                            setDraggingItem(row.kind === 'folder' ? { kind: 'folder', path: row.path } : { kind: 'doc', id: row.doc.id });
                            e.dataTransfer.effectAllowed = 'move';
                          }}
                          onDragEnd={() => {
                            setDraggingItem(null);
                            setDropTargetFolderPath(null);
                          }}
                          onDragOver={(e) => {
                            if (row.kind !== 'folder' || !draggingItem) return;
                            e.preventDefault();
                            e.stopPropagation();
                            setDropTargetFolderPath(row.path);
                          }}
                          onDrop={(e) => {
                            if (row.kind !== 'folder') return;
                            e.preventDefault();
                            e.stopPropagation();
                            void handleDropOnFolder(row.path);
                          }}
                          className={`group grid h-[42px] items-center border-b border-border-subtle ${isDoc ? `${selected ? 'bg-accent/10' : 'hover:bg-surface-hover/60'} cursor-pointer` : 'bg-surface-hover/20'} ${isDropTarget ? 'ring-1 ring-accent' : ''}`}
                          style={rowGridStyle}
                          tabIndex={isDoc ? 0 : -1}
                          aria-expanded={isDoc ? selected : undefined}
                          aria-controls={isDoc && selected ? 'document-details-panel' : undefined}
                          aria-label={isDoc ? `Open details for ${row.doc.filename}` : `Folder ${row.name}`}
                          onClick={(event) => {
                            if (
                              renaming &&
                              ((renaming.kind === 'folder' && row.kind === 'folder' && String(renaming.id) === row.path) ||
                                (renaming.kind === 'doc' && row.kind === 'doc' && String(renaming.id) === row.doc.id))
                            ) {
                              return;
                            }
                            if (isInteractiveTarget(event.target)) return;
                            setContextMenu(null);
                            if (row.kind === 'doc') {
                              lastFocusedRowRef.current = event.currentTarget;
                              openDocument(row.doc.id);
                            } else {
                              setActiveFolderPath(row.path);
                              setExpandedFolders((prev) => ({ ...prev, [row.path]: !(prev[row.path] ?? true) }));
                            }
                          }}
                          onContextMenu={(event) => {
                            event.preventDefault();
                            setContextMenu({
                              x: event.clientX,
                              y: event.clientY,
                              row,
                              origin: event.currentTarget as HTMLElement,
                            });
                          }}
                          onKeyDown={(event) => {
                            if (event.key !== 'Enter' && event.key !== ' ') return;
                            if (
                              renaming &&
                              ((renaming.kind === 'folder' && row.kind === 'folder' && String(renaming.id) === row.path) ||
                                (renaming.kind === 'doc' && row.kind === 'doc' && String(renaming.id) === row.doc.id))
                            ) {
                              return;
                            }
                            if (isInteractiveTarget(event.target)) return;
                            event.preventDefault();
                            if (row.kind === 'doc') {
                              lastFocusedRowRef.current = event.currentTarget;
                              openDocument(row.doc.id);
                            } else {
                              setActiveFolderPath(row.path);
                              setExpandedFolders((prev) => ({ ...prev, [row.path]: !(prev[row.path] ?? true) }));
                            }
                          }}
                        >
                          {visibleColumns.map((column) => {
                            if (column.id === 'name') {
                              const fileMeta = row.kind === 'doc'
                                ? [row.doc.document_type || 'Document', formatBytes(row.doc.file_size_bytes), prettyDate(row.doc.uploaded_at)]
                                    .filter(Boolean)
                                    .join(' · ')
                                : undefined;
                              const trailingActions = row.kind === 'folder' ? (
                                <div className="hidden items-center gap-1 group-hover:flex">
                                  {row.explicit ? (
                                    <button
                                      type="button"
                                      data-row-control
                                      aria-label={`Move folder ${row.path}`}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        void moveFolder(row.path);
                                      }}
                                      className="inline-flex h-6 w-6 items-center justify-center rounded border border-border text-text-muted hover:bg-surface"
                                      title="Move folder"
                                    >
                                      <MoveRight className="h-3.5 w-3.5" />
                                    </button>
                                  ) : null}
                                  {row.explicit ? (
                                    <button
                                      type="button"
                                      data-row-control
                                      aria-label={`Delete folder ${row.path}`}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        void deleteEmptyFolder(row.path);
                                      }}
                                      className="inline-flex h-6 w-6 items-center justify-center rounded border border-red-200 text-red-600 hover:bg-red-50"
                                      title="Delete empty folder"
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </button>
                                  ) : null}
                                </div>
                              ) : (
                                <div className="hidden items-center gap-1 group-hover:flex">
                                  <button
                                    type="button"
                                    data-row-control
                                    aria-label={`Move file ${row.doc.filename}`}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      void moveDocument(row.doc.id, docFolderPath(row.doc));
                                    }}
                                    className="inline-flex h-6 w-6 items-center justify-center rounded border border-border text-text-muted hover:bg-surface"
                                    title="Move file"
                                  >
                                    <MoveRight className="h-3.5 w-3.5" />
                                  </button>
                                </div>
                              );
                              return (
                                <div key={`${row.key}-name`} className="min-w-0 px-3 py-1.5">
                                  {renaming &&
                                  ((renaming.kind === 'folder' && row.kind === 'folder' && String(renaming.id) === row.path) ||
                                    (renaming.kind === 'doc' && row.kind === 'doc' && String(renaming.id) === row.doc.id)) ? (
                                    <div
                                      className="flex min-w-0 items-center gap-2"
                                      style={{ paddingLeft: `${12 + row.depth * 14}px` }}
                                      data-rename-input
                                      onClick={(event) => event.stopPropagation()}
                                      onDoubleClick={(event) => event.stopPropagation()}
                                    >
                                      {row.kind === 'folder' ? <Folder className="h-3.5 w-3.5 text-amber-500" /> : <FileText className="h-3.5 w-3.5 text-text-dim" />}
                                      <div className="min-w-0 flex-1">
                                        <input
                                          ref={renameInputRef}
                                          value={renameValue}
                                          disabled={renameSaving}
                                          onChange={(event) => {
                                            setRenameValue(event.target.value);
                                            if (renameError) setRenameError(null);
                                          }}
                                          onKeyDown={(event) => {
                                            if (event.key === 'Enter') {
                                              event.preventDefault();
                                              void confirmRename();
                                            } else if (event.key === 'Escape') {
                                              event.preventDefault();
                                              cancelRename();
                                            }
                                          }}
                                          onBlur={() => {
                                            if (!renaming) return;
                                            const next = renameValue.trim();
                                            if (next === renaming.originalName.trim()) {
                                              cancelRename();
                                              return;
                                            }
                                            const validationError = validateRename(renameValue, renaming.originalName);
                                            if (validationError) {
                                              setRenameError(validationError);
                                              window.requestAnimationFrame(() => renameInputRef.current?.focus());
                                              return;
                                            }
                                            void confirmRename();
                                          }}
                                          className={`h-7 w-full rounded border bg-surface px-2 text-[12px] text-text focus:outline-none focus:border-accent ${
                                            renameError ? 'border-red-400' : 'border-border'
                                          }`}
                                          data-rename-input
                                        />
                                        {renameSaving ? <p className="mt-0.5 text-[10px] text-text-dim">Saving...</p> : null}
                                        {renameError ? <p className="mt-0.5 text-[10px] text-red-600">{renameError}</p> : null}
                                      </div>
                                    </div>
                                  ) : (
                                    <div data-rename-origin>
                                      <TreeCell
                                        label={row.kind === 'folder' ? row.name : row.doc.filename}
                                        depth={row.depth}
                                        kind={row.kind}
                                        isExpanded={row.kind === 'folder' ? expandedFolders[row.path] ?? true : false}
                                        onToggle={
                                          row.kind === 'folder'
                                            ? () => {
                                                setActiveFolderPath(row.path);
                                                setExpandedFolders((prev) => ({ ...prev, [row.path]: !(prev[row.path] ?? true) }));
                                              }
                                            : undefined
                                        }
                                        meta={fileMeta}
                                        onLabelDoubleClick={(event) => {
                                          if (isInteractiveTarget(event.target)) return;
                                          const origin = (event.currentTarget.closest('[data-rename-origin]') as HTMLElement | null) ?? null;
                                          startRename(row, origin);
                                        }}
                                        trailing={
                                          row.kind === 'folder' ? (
                                            <div className="flex items-center gap-2">
                                              <span className="text-[11px] text-text-dim">{row.count}</span>
                                              {trailingActions}
                                            </div>
                                          ) : (
                                            trailingActions
                                          )
                                        }
                                      />
                                    </div>
                                  )}
                                </div>
                              );
                            }
                            if (column.id === 'type') {
                              return (
                                <div key={`${row.key}-type`} className="min-w-0 px-3 py-1.5 text-[12px] text-text-dim whitespace-nowrap">
                                  {row.kind === 'folder' ? 'Folder' : row.doc.document_type || '-'}
                                </div>
                              );
                            }
                            if (column.id === 'company') {
                              return (
                                <div key={`${row.key}-company`} className="min-w-0 px-3 py-1.5 text-[12px] text-text-dim truncate">
                                  {row.kind === 'folder' ? '-' : row.doc.linked_company_name || '-'}
                                </div>
                              );
                            }
                            if (column.id === 'status') {
                              return (
                                <div key={`${row.key}-status`} className="min-w-0 px-3 py-1.5">
                                  {row.kind === 'folder' ? <span className="text-[11px] text-text-dim">-</span> : <span className={`rounded px-2 py-0.5 text-[11px] ${statusBadge(row.doc.status)}`}>{row.doc.status}</span>}
                                </div>
                              );
                            }
                            return (
                              <div key={`${row.key}-updated`} className="min-w-0 px-3 py-1.5 text-right text-[12px] tabular-nums text-text-dim whitespace-nowrap">
                                {row.kind === 'folder' ? prettyDate(row.latest) : prettyDate(row.doc.uploaded_at)}
                              </div>
                            );
                          })}
                        </div>
                        {row.kind === 'folder' && inlineFolderParentPath === row.path ? (
                          <div className="grid border-b border-border-subtle bg-accent/5" style={rowGridStyle}>
                            {visibleColumns.map((column) => (
                              <div key={`inline-child-${row.path}-${column.id}`} className="min-w-0 px-3 py-2 text-[12px] text-text-dim">
                                {column.id === 'name' ? (
                                  <div className="flex min-w-0 items-center gap-2" style={{ paddingLeft: `${(row.depth + 1) * 16}px` }}>
                                    <Folder className="w-3.5 h-3.5 text-amber-500" />
                                    <input
                                      ref={inlineFolderInputRef}
                                      value={inlineFolderName}
                                      onChange={(e) => setInlineFolderName(e.target.value)}
                                      onKeyDown={(e) => {
                                        if (e.key === 'Enter') void submitInlineFolder();
                                        if (e.key === 'Escape') cancelInlineFolder();
                                      }}
                                      onBlur={() => {
                                        if (inlineFolderName.trim()) void submitInlineFolder();
                                        else cancelInlineFolder();
                                      }}
                                      placeholder="New folder name"
                                      className="h-7 w-full rounded border border-border bg-surface px-2 text-[12px] text-text focus:outline-none focus:border-accent"
                                    />
                                  </div>
                                ) : (
                                  '-'
                                )}
                              </div>
                            ))}
                          </div>
                        ) : null}
                      </Fragment>
                    );
                  })}
                </div>
              </div>

              {!isPhone && selectedId ? (
                <SidePanelContainer ref={detailsPanelRef} ariaLabel="Document details panel">
                  <div id="document-details-panel" tabIndex={-1} className="flex h-full min-h-0 flex-col outline-none">
                    <div className="h-full overflow-y-auto">
                      <div className="sticky top-0 z-10 border-b border-border bg-surface px-3 py-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <h3 className="truncate text-sm font-semibold text-text">{inspectorDocument?.filename || 'Document'}</h3>
                            <p className="truncate text-xs text-text-dim">{inspectorSubtitle}</p>
                          </div>
                          <div className="flex items-center gap-1" ref={inspectorMenuRef}>
                            <button
                              type="button"
                              aria-label="Toggle document actions"
                              onClick={() => setShowInspectorMenu((prev) => !prev)}
                              className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border text-text-muted hover:bg-surface-hover"
                            >
                              <MoreHorizontal className="h-3.5 w-3.5" />
                            </button>
                            {showInspectorMenu ? (
                              <div className="absolute right-3 top-10 w-40 rounded-md border border-border bg-surface p-1 shadow-lg">
                                <button type="button" disabled className="block w-full rounded px-2 py-1 text-left text-xs text-text-dim">
                                  Rename (coming soon)
                                </button>
                                <button type="button" disabled className="block w-full rounded px-2 py-1 text-left text-xs text-text-dim">
                                  Move (coming soon)
                                </button>
                                <button type="button" disabled className="block w-full rounded px-2 py-1 text-left text-xs text-red-400">
                                  Delete (coming soon)
                                </button>
                              </div>
                            ) : null}
                            <button
                              type="button"
                              aria-label="Close document details"
                              onClick={closeInspector}
                              className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border text-text-muted hover:bg-surface-hover"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>
                        <div className="mt-2 flex items-center gap-1.5">
                          <span className={`inline-flex h-5 items-center rounded-full px-2 text-[11px] ${statusBadge(inspectorStatus)}`}>
                            {inspectorStatus || 'unknown'}
                          </span>
                          {openHref ? (
                            <a
                              href={openHref}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex h-7 items-center rounded-md border border-border px-2.5 text-xs text-text hover:bg-surface-hover"
                            >
                              Open
                            </a>
                          ) : null}
                          {hasRetryAction ? (
                            <button
                              type="button"
                              onClick={() => (inspectorDocument?.id ? void api.retryDocumentProcessing(inspectorDocument.id).then(() => void refreshAll()) : undefined)}
                              className="inline-flex h-7 items-center gap-1 rounded-md border border-border px-2.5 text-xs text-text hover:bg-surface-hover"
                            >
                              <RotateCcw className="h-3.5 w-3.5" /> Re-index
                            </button>
                          ) : null}
                        </div>
                      </div>
                      <div className="space-y-3 p-3 text-xs">
                        {detailsQ.isLoading ? (
                          <LoadingSpinner />
                        ) : detailsQ.data ? (
                          <>
                            <section className="rounded border border-border p-2">
                              <h4 className="mb-1 font-medium text-text">Summary</h4>
                              <p className="text-text">{detailsQ.data.document.summary || 'No summary yet.'}</p>
                            </section>

                            <section className="rounded border border-border p-2">
                              <h4 className="mb-2 font-medium text-text">Linking</h4>
                              <p className="mb-2 text-text-dim">{linkedCompanyLabel ? `Linked to: ${linkedCompanyLabel}` : 'Not linked'}</p>
                              <select
                                value={selectedCompanyId}
                                onChange={(event) => {
                                  const next = event.target.value;
                                  setSelectedCompanyId(next ? Number(next) : '');
                                }}
                                className="mb-2 w-full rounded border border-border bg-surface px-2 py-1 text-sm"
                                aria-label="Select linked company"
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
                                  detailsQ.data.contacts.map((contact) => (
                                    <label key={contact.contact_id} className="flex items-center gap-2 py-0.5 text-text">
                                      <input
                                        type="checkbox"
                                        checked={selectedContactIds.includes(contact.contact_id)}
                                        onChange={(event) =>
                                          setSelectedContactIds((prev) =>
                                            event.target.checked ? Array.from(new Set([...prev, contact.contact_id])) : prev.filter((id) => id !== contact.contact_id)
                                          )
                                        }
                                        aria-label={`Link ${contact.name}`}
                                      />
                                      <span>{contact.name}</span>
                                    </label>
                                  ))
                                )}
                              </div>
                              {linksDirty ? (
                                <div className="flex items-center justify-between gap-2">
                                  <p className="text-[11px] text-amber-700">Unsaved link changes</p>
                                  <button
                                    type="button"
                                    onClick={() => void onLink()}
                                    className="inline-flex items-center gap-1 rounded bg-accent px-2.5 py-1 text-xs font-medium text-white"
                                  >
                                    <Link2 className="h-3.5 w-3.5" /> Confirm links
                                  </button>
                                </div>
                              ) : (
                                <p className="text-[11px] text-text-dim">Links saved</p>
                              )}
                            </section>

                            <section className="rounded border border-border p-2">
                              <h4 className="mb-2 font-medium text-text">Ask This Document</h4>
                              <div className="mb-2 flex flex-wrap gap-1.5">
                                {suggestedQuestions.map((chip) => (
                                  <button
                                    key={chip}
                                    type="button"
                                    onClick={() => setQuestion(chip)}
                                    className="rounded-full border border-border bg-bg px-2 py-1 text-[11px] text-text-muted hover:bg-surface-hover hover:text-text"
                                  >
                                    {chip}
                                  </button>
                                ))}
                              </div>
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
                                  disabled={askLoading || !question.trim()}
                                  onClick={() => void onAsk()}
                                  className="rounded bg-accent px-2.5 py-1.5 text-xs font-medium text-white disabled:opacity-60"
                                >
                                  {askLoading ? 'Asking...' : 'Ask'}
                                </button>
                              </div>
                              {answer ? (
                                <div className="mt-3 rounded border border-border-subtle bg-bg p-2 text-xs">
                                  <p className="mb-1 font-medium text-text">Most recent answer</p>
                                  <p className="text-text whitespace-pre-wrap">{answer.answer}</p>
                                </div>
                              ) : null}
                            </section>

                            <section className="rounded border border-border p-2">
                              <h4 className="mb-2 font-medium text-text">Activity</h4>
                              {inspectorActivities.length === 0 ? (
                                <p className="text-text-dim">No activity yet.</p>
                              ) : (
                                <ol className="space-y-1.5">
                                  {inspectorActivities.map((activity) => (
                                    <li key={activity.id} className="rounded border border-border-subtle bg-bg px-2 py-1.5">
                                      <p className="text-text">{activity.label}</p>
                                      {activity.detail ? <p className="truncate text-text-dim">{activity.detail}</p> : null}
                                      {activity.ts ? <p className="text-[11px] text-text-dim tabular-nums">{prettyDate(activity.ts)}</p> : null}
                                    </li>
                                  ))}
                                </ol>
                              )}
                            </section>
                          </>
                        ) : (
                          <div className="text-sm text-red-600">Could not load document details.</div>
                        )}
                      </div>
                    </div>
                  </div>
                </SidePanelContainer>
              ) : null}
            </div>
          )}
        </div>
      </WorkspacePageShell>
      {contextMenu ? (
        <div
          ref={contextMenuRef}
          data-doc-context-menu
          className="fixed z-50 min-w-[160px] rounded-md border border-border bg-surface p-1 shadow-lg"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(event) => event.stopPropagation()}
        >
          {contextMenu.row.kind === 'doc' ? (
            <>
              <button
                type="button"
                className="block w-full rounded px-2 py-1 text-left text-xs text-text hover:bg-surface-hover"
                onClick={() => {
                  setContextMenu(null);
                  const source = String(contextMenu.row.doc.source || '').trim();
                  const path = String(contextMenu.row.doc.storage_path || '').trim();
                  const href = /^https?:\/\//i.test(source) ? source : /^https?:\/\//i.test(path) ? path : '';
                  if (href) window.open(href, '_blank', 'noopener,noreferrer');
                }}
              >
                Open
              </button>
              <button
                type="button"
                className="block w-full rounded px-2 py-1 text-left text-xs text-text hover:bg-surface-hover"
                onClick={() => {
                  setContextMenu(null);
                  startRename(contextMenu.row, contextMenu.origin);
                }}
              >
                Rename
              </button>
            </>
          ) : (
              <button
                type="button"
                className="block w-full rounded px-2 py-1 text-left text-xs text-text hover:bg-surface-hover"
                onClick={() => {
                  setContextMenu(null);
                  startRename(contextMenu.row, contextMenu.origin);
                }}
              >
                Rename
            </button>
          )}
        </div>
      ) : null}
      {isPhone && selectedId ? (
        <BottomDrawerContainer onClose={closeInspector} ariaLabel="Document details drawer">
          <div className="max-h-[calc(92vh-16px)] overflow-y-auto">
            <div className="sticky top-0 z-10 border-b border-border bg-surface px-3 py-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="truncate text-sm font-semibold text-text">{inspectorDocument?.filename || 'Document'}</h3>
                  <p className="truncate text-xs text-text-dim">{inspectorSubtitle}</p>
                </div>
                <div className="flex items-center gap-1" ref={inspectorMenuRef}>
                  <button
                    type="button"
                    aria-label="Toggle document actions"
                    onClick={() => setShowInspectorMenu((prev) => !prev)}
                    className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border text-text-muted hover:bg-surface-hover"
                  >
                    <MoreHorizontal className="h-3.5 w-3.5" />
                  </button>
                  {showInspectorMenu ? (
                    <div className="absolute right-3 top-10 w-40 rounded-md border border-border bg-surface p-1 shadow-lg">
                      <button type="button" disabled className="block w-full rounded px-2 py-1 text-left text-xs text-text-dim">Rename (coming soon)</button>
                      <button type="button" disabled className="block w-full rounded px-2 py-1 text-left text-xs text-text-dim">Move (coming soon)</button>
                      <button type="button" disabled className="block w-full rounded px-2 py-1 text-left text-xs text-red-400">Delete (coming soon)</button>
                    </div>
                  ) : null}
                  <button
                    type="button"
                    aria-label="Close document details"
                    onClick={closeInspector}
                    className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border text-text-muted hover:bg-surface-hover"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
              <div className="mt-2 flex items-center gap-1.5">
                <span className={`inline-flex h-5 items-center rounded-full px-2 text-[11px] ${statusBadge(inspectorStatus)}`}>{inspectorStatus || 'unknown'}</span>
                {openHref ? (
                  <a href={openHref} target="_blank" rel="noreferrer" className="inline-flex h-7 items-center rounded-md border border-border px-2.5 text-xs text-text hover:bg-surface-hover">
                    Open
                  </a>
                ) : null}
                {hasRetryAction ? (
                  <button
                    type="button"
                    onClick={() => (inspectorDocument?.id ? void api.retryDocumentProcessing(inspectorDocument.id).then(() => void refreshAll()) : undefined)}
                    className="inline-flex h-7 items-center gap-1 rounded-md border border-border px-2.5 text-xs text-text hover:bg-surface-hover"
                  >
                    <RotateCcw className="h-3.5 w-3.5" /> Re-index
                  </button>
                ) : null}
              </div>
            </div>
            <div className="space-y-3 p-3 text-xs">
              {detailsQ.isLoading ? (
                <LoadingSpinner />
              ) : (
                <>
                  <section className="rounded border border-border p-2">
                    <h4 className="mb-1 font-medium text-text">Summary</h4>
                    <p className="text-text">{detailsQ.data?.document.summary || 'No summary yet.'}</p>
                  </section>
                  <section className="rounded border border-border p-2">
                    <h4 className="mb-2 font-medium text-text">Linking</h4>
                    <p className="mb-2 text-text-dim">{linkedCompanyLabel ? `Linked to: ${linkedCompanyLabel}` : 'Not linked'}</p>
                    <select
                      value={selectedCompanyId}
                      onChange={(event) => {
                        const next = event.target.value;
                        setSelectedCompanyId(next ? Number(next) : '');
                      }}
                      className="mb-2 w-full rounded border border-border bg-surface px-2 py-1 text-sm"
                      aria-label="Select linked company"
                    >
                      <option value="">No linked company</option>
                      {(companiesQ.data || []).map((company) => (
                        <option key={company.id} value={company.id}>
                          {company.company_name}
                        </option>
                      ))}
                    </select>
                    <div className="mb-2 max-h-28 overflow-y-auto rounded border border-border p-2 text-xs">
                      {(detailsQ.data?.contacts || []).length === 0 ? (
                        <div className="text-text-dim">No extracted contacts.</div>
                      ) : (
                        (detailsQ.data?.contacts || []).map((contact) => (
                          <label key={contact.contact_id} className="flex items-center gap-2 py-0.5 text-text">
                            <input
                              type="checkbox"
                              checked={selectedContactIds.includes(contact.contact_id)}
                              onChange={(event) =>
                                setSelectedContactIds((prev) =>
                                  event.target.checked ? Array.from(new Set([...prev, contact.contact_id])) : prev.filter((id) => id !== contact.contact_id)
                                )
                              }
                              aria-label={`Link ${contact.name}`}
                            />
                            <span>{contact.name}</span>
                          </label>
                        ))
                      )}
                    </div>
                    {linksDirty ? (
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-[11px] text-amber-700">Unsaved link changes</p>
                        <button type="button" onClick={() => void onLink()} className="inline-flex items-center gap-1 rounded bg-accent px-2.5 py-1 text-xs font-medium text-white">
                          <Link2 className="h-3.5 w-3.5" /> Confirm links
                        </button>
                      </div>
                    ) : (
                      <p className="text-[11px] text-text-dim">Links saved</p>
                    )}
                  </section>
                  <section className="rounded border border-border p-2">
                    <h4 className="mb-2 font-medium text-text">Ask This Document</h4>
                    <div className="mb-2 flex flex-wrap gap-1.5">
                      {suggestedQuestions.map((chip) => (
                        <button
                          key={chip}
                          type="button"
                          onClick={() => setQuestion(chip)}
                          className="rounded-full border border-border bg-bg px-2 py-1 text-[11px] text-text-muted hover:bg-surface-hover hover:text-text"
                        >
                          {chip}
                        </button>
                      ))}
                    </div>
                    <textarea
                      value={question}
                      onChange={(event) => setQuestion(event.target.value)}
                      rows={3}
                      placeholder="Ask a question about this document"
                      className="w-full resize-y rounded border border-border bg-surface px-2 py-1 text-sm outline-none"
                    />
                    <div className="mt-2 flex items-center gap-2">
                      <button type="button" disabled={askLoading || !question.trim()} onClick={() => void onAsk()} className="rounded bg-accent px-2.5 py-1.5 text-xs font-medium text-white disabled:opacity-60">
                        {askLoading ? 'Asking...' : 'Ask'}
                      </button>
                    </div>
                    {answer ? (
                      <div className="mt-3 rounded border border-border-subtle bg-bg p-2 text-xs">
                        <p className="mb-1 font-medium text-text">Most recent answer</p>
                        <p className="text-text whitespace-pre-wrap">{answer.answer}</p>
                      </div>
                    ) : null}
                  </section>
                  <section className="rounded border border-border p-2">
                    <h4 className="mb-2 font-medium text-text">Activity</h4>
                    {inspectorActivities.length === 0 ? (
                      <p className="text-text-dim">No activity yet.</p>
                    ) : (
                      <ol className="space-y-1.5">
                        {inspectorActivities.map((activity) => (
                          <li key={activity.id} className="rounded border border-border-subtle bg-bg px-2 py-1.5">
                            <p className="text-text">{activity.label}</p>
                            {activity.detail ? <p className="truncate text-text-dim">{activity.detail}</p> : null}
                            {activity.ts ? <p className="text-[11px] text-text-dim tabular-nums">{prettyDate(activity.ts)}</p> : null}
                          </li>
                        ))}
                      </ol>
                    )}
                  </section>
                </>
              )}
            </div>
          </div>
        </BottomDrawerContainer>
      ) : null}
    </div>
  );
}
