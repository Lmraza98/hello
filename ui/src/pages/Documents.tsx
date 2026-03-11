import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type MouseEvent, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getCoreRowModel, type ColumnDef, type RowSelectionState, useReactTable } from '@tanstack/react-table';
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
import { ColumnVisibilityMenu } from '../components/shared/ColumnVisibilityMenu';
import { SidePanelContainer } from '../components/contacts/SidePanelContainer';
import { TableHeaderFilter } from '../components/shared/TableHeaderFilter';
import { BottomDrawerContainer } from '../components/contacts/BottomDrawerContainer';
import { EmailTabs } from '../components/email/EmailTabs';
import { WorkspacePageShell } from '../components/shared/WorkspacePageShell';
import { BaseModal } from '../components/shared/BaseModal';
import {
  FILTERABLE_VIEWPORT_CONTROL_WIDTH,
  SHARED_SELECTION_COLUMN_WIDTH,
  SHARED_TABLE_ROW_HEIGHT_CLASS,
  SharedViewportControlsOverlay,
  SharedTableColGroupWithWidths,
  SharedTableHeader,
  useFittedTableLayout,
  usePersistentColumnSizing,
} from '../components/shared/resizableDataTable';
import { usePersistentColumnPreferences } from '../components/shared/usePersistentColumnPreferences';
import { usePageContext } from '../contexts/PageContextProvider';
import { useNotificationContext } from '../contexts/NotificationContext';
import { useRegisterCapabilities } from '../capabilities/useRegisterCapabilities';
import { getPageCapability } from '../capabilities/catalog';

type DocumentsView = 'all' | 'extracting' | 'chunking' | 'tagging' | 'ready' | 'failed';
type TreeOrder = 'files_first' | 'folders_first';
type ColumnId = 'name' | 'size' | 'type' | 'company' | 'status' | 'updated';
type FolderNode = { path: string; name: string; folders: Map<string, FolderNode>; docs: DocumentRecord[] };
type TreeRow =
  | { kind: 'folder'; key: string; depth: number; path: string; name: string; count: number; latest: string | null; explicit: boolean }
  | { kind: 'doc'; key: string; depth: number; doc: DocumentRecord };
type InspectorActivity = { id: string; label: string; detail?: string; ts?: string };

const DOCUMENT_COLUMNS: Array<{
  id: ColumnId;
  label: string;
  minWidth: number;
  defaultWidth: number;
  maxWidth: number;
  resizable?: boolean;
  align?: 'left' | 'right';
}> = [
  { id: 'name', label: 'Name', minWidth: 280, defaultWidth: 420, maxWidth: 720 },
  { id: 'size', label: 'Size', minWidth: 96, defaultWidth: 108, maxWidth: 140, align: 'right' },
  { id: 'type', label: 'Type', minWidth: 100, defaultWidth: 112, maxWidth: 180 },
  { id: 'company', label: 'Company', minWidth: 140, defaultWidth: 176, maxWidth: 280 },
  { id: 'status', label: 'Status', minWidth: 100, defaultWidth: 120, maxWidth: 180 },
  { id: 'updated', label: 'Updated', minWidth: 140, defaultWidth: 156, maxWidth: 220, align: 'right' },
];

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
  const lastSegment = p[p.length - 1] || '';
  const normalizedFilename = String(doc.filename || '').trim().toLowerCase();
  const normalizedLastSegment = lastSegment.trim().toLowerCase();
  const looksLikeFileSegment = /\.[a-z0-9]{1,10}$/i.test(lastSegment);
  if (normalizedLastSegment === normalizedFilename || looksLikeFileSegment) p.pop();
  return normalizePath(p.join('/'));
}

function docFolderPath(doc: DocumentRecord): string {
  return normalizePath(doc.folder_path || fallbackFolderPath(doc));
}

function buildTree(docs: DocumentRecord[], folders: DocumentFolderRecord[], expanded: Record<string, boolean>, treeOrder: TreeOrder): TreeRow[] {
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
    const folderOrder = new Map(folders.map((folder) => [normalizePath(folder.path), Number(folder.sort_order ?? 0)]));
    const folderList = Array.from(node.folders.values()).sort((a, b) => {
      const byOrder = (folderOrder.get(a.path) ?? 0) - (folderOrder.get(b.path) ?? 0);
      if (byOrder !== 0) return byOrder;
      return a.name.localeCompare(b.name);
    });
    const docList = [...node.docs].sort((a, b) => {
      const byOrder = Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0);
      if (byOrder !== 0) return byOrder;
      return sortByNewest(a.uploaded_at, b.uploaded_at);
    });

    const pushFolders = () => {
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
    };
    const pushDocs = () => {
      for (const doc of docList) {
        rows.push({ kind: 'doc', key: `doc:${doc.id}`, depth, doc });
      }
    };
    if (treeOrder === 'files_first') {
      pushDocs();
      pushFolders();
      return;
    }
    pushFolders();
    pushDocs();
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
  const indentPx = depth * 14 + (kind === 'doc' ? 14 : 0);
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
          className="inline-flex h-5 items-center justify-center border border-transparent pl-2 text-text-dim hover:text-text"
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
  const [treeOrder, setTreeOrder] = useState<TreeOrder>(() => {
    if (typeof window === 'undefined') return 'files_first';
    const stored = window.localStorage.getItem('documents-tree-order');
    return stored === 'folders_first' ? 'folders_first' : 'files_first';
  });
  const [typeFilter, setTypeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [openHeaderFilterId, setOpenHeaderFilterId] = useState<string | null>(null);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showFiltersMenu, setShowFiltersMenu] = useState(false);
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({});
  const [activeFolderPath, setActiveFolderPath] = useState<string>('');
  const [inlineFolderParentPath, setInlineFolderParentPath] = useState<string | null>(null);
  const [inlineFolderName, setInlineFolderName] = useState('');
  const [draggingItem, setDraggingItem] = useState<{ kind: 'folder'; path: string } | { kind: 'doc'; id: string } | null>(null);
  const [dropTargetFolderPath, setDropTargetFolderPath] = useState<string | null>(null);
  const [dropTargetRowKey, setDropTargetRowKey] = useState<string | null>(null);
  const [dropTargetMode, setDropTargetMode] = useState<'reorder' | 'move-folder' | null>(null);
  const [dropTargetPosition, setDropTargetPosition] = useState<'before' | 'after' | null>(null);
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
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; filename: string } | null>(null);
  const [deleteConfirmValue, setDeleteConfirmValue] = useState('');
  const [deleteSaving, setDeleteSaving] = useState(false);
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

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem('documents-tree-order', treeOrder);
  }, [treeOrder]);

  const rows = useMemo(() => buildTree(docs, foldersQ.data?.folders || [], expandedFolders, treeOrder), [docs, expandedFolders, foldersQ.data?.folders, treeOrder]);
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

  const reorderDocumentsInFolder = async (folderPath: string, draggedId: string, targetId: string, position: 'before' | 'after') => {
    const normalizedFolderPath = normalizePath(folderPath);
    const siblingIds = rows
      .filter((row): row is Extract<TreeRow, { kind: 'doc' }> => row.kind === 'doc' && docFolderPath(row.doc) === normalizedFolderPath)
      .map((row) => row.doc.id);
    const fromIndex = siblingIds.indexOf(draggedId);
    const toIndex = siblingIds.indexOf(targetId);
    if (fromIndex < 0 || toIndex < 0) return false;
    let insertIndex = toIndex + (position === 'after' ? 1 : 0);
    if (fromIndex < insertIndex) insertIndex -= 1;
    if (fromIndex === insertIndex) return false;
    const next = [...siblingIds];
    const [item] = next.splice(fromIndex, 1);
    next.splice(insertIndex, 0, item);
    setErrorMessage(null);
    try {
      await api.reorderDocuments({ folder_path: normalizedFolderPath, ordered_ids: next });
      queryClient.setQueryData<{ count: number; documents: DocumentRecord[] } | undefined>(['documents', baseListParams], (current) => {
        if (!current) return current;
        const orderMap = new Map(next.map((id, index) => [id, index]));
        return {
          ...current,
          documents: current.documents.map((doc) =>
            docFolderPath(doc) === normalizedFolderPath && orderMap.has(doc.id)
              ? { ...doc, sort_order: orderMap.get(doc.id) ?? doc.sort_order }
              : doc
          ),
        };
      });
      await docsQ.refetch();
      return true;
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to reorder files');
      return false;
    }
  };

  const reorderFoldersInParent = async (parentFolderPath: string, draggedPath: string, targetPath: string, position: 'before' | 'after') => {
    const normalizedParentPath = normalizePath(parentFolderPath);
    const siblingPaths = rows
      .filter((row): row is Extract<TreeRow, { kind: 'folder' }> => row.kind === 'folder' && normalizePath(parentPath(row.path)) === normalizedParentPath)
      .map((row) => normalizePath(row.path));
    const fromIndex = siblingPaths.indexOf(normalizePath(draggedPath));
    const toIndex = siblingPaths.indexOf(normalizePath(targetPath));
    if (fromIndex < 0 || toIndex < 0) return false;
    let insertIndex = toIndex + (position === 'after' ? 1 : 0);
    if (fromIndex < insertIndex) insertIndex -= 1;
    if (fromIndex === insertIndex) return false;
    const next = [...siblingPaths];
    const [item] = next.splice(fromIndex, 1);
    next.splice(insertIndex, 0, item);
    setErrorMessage(null);
    try {
      await api.reorderDocumentFolders({ parent_path: normalizedParentPath, ordered_paths: next });
      queryClient.setQueryData<{ count: number; folders: DocumentFolderRecord[] } | undefined>(['document-folders'], (current) => {
        if (!current) return current;
        const orderMap = new Map(next.map((path, index) => [normalizePath(path), index]));
        return {
          ...current,
          folders: current.folders.map((folder) => {
            const normalizedPath = normalizePath(folder.path);
            return orderMap.has(normalizedPath)
              ? { ...folder, sort_order: orderMap.get(normalizedPath) ?? folder.sort_order }
              : folder;
          }),
        };
      });
      await foldersQ.refetch();
      return true;
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to reorder folders');
      return false;
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
    setDropTargetRowKey(null);
    setDropTargetMode(null);
    setDropTargetPosition(null);
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
    setDropTargetRowKey(null);
    setDropTargetMode(null);
    setDropTargetPosition(null);
    setDraggingItem(null);
  };

  const handleDropOnRow = async (targetRow: TreeRow, position: 'before' | 'after' = 'before') => {
    if (!draggingItem) return;
    if (draggingItem.kind === 'doc' && targetRow.kind === 'doc') {
      const draggedDoc = docs.find((doc) => doc.id === draggingItem.id);
      if (draggedDoc && docFolderPath(draggedDoc) === docFolderPath(targetRow.doc)) {
        const reordered = await reorderDocumentsInFolder(docFolderPath(targetRow.doc), draggingItem.id, targetRow.doc.id, position);
        if (reordered) {
          setDropTargetFolderPath(null);
          setDropTargetRowKey(null);
          setDropTargetMode(null);
          setDropTargetPosition(null);
          setDraggingItem(null);
          return;
        }
      }
    }
    if (draggingItem.kind === 'folder' && targetRow.kind === 'folder') {
      const draggedParent = parentPath(draggingItem.path);
      const targetParent = parentPath(targetRow.path);
      if (normalizePath(draggedParent) === normalizePath(targetParent)) {
        const reordered = await reorderFoldersInParent(targetParent, draggingItem.path, targetRow.path, position);
        if (reordered) {
          setDropTargetFolderPath(null);
          setDropTargetRowKey(null);
          setDropTargetMode(null);
          setDropTargetPosition(null);
          setDraggingItem(null);
          return;
        }
      }
    }
    if (targetRow.kind === 'folder') {
      await handleDropOnFolder(targetRow.path);
    }
  };

  const getDropIntentForRow = useCallback((targetRow: TreeRow, clientY: number, rowElement: HTMLElement): { rowKey: string | null; mode: 'reorder' | 'move-folder' | null; folderPath: string | null; position: 'before' | 'after' | null } => {
    if (!draggingItem) {
      return { rowKey: null, mode: null, folderPath: null, position: null };
    }
    const rect = rowElement.getBoundingClientRect();
    const position: 'before' | 'after' = clientY < rect.top + rect.height / 2 ? 'before' : 'after';
    if (draggingItem.kind === 'doc' && targetRow.kind === 'doc') {
      const draggedDoc = docs.find((doc) => doc.id === draggingItem.id);
      if (draggedDoc && docFolderPath(draggedDoc) === docFolderPath(targetRow.doc)) {
        return { rowKey: targetRow.key, mode: 'reorder', folderPath: null, position };
      }
    }
    if (draggingItem.kind === 'folder' && targetRow.kind === 'folder') {
      const draggedParent = parentPath(draggingItem.path);
      const targetParent = parentPath(targetRow.path);
      if (normalizePath(draggedParent) === normalizePath(targetParent)) {
        return { rowKey: targetRow.key, mode: 'reorder', folderPath: null, position };
      }
    }
    if (targetRow.kind === 'folder') {
      return { rowKey: targetRow.key, mode: 'move-folder', folderPath: targetRow.path, position: null };
    }
    return { rowKey: null, mode: null, folderPath: null, position: null };
  }, [docs, draggingItem]);

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

  const requestDeleteDocument = useCallback((documentId: string, filename: string) => {
    setContextMenu(null);
    setShowInspectorMenu(false);
    setDeleteConfirmValue('');
    setDeleteTarget({ id: documentId, filename });
  }, []);

  const closeDeleteDialog = useCallback(() => {
    if (deleteSaving) return;
    setDeleteTarget(null);
    setDeleteConfirmValue('');
  }, [deleteSaving]);

  const confirmDeleteDocument = useCallback(async () => {
    if (!deleteTarget || deleteSaving || deleteConfirmValue.trim() !== 'confirm delete') return;
    setDeleteSaving(true);
    setErrorMessage(null);
    try {
      await api.deleteDocument(deleteTarget.id);
      setRowSelection((prev) => {
        const next = { ...prev };
        delete next[`doc:${deleteTarget.id}`];
        return next;
      });
      if (selectedId === deleteTarget.id) {
        setSelectedId(null);
        setAnswer(null);
      }
      setDeleteTarget(null);
      setDeleteConfirmValue('');
      await docsQ.refetch();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to delete document');
    } finally {
      setDeleteSaving(false);
    }
  }, [deleteConfirmValue, deleteSaving, deleteTarget, docsQ, selectedId]);

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

  const toggleFolderContentsSelection = useCallback((folderPath: string) => {
    const normalizedFolderPath = normalizePath(folderPath);
    const fileRowIds = rows
      .filter((row) => {
        if (row.kind !== 'doc') return false;
        const parent = docFolderPath(row.doc);
        return parent === normalizedFolderPath;
      })
      .map((row) => row.key);

    setRowSelection((prev) => {
      const allSelected = fileRowIds.length > 0 && fileRowIds.every((rowId) => Boolean(prev[rowId]));
      const next = { ...prev };
      delete next[`folder:${normalizedFolderPath}`];
      fileRowIds.forEach((rowId) => {
        if (allSelected) delete next[rowId];
        else next[rowId] = true;
      });
      return next;
    });
  }, [rows]);

  const documentColumns = useMemo<ColumnDef<TreeRow>[]>(
    () => [
      {
        id: 'select',
        header: ({ table }) => (
          <button
            type="button"
            aria-label="Select all visible documents"
            aria-pressed={table.getIsAllRowsSelected()}
            onClick={() => table.toggleAllRowsSelected(!table.getIsAllRowsSelected())}
            className="block h-full w-full"
            data-row-control
          />
        ),
        cell: ({ row }) => (
          <button
            type="button"
            aria-label={`Select ${row.original.kind === 'folder' ? 'folder' : 'document'} ${row.original.kind === 'folder' ? row.original.name : row.original.doc.filename}`}
            aria-pressed={row.getIsSelected()}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              if (row.original.kind === 'folder') {
                toggleFolderContentsSelection(row.original.path);
                return;
              }
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
        cell: ({ row: tableRow }) => {
          const row = tableRow.original;
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
              <button
                type="button"
                data-row-control
                aria-label={`Delete file ${row.doc.filename}`}
                onClick={(e) => {
                  e.stopPropagation();
                  requestDeleteDocument(row.doc.id, row.doc.filename);
                }}
                className="inline-flex h-6 w-6 items-center justify-center rounded border border-red-200 text-red-600 hover:bg-red-50"
                title="Delete file"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          );
          return renaming &&
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
          );
        },
        size: 420,
        minSize: 280,
        maxSize: Number.MAX_SAFE_INTEGER,
        meta: {
          label: 'Name',
          minWidth: 280,
          defaultWidth: 420,
          maxWidth: 720,
          resizable: true,
          align: 'left',
          measureValue: (row: TreeRow) => (row.kind === 'folder' ? row.name : row.doc.filename),
        },
      },
      {
        id: 'size',
        header: 'Size',
        cell: ({ row: tableRow }) => {
          const row = tableRow.original;
          return <span className="block truncate text-[12px] tabular-nums text-text-dim">{row.kind === 'folder' ? '-' : formatBytes(row.doc.file_size_bytes) || '-'}</span>;
        },
        size: 108,
        minSize: 96,
        maxSize: Number.MAX_SAFE_INTEGER,
        meta: {
          label: 'Size',
          minWidth: 96,
          defaultWidth: 108,
          maxWidth: 140,
          resizable: true,
          align: 'right',
          measureValue: (row: TreeRow) => (row.kind === 'folder' ? '-' : formatBytes(row.doc.file_size_bytes) || '-'),
        },
      },
      {
        id: 'type',
        header: () => (
          <div className="flex items-center gap-1">
            <span>Type</span>
            <TableHeaderFilter
              open={openHeaderFilterId === 'type'}
              active={Boolean(typeFilter)}
              label="Type"
              onToggle={() => setOpenHeaderFilterId((value) => (value === 'type' ? null : 'type'))}
            >
              <select
                value={typeFilter}
                onChange={(event) => setTypeFilter(event.target.value)}
                className="h-7 w-full rounded-none border border-border bg-surface px-2 text-[11px] text-text focus:border-accent focus:outline-none"
              >
                <option value="">All</option>
                {typeOptions.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </TableHeaderFilter>
          </div>
        ),
        cell: ({ row: tableRow }) => {
          const row = tableRow.original;
          return <span className="block truncate text-[12px] text-text-dim">{row.kind === 'folder' ? 'Folder' : row.doc.document_type || '-'}</span>;
        },
        size: 112,
        minSize: 100,
        maxSize: Number.MAX_SAFE_INTEGER,
        meta: {
          label: 'Type',
          minWidth: 100,
          defaultWidth: 112,
          maxWidth: 180,
          resizable: true,
          align: 'left',
          measureValue: (row: TreeRow) => (row.kind === 'folder' ? 'Folder' : row.doc.document_type || '-'),
        },
      },
      {
        id: 'company',
        header: 'Company',
        cell: ({ row: tableRow }) => {
          const row = tableRow.original;
          return <span className="block truncate text-[12px] text-text-dim">{row.kind === 'folder' ? '-' : row.doc.linked_company_name || '-'}</span>;
        },
        size: 176,
        minSize: 140,
        maxSize: Number.MAX_SAFE_INTEGER,
        meta: {
          label: 'Company',
          minWidth: 140,
          defaultWidth: 176,
          maxWidth: 280,
          resizable: true,
          align: 'left',
          measureValue: (row: TreeRow) => (row.kind === 'folder' ? '-' : row.doc.linked_company_name || '-'),
        },
      },
      {
        id: 'status',
        header: () => (
          <div className="flex items-center gap-1">
            <span>Status</span>
            <TableHeaderFilter
              open={openHeaderFilterId === 'status'}
              active={Boolean(statusFilter)}
              label="Status"
              onToggle={() => setOpenHeaderFilterId((value) => (value === 'status' ? null : 'status'))}
            >
              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value)}
                className="h-7 w-full rounded-none border border-border bg-surface px-2 text-[11px] text-text focus:border-accent focus:outline-none"
              >
                <option value="">All</option>
                {statusOptions.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>
            </TableHeaderFilter>
          </div>
        ),
        cell: ({ row: tableRow }) => {
          const row = tableRow.original;
          return row.kind === 'folder' ? (
            <span className="text-[11px] text-text-dim">-</span>
          ) : (
            <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] ${statusBadge(row.doc.status)}`}>{row.doc.status}</span>
          );
        },
        size: 120,
        minSize: 100,
        maxSize: Number.MAX_SAFE_INTEGER,
        meta: {
          label: 'Status',
          minWidth: 100,
          defaultWidth: 120,
          maxWidth: 180,
          resizable: true,
          align: 'left',
          measureValue: (row: TreeRow) => (row.kind === 'folder' ? '-' : row.doc.status),
        },
      },
      {
        id: 'updated',
        header: 'Updated',
        cell: ({ row: tableRow }) => {
          const row = tableRow.original;
          return <span className="block truncate text-[12px] tabular-nums text-text-dim">{row.kind === 'folder' ? prettyDate(row.latest) : prettyDate(row.doc.uploaded_at)}</span>;
        },
        size: 156,
        minSize: 140,
        maxSize: Number.MAX_SAFE_INTEGER,
        meta: {
          label: 'Updated',
          minWidth: 140,
          defaultWidth: 156,
          maxWidth: 220,
          resizable: true,
          align: 'right',
          measureValue: (row: TreeRow) => (row.kind === 'folder' ? prettyDate(row.latest) : prettyDate(row.doc.uploaded_at)),
        },
      },
    ],
    [
      cancelRename,
      confirmRename,
      deleteEmptyFolder,
      expandedFolders,
      moveDocument,
      moveFolder,
      renameError,
      renameSaving,
      renameValue,
      renaming,
      isInteractiveTarget,
      setActiveFolderPath,
      startRename,
      toggleFolderContentsSelection,
      validateRename,
    ],
  );

  const { columnSizing, setColumnSizing, autoFitColumn } = usePersistentColumnSizing({
    columns: documentColumns,
    rows,
    storageKey: 'documents-table',
  });
  const managedColumnIds = useMemo(() => DOCUMENT_COLUMNS.map((column) => column.id), []);
  const { columnOrder: managedColumnOrder, setColumnOrder: setManagedColumnOrder, columnVisibility, setColumnVisibility } = usePersistentColumnPreferences({
    storageKey: 'documents-table',
    columnIds: managedColumnIds,
    initialVisibility: { name: true, size: true, type: true, company: true, status: true, updated: true },
  });

  const moveManagedColumn = useCallback((columnId: string, delta: -1 | 1) => {
    setManagedColumnOrder((prev) => {
      const index = prev.indexOf(columnId);
      const nextIndex = index + delta;
      if (index < 0 || nextIndex < 0 || nextIndex >= prev.length) return prev;
      const next = [...prev];
      const [item] = next.splice(index, 1);
      next.splice(nextIndex, 0, item);
      return next;
    });
  }, [setManagedColumnOrder]);

  const documentsTable = useReactTable({
    data: rows,
    columns: documentColumns,
    state: {
      columnVisibility,
      columnSizing,
      rowSelection,
      columnOrder: ['select', ...managedColumnOrder],
    },
    onRowSelectionChange: setRowSelection,
    onColumnVisibilityChange: setColumnVisibility,
    onColumnOrderChange: setManagedColumnOrder,
    onColumnSizingChange: setColumnSizing,
    getRowId: (row) => row.key,
    getCoreRowModel: getCoreRowModel(),
    columnResizeMode: 'onChange',
  });

  const {
    containerRef: documentsTableRef,
    columnWidths: documentsColumnWidths,
    visibleColumnIds: documentsVisibleColumnIds,
    tableStyle: documentRowStyle,
    fillWidth: documentsFillWidth,
    canShiftLeft: canShiftDocumentsLeft,
    canShiftRight: canShiftDocumentsRight,
    shiftLeft: shiftDocumentsLeft,
    shiftRight: shiftDocumentsRight,
  } = useFittedTableLayout(documentsTable, { controlWidth: FILTERABLE_VIEWPORT_CONTROL_WIDTH });
  const visibleColumns = useMemo(
    () => documentsTable.getVisibleLeafColumns().filter((column) => documentsVisibleColumnIds.includes(column.id)),
    [documentsTable, documentsVisibleColumnIds],
  );
  const rowGridStyle = useMemo(
    () => ({
      gridTemplateColumns: [
        ...visibleColumns.map((column) => `${documentsColumnWidths[column.id] ?? column.getSize()}px`),
        ...(documentsFillWidth > 0 ? [`${documentsFillWidth}px`] : []),
      ].join(' '),
    }),
    [documentsColumnWidths, documentsFillWidth, visibleColumns],
  );

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
    <div className="flex min-w-0 flex-wrap items-center">
      <div className="min-w-[240px] flex-1">
        <PageSearchInput value={query} onChange={handleSearchChange} placeholder="Search filename, summary, or content" />
      </div>
      <HeaderActionButton onClick={() => fileInputRef.current?.click()} variant="primary" icon={<Upload className="h-4 w-4" />}>
        Upload
      </HeaderActionButton>
      <HeaderActionButton onClick={createFolder} variant="secondary" icon={<Plus className="h-4 w-4" />}>
        New Folder
      </HeaderActionButton>
      <button
        type="button"
        onClick={() => setTreeOrder((value) => (value === 'files_first' ? 'folders_first' : 'files_first'))}
        className="inline-flex h-8 items-center border border-border bg-surface px-3 text-xs text-text-muted hover:bg-surface-hover"
        aria-label={`Switch document tree order, currently ${treeOrder === 'files_first' ? 'files first' : 'folders first'}`}
      >
        {treeOrder === 'files_first' ? 'Files First' : 'Folders First'}
      </button>
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
        contentClassName=""
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
        <div className="min-h-0 flex-1 overflow-hidden">
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
              <div ref={documentsTableRef} className="flex min-w-0 min-h-0 flex-1 flex-col">
                <div className="relative shrink-0">
                  <SharedViewportControlsOverlay
                    canShiftLeft={canShiftDocumentsLeft}
                    canShiftRight={canShiftDocumentsRight}
                    onShiftLeft={shiftDocumentsLeft}
                    onShiftRight={shiftDocumentsRight}
                    leadingControl={
                      <div className="relative" ref={filterMenuRef}>
                        <button
                          type="button"
                          onClick={() => setShowFiltersMenu((v) => !v)}
                          className="inline-flex h-5 w-5 items-center justify-center rounded-none text-text-muted transition-colors hover:bg-surface-hover hover:text-text"
                          title="Visible columns"
                          aria-label="Open visible columns menu"
                        >
                          <SlidersHorizontal className="h-3.5 w-3.5" />
                        </button>
                        {showFiltersMenu ? (
                          <div className="absolute right-0 top-7 z-20 w-[260px] rounded-none border border-border bg-surface p-3 shadow-lg">
                            <ColumnVisibilityMenu
                              items={managedColumnOrder.map((columnId, index) => {
                                const column = DOCUMENT_COLUMNS.find((item) => item.id === columnId);
                                return {
                                  id: columnId,
                                  label: column?.label ?? columnId,
                                  visible: documentsTable.getColumn(columnId)?.getIsVisible() ?? true,
                                  canHide: columnId !== 'name',
                                  canMoveUp: index > 0,
                                  canMoveDown: index < managedColumnOrder.length - 1,
                                };
                              })}
                              onToggle={(columnId, visible) => {
                                if (columnId === 'name') return;
                                documentsTable.getColumn(columnId)?.toggleVisibility(visible);
                              }}
                              onMoveUp={(columnId) => moveManagedColumn(columnId, -1)}
                              onMoveDown={(columnId) => moveManagedColumn(columnId, 1)}
                            />
                          </div>
                        ) : null}
                      </div>
                    }
                  />
                  <table className="w-full border-collapse" style={documentRowStyle}>
                    <SharedTableColGroupWithWidths table={documentsTable} columnWidths={documentsColumnWidths} visibleColumnIds={documentsVisibleColumnIds} fillerWidth={documentsFillWidth} controlWidth={FILTERABLE_VIEWPORT_CONTROL_WIDTH} />
                    <SharedTableHeader
                      table={documentsTable}
                      onAutoFitColumn={autoFitColumn}
                      visibleColumnIds={documentsVisibleColumnIds}
                      columnWidths={documentsColumnWidths}
                      fillerWidth={documentsFillWidth}
                      controlWidth={FILTERABLE_VIEWPORT_CONTROL_WIDTH}
                    />
                  </table>
                </div>
                <div
                  className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden"
                  onDragOver={(e) => {
                    if (!draggingItem) return;
                    if (e.target !== e.currentTarget) return;
                    e.preventDefault();
                    setDropTargetFolderPath(null);
                    setDropTargetRowKey(null);
                    setDropTargetMode(null);
                    setDropTargetPosition(null);
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
                    const tableRow = documentsTable.getRow(row.key);
                    const isDropTarget = row.kind === 'folder' && dropTargetMode === 'move-folder' && dropTargetFolderPath === row.path;
                    const isReorderTarget = dropTargetMode === 'reorder' && dropTargetRowKey === row.key;
                    return (
                      <Fragment key={`row-frag-${row.key}`}>
                        {inlineFolderParentPath === '' && row === rows[0] ? (
                          <div className="grid border-b border-border-subtle bg-accent/5" style={rowGridStyle}>
                            {visibleColumns.map((column, index) => (
                              <div
                                key={`inline-root-${column.id}`}
                                className={`min-w-0 px-3 py-2 text-[12px] text-text-dim ${index === visibleColumns.length - 1 ? '' : 'border-r border-border-subtle/80'}`}
                              >
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
                                ) : column.id === 'select' ? null : (
                                  '-'
                                )}
                              </div>
                            ))}
                            {documentsFillWidth > 0 ? <div aria-hidden="true" /> : null}
                          </div>
                        ) : null}
                        <div
                          draggable
                          onDragStart={(e) => {
                            setDraggingItem(row.kind === 'folder' ? { kind: 'folder', path: row.path } : { kind: 'doc', id: row.doc.id });
                            setDropTargetFolderPath(null);
                            setDropTargetRowKey(null);
                            setDropTargetMode(null);
                            setDropTargetPosition(null);
                            e.dataTransfer.effectAllowed = 'move';
                          }}
                          onDragEnd={() => {
                            setDraggingItem(null);
                            setDropTargetFolderPath(null);
                            setDropTargetRowKey(null);
                            setDropTargetMode(null);
                            setDropTargetPosition(null);
                          }}
                          onDragOver={(e) => {
                            if (!draggingItem) return;
                            e.preventDefault();
                            e.stopPropagation();
                            const intent = getDropIntentForRow(row, e.clientY, e.currentTarget);
                            setDropTargetRowKey(intent.rowKey);
                            setDropTargetMode(intent.mode);
                            setDropTargetFolderPath(intent.folderPath);
                            setDropTargetPosition(intent.position);
                          }}
                          onDrop={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            const intent = getDropIntentForRow(row, e.clientY, e.currentTarget);
                            void handleDropOnRow(row, intent.mode === 'reorder' ? (intent.position ?? 'before') : 'before');
                          }}
                          className={`group relative grid ${SHARED_TABLE_ROW_HEIGHT_CLASS} items-center border-b border-border-subtle ${isDoc ? `${selected ? 'bg-accent/10' : tableRow.getIsSelected() ? 'bg-accent/8' : 'hover:bg-surface-hover/60'} cursor-pointer` : tableRow.getIsSelected() ? 'bg-accent/8' : 'bg-surface-hover/20'} ${isDropTarget ? 'ring-1 ring-accent' : ''} ${isReorderTarget ? 'bg-accent/6' : ''}`}
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
                          {isReorderTarget ? (
                            <span
                              aria-hidden="true"
                              className={`pointer-events-none absolute inset-x-0 h-0.5 bg-accent ${dropTargetPosition === 'after' ? 'bottom-0' : 'top-0'}`}
                            />
                          ) : null}
                          {visibleColumns.map((column, index) => {
                            const hasDivider = index !== visibleColumns.length - 1;
                            const cellClassName = `min-w-0 overflow-hidden px-3 ${column.id === 'select' ? 'py-0' : 'py-1.5'} ${hasDivider ? 'border-r border-border-subtle/80' : ''}`;
                            if (column.id === 'select') {
                              return (
                                <div
                                  key={`${row.key}-select`}
                                  className={`${cellClassName} relative`}
                                  onClick={(event) => {
                                    event.preventDefault();
                                    event.stopPropagation();
                                    if (row.kind === 'folder') {
                                      toggleFolderContentsSelection(row.path);
                                      return;
                                    }
                                    tableRow.toggleSelected();
                                  }}
                                  onMouseDown={(event) => {
                                    event.preventDefault();
                                    event.stopPropagation();
                                  }}
                                  data-row-control
                                >
                                  <button
                                    type="button"
                                    aria-label={`Select ${row.kind === 'folder' ? 'folder' : 'document'} ${row.kind === 'folder' ? row.name : row.doc.filename}`}
                                    aria-pressed={tableRow.getIsSelected()}
                                    onClick={(event) => {
                                      event.preventDefault();
                                      event.stopPropagation();
                                      if (row.kind === 'folder') {
                                        toggleFolderContentsSelection(row.path);
                                        return;
                                      }
                                      tableRow.toggleSelected();
                                    }}
                                    className="block h-full w-full"
                                    data-row-control
                                  />
                                  {hasDivider ? <span aria-hidden="true" className="absolute inset-y-0 right-0 w-px bg-border-subtle/80" /> : null}
                                </div>
                              );
                            }
                            if (column.id === 'name') {
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
                                  <button
                                    type="button"
                                    data-row-control
                                    aria-label={`Delete file ${row.doc.filename}`}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      requestDeleteDocument(row.doc.id, row.doc.filename);
                                    }}
                                    className="inline-flex h-6 w-6 items-center justify-center rounded border border-red-200 text-red-600 hover:bg-red-50"
                                    title="Delete file"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
                                </div>
                              );
                              return (
                                <div key={`${row.key}-name`} className={`min-w-0 overflow-hidden py-1.5 ${index === visibleColumns.length - 1 ? '' : 'border-r border-border-subtle/80'} border-l border-border-subtle/80`}>
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
                                <div key={`${row.key}-type`} className={`${cellClassName} text-[12px] text-text-dim whitespace-nowrap`}>
                                  {row.kind === 'folder' ? 'Folder' : row.doc.document_type || '-'}
                                </div>
                              );
                            }
                            if (column.id === 'size') {
                              return (
                                <div key={`${row.key}-size`} className={`${cellClassName} text-right text-[12px] tabular-nums text-text-dim whitespace-nowrap`}>
                                  {row.kind === 'folder' ? '-' : formatBytes(row.doc.file_size_bytes) || '-'}
                                </div>
                              );
                            }
                            if (column.id === 'company') {
                              return (
                                <div key={`${row.key}-company`} className={`${cellClassName} text-[12px] text-text-dim truncate`}>
                                  {row.kind === 'folder' ? '-' : row.doc.linked_company_name || '-'}
                                </div>
                              );
                            }
                            if (column.id === 'status') {
                              return (
                                <div key={`${row.key}-status`} className={cellClassName}>
                                  {row.kind === 'folder' ? <span className="text-[11px] text-text-dim">-</span> : <span className={`rounded px-2 py-0.5 text-[11px] ${statusBadge(row.doc.status)}`}>{row.doc.status}</span>}
                                </div>
                              );
                            }
                            return (
                              <div key={`${row.key}-updated`} className={`${cellClassName} text-right text-[12px] tabular-nums text-text-dim whitespace-nowrap`}>
                                {row.kind === 'folder' ? prettyDate(row.latest) : prettyDate(row.doc.uploaded_at)}
                              </div>
                            );
                          })}
                          {documentsFillWidth > 0 ? <div aria-hidden="true" /> : null}
                        </div>
                        {row.kind === 'folder' && inlineFolderParentPath === row.path ? (
                          <div className="grid border-b border-border-subtle bg-accent/5" style={rowGridStyle}>
                            {visibleColumns.map((column, index) => (
                              <div
                                key={`inline-child-${row.path}-${column.id}`}
                                className={`min-w-0 px-3 py-2 text-[12px] text-text-dim ${index === visibleColumns.length - 1 ? '' : 'border-r border-border-subtle/80'}`}
                              >
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
                                ) : column.id === 'select' ? null : (
                                  '-'
                                )}
                              </div>
                            ))}
                            {documentsFillWidth > 0 ? <div aria-hidden="true" /> : null}
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
              <button
                type="button"
                className="block w-full rounded px-2 py-1 text-left text-xs text-red-600 hover:bg-red-50"
                onClick={() => {
                  requestDeleteDocument(contextMenu.row.doc.id, contextMenu.row.doc.filename);
                }}
              >
                Delete
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
      {deleteTarget ? (
        <BaseModal
          title="Delete Document"
          onClose={closeDeleteDialog}
          maxWidth="max-w-md"
          footer={
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={closeDeleteDialog}
                disabled={deleteSaving}
                className="inline-flex h-8 items-center border border-border bg-surface px-3 text-xs text-text-muted hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void confirmDeleteDocument()}
                disabled={deleteSaving || deleteConfirmValue.trim() !== 'confirm delete'}
                className="inline-flex h-8 items-center border border-red-600 bg-red-600 px-3 text-xs text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {deleteSaving ? 'Deleting...' : 'Delete Document'}
              </button>
            </div>
          }
        >
          <div className="space-y-3 text-sm text-text">
            <p>
              This will permanently delete <span className="font-medium">{deleteTarget.filename}</span>.
            </p>
            <p className="text-text-dim">Type <span className="font-medium text-text">confirm delete</span> to continue.</p>
            <input
              autoFocus
              value={deleteConfirmValue}
              onChange={(event) => setDeleteConfirmValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  void confirmDeleteDocument();
                }
              }}
              className="h-9 w-full border border-border bg-surface px-3 text-sm text-text focus:border-accent focus:outline-none"
              placeholder="confirm delete"
            />
          </div>
        </BaseModal>
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
                      <button
                        type="button"
                        className="block w-full rounded px-2 py-1 text-left text-xs text-red-600 hover:bg-red-50"
                        onClick={() => {
                          if (!inspectorDocument?.id) return;
                          requestDeleteDocument(inspectorDocument.id, inspectorDocument.filename || 'Document');
                        }}
                      >
                        Delete
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
