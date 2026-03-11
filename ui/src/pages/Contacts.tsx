import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createPortal } from 'react-dom';
import { usePageContext } from '../contexts/PageContextProvider';
import { normalizeQueryFilterParam } from '../utils/filterNormalization';
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  flexRender,
  type SortingState,
  type Updater,
} from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import { api } from '../api';
import type { Contact } from '../api';
import { useIsMobile } from '../hooks/useIsMobile';
import { useContactDetailsRouteState } from '../hooks/useContactDetailsRouteState';
import { useNotificationContext } from '../contexts/NotificationContext';
import { useContacts } from '../hooks/useContacts';
import { AddContactPanelContent } from '../components/contacts/AddContactPanelContent';
import { ContactCard } from '../components/contacts/ContactCard';
import { ContactDetailsContent } from '../components/contacts/ContactDetailsContent';
import { BottomDrawerContainer } from '../components/contacts/BottomDrawerContainer';
import { ResizableSidePanel } from '../components/contacts/ResizableSidePanel';
import { HeaderActionButton } from '../components/shared/HeaderActionButton';
import { PageSearchInput } from '../components/shared/PageSearchInput';
import { EmptyState } from '../components/shared/EmptyState';
import { LoadingSpinner } from '../components/shared/LoadingSpinner';
import { ConfirmDialog } from '../components/shared/ConfirmDialog';
import { ColumnVisibilityMenu } from '../components/shared/ColumnVisibilityMenu';
import { CampaignEnrollmentModal } from '../components/contacts/CampaignEnrollmentModal';
import { createContactColumns } from '../components/contacts/tableColumns';
import { EmailTabs } from '../components/email/EmailTabs';
import { WorkspacePageShell } from '../components/shared/WorkspacePageShell';
import { getContactSourceLabel } from '../components/contacts/sourceLabel';
import {
  FILTERABLE_VIEWPORT_CONTROL_WIDTH,
  SHARED_TABLE_ROW_HEIGHT_CLASS,
  SHARED_TABLE_ROW_HEIGHT_PX,
  SharedTableColGroupWithWidths,
  SharedTableHeader,
  filterCellsByIds,
  sharedCellClassName,
  useFittedTableLayout,
  usePersistentColumnSizing,
} from '../components/shared/resizableDataTable';
import { usePersistentColumnPreferences } from '../components/shared/usePersistentColumnPreferences';
import { Users, Download, Loader2, MoreHorizontal, Phone, Plus, RotateCcw, Send, SlidersHorizontal, Target, Trash2, Upload, UserPlus } from 'lucide-react';
import { useRegisterCapabilities } from '../capabilities/useRegisterCapabilities';
import { getPageCapability } from '../capabilities/catalog';

/* ── Constants ─────────────────────────── */

const ROW_HEIGHT = SHARED_TABLE_ROW_HEIGHT_PX;
const MOBILE_ROW_HEIGHT = 72;
const CONTACTS_VIEWPORT_CONTROL_WIDTH = FILTERABLE_VIEWPORT_CONTROL_WIDTH + 20;
type ContactsView = 'all' | 'sources' | 'pipeline';

function parseContactsView(value: string | null): ContactsView {
  if (value === 'sources' || value === 'pipeline' || value === 'all') return value;
  return 'all';
}

function sortContactsByRecency(data: Contact[]) {
  return [...data].sort((a, b) => {
    const ta = a.scraped_at ? Date.parse(a.scraped_at) : Number.NaN;
    const tb = b.scraped_at ? Date.parse(b.scraped_at) : Number.NaN;
    if (Number.isFinite(ta) && Number.isFinite(tb)) return tb - ta;
    if (Number.isFinite(tb)) return 1;
    if (Number.isFinite(ta)) return -1;
    return b.id - a.id;
  });
}

function ContactsHeaderActionsMenu({
  onNewContact,
}: {
  onNewContact: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    if (!open) return;
    const updatePosition = () => {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (!rect) return;
      setMenuPosition({
        top: rect.top + rect.height / 2,
        left: rect.left - 4,
      });
    };
    updatePosition();
    const onPointerDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    const onScrollOrResize = () => updatePosition();
    document.addEventListener('mousedown', onPointerDown);
    window.addEventListener('resize', onScrollOrResize);
    window.addEventListener('scroll', onScrollOrResize, true);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('resize', onScrollOrResize);
      window.removeEventListener('scroll', onScrollOrResize, true);
    };
  }, [open]);

  return (
    <>
      <div className="relative flex h-full w-full items-center justify-center">
        <button
          ref={buttonRef}
          type="button"
          aria-label="Open contact table actions"
          onClick={(event) => {
            event.stopPropagation();
            setOpen((value) => !value);
          }}
          className="inline-flex h-5 w-5 items-center justify-center rounded-none text-text-muted transition-colors hover:bg-surface-hover hover:text-text"
        >
          <MoreHorizontal className="h-3.5 w-3.5" />
        </button>
      </div>
      {open && menuPosition && typeof document !== 'undefined'
        ? createPortal(
            <div
              ref={ref}
              className="fixed z-[120] w-44 -translate-x-full -translate-y-1/2 rounded-none border border-border bg-surface p-1 shadow-lg"
              style={{ top: `${menuPosition.top}px`, left: `${menuPosition.left}px` }}
              onClick={(event) => event.stopPropagation()}
            >
              <button
                type="button"
                onClick={() => {
                  onNewContact();
                  setOpen(false);
                }}
                className="block h-8 w-full rounded-none px-2 text-left text-[11px] text-text hover:bg-surface-hover"
              >
                New contact
              </button>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

/* ── Main Component ────────────────────────────────────── */

export default function Contacts({ openAddModal, onModalOpened }: { openAddModal?: boolean; onModalOpened?: () => void }) {
  const router = useRouter();
  const isCompact = useIsMobile();
  const isPhone = useIsMobile(640);
  const searchParams = useSearchParams();
  const { setPageContext } = usePageContext();
  const { addNotification, updateNotification } = useNotificationContext();
  const {
    contacts,
    contactsLoading: isLoading,
    contactsError,
    refetchContacts,
    campaigns,
    companies,
    addContact,
    deleteContact,
    bulkDeleteContacts,
    bulkAction,
    enrollInCampaign,
  } = useContacts();

  const [showAddPanel, setShowAddPanel] = useState(false);
  const [showCampaignModal, setShowCampaignModal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [confirmDeleteSingle, setConfirmDeleteSingle] = useState<{ id: number; name: string } | null>(null);
  const [globalFilter, setGlobalFilter] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');
  const [companyFilter, setCompanyFilter] = useState('');
  const [emailFilter, setEmailFilter] = useState('');
  const [engagementFilter, setEngagementFilter] = useState('');
  const [firstNameFilter, setFirstNameFilter] = useState('');
  const [lastNameFilter, setLastNameFilter] = useState('');
  const [titleFilter, setTitleFilter] = useState('');
  const [openHeaderFilterId, setOpenHeaderFilterId] = useState<string | null>(null);
  const [sorting, setSorting] = useState<SortingState>([]);
  const [rowSelection, setRowSelection] = useState<Record<string, boolean>>({});
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [showFiltersMenu, setShowFiltersMenu] = useState(false);
  const { contactId: selectedContactId, openContact, closeContact, setContactId } = useContactDetailsRouteState();
  const view = useMemo(() => parseContactsView(searchParams?.get('view') ?? null), [searchParams]);
  useRegisterCapabilities(getPageCapability('contacts'));
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const filtersMenuRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<any>(null);
  const [viewportControlsTarget, setViewportControlsTarget] = useState<HTMLDivElement | null>(null);
  const canShiftLeftRef = useRef(false);
  const canShiftRightRef = useRef(false);
  const shiftLeftRef = useRef<() => void>(() => {});
  const shiftRightRef = useRef<() => void>(() => {});
  const lastFocusedRowRef = useRef<HTMLElement | null>(null);
  const detailsPanelRef = useRef<HTMLDivElement>(null);
  const selectionScrollAnimationRef = useRef<number | null>(null);
  const [scrollThumb, setScrollThumb] = useState<{ height: number; top: number; visible: boolean }>({
    height: 0,
    top: 0,
    visible: false,
  });
  const [scrollGutterWidth, setScrollGutterWidth] = useState(0);

  const closeAddPanel = useCallback((options?: { restoreFocus?: boolean }) => {
    setShowAddPanel(false);
    if (options?.restoreFocus === false) return;
  }, []);

  const openAddPanel = useCallback(() => {
    setShowAddPanel(true);
    closeContact();
  }, [closeContact]);

  const handleOpenContact = useCallback(
    (contactId: number) => {
      setShowAddPanel(false);
      openContact(contactId);
    },
    [openContact]
  );

  const filterSearchKey = useMemo(() => {
    const params = new URLSearchParams(searchParams?.toString() ?? '');
    params.delete('contactId');
    params.delete('view');
    return params.toString();
  }, [searchParams]);

  const companyNames = useMemo(() => Array.from(new Set(companies.map(c => c.company_name))).sort(), [companies]);
  const sourceOptions = useMemo(
    () => Array.from(new Set(contacts.map((contact) => getContactSourceLabel(contact)))).sort((a, b) => a.localeCompare(b)),
    [contacts]
  );
  const headerFilterState = useMemo(
    () => ({
      openFilterId: openHeaderFilterId,
      setOpenFilterId: setOpenHeaderFilterId,
      firstName: firstNameFilter,
      setFirstName: setFirstNameFilter,
      lastName: lastNameFilter,
      setLastName: setLastNameFilter,
      title: titleFilter,
      setTitle: setTitleFilter,
      company: companyFilter,
      setCompany: setCompanyFilter,
      source: sourceFilter,
      setSource: setSourceFilter,
      sourceOptions,
      status: engagementFilter,
      setStatus: setEngagementFilter,
    }),
    [companyFilter, engagementFilter, firstNameFilter, lastNameFilter, openHeaderFilterId, sourceFilter, sourceOptions, titleFilter]
  );
  const headerFiltersRef = useRef<{
    openFilterId: string | null;
    setOpenFilterId: (value: string | null) => void;
    firstName: string;
    setFirstName: (value: string) => void;
    lastName: string;
    setLastName: (value: string) => void;
    title: string;
    setTitle: (value: string) => void;
    company: string;
    setCompany: (value: string) => void;
    source: string;
    setSource: (value: string) => void;
    sourceOptions: string[];
    status: string;
    setStatus: (value: string) => void;
  } | null>(null);
  headerFiltersRef.current = headerFilterState;

  useEffect(() => {
    if (openAddModal) {
      const id = window.requestAnimationFrame(() => {
        openAddPanel();
        onModalOpened?.();
      });
      return () => window.cancelAnimationFrame(id);
    }
  }, [openAddModal, onModalOpened, openAddPanel]);

  const updateContactsRoute = useCallback(
    (mutate: (params: URLSearchParams) => void, options?: { replace?: boolean }) => {
      const params = new URLSearchParams(searchParams?.toString() ?? '');
      mutate(params);
      const search = params.toString();
      const nextUrl = `/contacts${search ? `?${search}` : ''}`;
      if (options?.replace ?? false) {
        router.replace(nextUrl, { scroll: false });
      } else {
        router.push(nextUrl, { scroll: false });
      }
    },
    [router, searchParams]
  );

  const setContactsView = useCallback(
    (nextView: ContactsView) => {
      updateContactsRoute((params) => {
        params.set('view', nextView);
        params.delete('contactId');
      });
    },
    [updateContactsRoute]
  );

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (filtersMenuRef.current && !filtersMenuRef.current.contains(event.target as Node)) {
        setShowFiltersMenu(false);
      }
    }
    if (!showFiltersMenu) return;
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showFiltersMenu]);

  useEffect(() => {
    if (isPhone) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (showAddPanel) {
        closeAddPanel();
        return;
      }
      closeContact();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [closeAddPanel, closeContact, isPhone, showAddPanel]);

  useEffect(() => {
    const params = new URLSearchParams(filterSearchKey);
    setGlobalFilter(normalizeQueryFilterParam('q', params.get('q')) || '');
    const company = normalizeQueryFilterParam('company', params.get('company'));
    const hasEmail = normalizeQueryFilterParam('hasEmail', params.get('hasEmail'));
    const status = normalizeQueryFilterParam('status', params.get('status'));
    const source = normalizeQueryFilterParam('source', params.get('source'));
    setCompanyFilter(company || '');
    setEmailFilter(hasEmail === 'true' ? 'yes' : hasEmail === 'false' ? 'no' : '');
    setEngagementFilter(status || '');
    setSourceFilter(source || '');
  }, [filterSearchKey]);

  const handleAddContactToCampaign = useCallback((contact: Contact) => {
    setRowSelection({ [String(contact.id)]: true });
    setShowCampaignModal(true);
  }, []);

  const displayContacts = useMemo(() => {
    let data = contacts;
    if (view === 'sources' && sourceFilter) {
      const target = sourceFilter.trim().toLowerCase();
      data = data.filter((contact) => getContactSourceLabel(contact).toLowerCase() === target);
    }
    return sortContactsByRecency(data);
  }, [contacts, sourceFilter, view]);

  const tableData = useMemo(() => {
    let data = displayContacts;
    const search = globalFilter.trim().toLowerCase();
    if (search) {
      data = data.filter((c) => {
        return (
          c.name.toLowerCase().includes(search) ||
          c.company_name.toLowerCase().includes(search) ||
          (c.title?.toLowerCase().includes(search) ?? false) ||
          (c.email?.toLowerCase().includes(search) ?? false)
        );
      });
    }

    const companyValue = companyFilter.trim().toLowerCase();
    if (companyValue) data = data.filter((c) => c.company_name.toLowerCase().includes(companyValue));
    const firstNameValue = firstNameFilter.trim().toLowerCase();
    if (firstNameValue) data = data.filter((c) => (c.first_name?.toLowerCase().includes(firstNameValue) ?? false));
    const lastNameValue = lastNameFilter.trim().toLowerCase();
    if (lastNameValue) data = data.filter((c) => (c.last_name?.toLowerCase().includes(lastNameValue) ?? false));
    const titleValue = titleFilter.trim().toLowerCase();
    if (titleValue) data = data.filter((c) => (c.title?.toLowerCase().includes(titleValue) ?? false));
    if (emailFilter === 'yes' || emailFilter === 'has') data = data.filter((c) => !!c.email);
    if (emailFilter === 'no') data = data.filter((c) => !c.email);
    if (view !== 'sources' && engagementFilter) {
      const target = engagementFilter.trim().toLowerCase();
      data = data.filter((c) => (c.engagement_status || 'needs_sync').toLowerCase() === target);
    }
    return sortContactsByRecency(data);
  }, [
    displayContacts,
    globalFilter,
    companyFilter,
    emailFilter,
    engagementFilter,
    firstNameFilter,
    lastNameFilter,
    titleFilter,
    view,
  ]);

  const columnLabelMap: Record<string, string> = {
    name: 'Name',
    first_name: 'First Name',
    last_name: 'Last Name',
    title: 'Title',
    company_name: 'Company',
    email: 'Email',
    scraped_at: 'Date Added',
    lead_source: 'Source',
    engagement_status: 'Status',
  };
  const managedColumnIds = useMemo(() => ['name', 'first_name', 'last_name', 'title', 'company_name', 'email', 'scraped_at', 'lead_source', 'engagement_status'], []);
  const { columnOrder: managedColumnOrder, setColumnOrder: setManagedColumnOrder, columnVisibility, setColumnVisibility } = usePersistentColumnPreferences({
    storageKey: 'contacts-table',
    columnIds: managedColumnIds,
    initialVisibility: { name: true },
  });

  const handleColumnOrderChange = useCallback((updater: string[] | ((old: string[]) => string[])) => {
    setManagedColumnOrder((prev) => {
      const current = ['select', ...prev, 'actions'];
      const next = typeof updater === 'function' ? updater(current) : updater;
      const orderedManaged = next.filter((id) => managedColumnIds.includes(id));
      managedColumnIds.forEach((id) => {
        if (!orderedManaged.includes(id)) orderedManaged.push(id);
      });
      return orderedManaged;
    });
  }, [managedColumnIds, setManagedColumnOrder]);

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

  const viewportControls = useMemo(() => (
    <div className="relative flex h-full w-full items-center justify-center gap-0.5 bg-surface" ref={filtersMenuRef}>
      <button
        type="button"
        onClick={() => setShowFiltersMenu((v) => !v)}
        className="inline-flex h-5 w-5 items-center justify-center rounded-none text-text-muted transition-colors hover:bg-surface-hover hover:text-text"
        title="Columns"
        aria-label="Open column visibility menu"
      >
        <SlidersHorizontal className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        onClick={() => shiftLeftRef.current()}
        disabled={!canShiftLeftRef.current}
        aria-label="Show previous columns"
        className="inline-flex h-4 w-4 items-center justify-center rounded-sm text-text-muted transition-colors hover:bg-surface-hover hover:text-text disabled:opacity-30"
      >
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5" aria-hidden="true">
          <path d="m15 18-6-6 6-6"></path>
        </svg>
      </button>
      <button
        type="button"
        onClick={() => shiftRightRef.current()}
        disabled={!canShiftRightRef.current}
        aria-label="Show more columns"
        className="inline-flex h-4 w-4 items-center justify-center rounded-sm text-text-muted transition-colors hover:bg-surface-hover hover:text-text disabled:opacity-30"
      >
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5" aria-hidden="true">
          <path d="m9 18 6-6-6-6"></path>
        </svg>
      </button>
      {showFiltersMenu ? (
        <div className="absolute right-0 top-7 z-20 w-[260px] rounded-none border border-border bg-surface p-3 shadow-lg">
          <ColumnVisibilityMenu
            items={managedColumnOrder.map((columnId, index) => ({
              id: columnId,
              label: columnLabelMap[columnId] ?? columnId,
              visible: tableRef.current?.getColumn(columnId)?.getIsVisible() ?? true,
              canHide: columnId !== 'name',
              canMoveUp: index > 0,
              canMoveDown: index < managedColumnOrder.length - 1,
            }))}
            onToggle={(columnId, visible) => {
              if (columnId === 'name') return;
              tableRef.current?.getColumn(columnId)?.toggleVisibility(visible);
            }}
            onMoveUp={(columnId) => moveManagedColumn(columnId, -1)}
            onMoveDown={(columnId) => moveManagedColumn(columnId, 1)}
          />
        </div>
      ) : null}
    </div>
  ), [
    columnLabelMap,
    managedColumnOrder,
    moveManagedColumn,
    showFiltersMenu,
  ]);

  const actionsHeader = useMemo(
    () => <ContactsHeaderActionsMenu onNewContact={openAddPanel} />,
    [openAddPanel],
  );

  /* ── Table configuration ── */

  const columns = useMemo(
    () =>
      createContactColumns(
        (id, name) => {
          setConfirmDeleteSingle({ id, name });
        },
        {
          compact: isCompact,
          actionsHeader,
          headerFiltersRef: isCompact ? undefined : headerFiltersRef,
          onAddToCampaign: handleAddContactToCampaign,
        }
      ),
    [actionsHeader, handleAddContactToCampaign, isCompact]
  );

  const selectedContact = useMemo(
    () => (selectedContactId ? tableData.find((c) => c.id === selectedContactId) ?? null : null),
    [selectedContactId, tableData]
  );

  const { columnSizing, setColumnSizing, autoFitColumn } = usePersistentColumnSizing({
    columns,
    rows: tableData,
    storageKey: 'contacts-table-sizing-v2',
    initialSizingMode: 'min',
  });
  const visibleColumnIdsRef = useRef<string[]>([]);
  const visibleColumnWidthsRef = useRef<Record<string, number>>({});
  const fillWidthRef = useRef(0);
  const resizingColumnIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!selectedContactId) return;
    if (isLoading) return;
    if (!selectedContact) setContactId(null, { replace: true });
  }, [isLoading, selectedContact, selectedContactId, setContactId]);

  useEffect(() => {
    if ((!selectedContact && !showAddPanel) || isPhone) return;
    const id = window.requestAnimationFrame(() => {
      detailsPanelRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(id);
  }, [selectedContact, showAddPanel, isPhone]);

  useEffect(() => {
    if (selectedContactId) return;
    if (isPhone) return;
    lastFocusedRowRef.current?.focus();
  }, [selectedContactId, isPhone]);

  /* ── Table ── */

  const selectedIds = Object.keys(rowSelection).map(Number);
  const selectedCount = selectedIds.length;
  const emailCount = contacts.filter(c => c.email).length;

  const handleColumnSizingChange = useCallback((updater: Updater<Record<string, number>>) => {
    setColumnSizing((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      const resizingColumnId = resizingColumnIdRef.current;
      if (!resizingColumnId || resizingColumnId === 'select' || resizingColumnId === 'actions') return next;

      const visibleColumnIds = visibleColumnIdsRef.current;
      if (!visibleColumnIds.includes(resizingColumnId)) return next;
      const visibleScrollingIds = visibleColumnIds.filter((id) => id !== 'select' && id !== 'actions');
      const trailingVisibleScrollingId = visibleScrollingIds[visibleScrollingIds.length - 1] ?? null;
      if (resizingColumnId !== trailingVisibleScrollingId) return next;

      const currentVisibleWidth = visibleColumnWidthsRef.current[resizingColumnId];
      if (typeof currentVisibleWidth !== 'number' || !Number.isFinite(currentVisibleWidth)) return next;

      const maxVisibleWidth = currentVisibleWidth + Math.max(fillWidthRef.current, 0);
      const requestedWidth = next[resizingColumnId];
      if (typeof requestedWidth !== 'number' || !Number.isFinite(requestedWidth)) return next;
      if (requestedWidth <= maxVisibleWidth) return next;

      return {
        ...next,
        [resizingColumnId]: maxVisibleWidth,
      };
    });
  }, [setColumnSizing]);

  const table = useReactTable({
    data: tableData,
    columns,
    state: { sorting, rowSelection, columnVisibility, columnSizing, columnOrder: ['select', ...managedColumnOrder, 'actions'] },
    onSortingChange: setSorting,
    onRowSelectionChange: setRowSelection,
    onColumnVisibilityChange: setColumnVisibility,
    onColumnOrderChange: handleColumnOrderChange,
    onColumnSizingChange: handleColumnSizingChange,
    getRowId: (row) => String(row.id),
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    autoResetAll: false,
    columnResizeMode: 'onChange',
  });
  tableRef.current = table;

  const { rows } = table.getRowModel();
  const filteredCount = rows.length;

  const isInteractiveTarget = useCallback((target: EventTarget | null) => {
    if (!(target instanceof HTMLElement)) return false;
    return !!target.closest(
      'input, button, a, select, textarea, [role="button"], [role="menu"], [role="menuitem"], [data-row-control]'
    );
  }, []);

  /* ── Virtualizer ── */

  const baseHeight = isCompact ? MOBILE_ROW_HEIGHT : ROW_HEIGHT;
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: useCallback(() => baseHeight, [baseHeight]),
    overscan: 20,
  });

  useEffect(() => {
    if (isCompact) return;
    if (!selectedContactId) return;
    const element = scrollContainerRef.current;
    if (!element) return;
    const index = rows.findIndex((row) => String(row.original.id) === String(selectedContactId));
    if (index < 0) return;
    const targetTop = index * baseHeight;
    const id = window.requestAnimationFrame(() => {
      const startTop = element.scrollTop;
      const distance = targetTop - startTop;
      if (Math.abs(distance) < 2) {
        element.scrollTop = targetTop;
        return;
      }
      if (selectionScrollAnimationRef.current != null) {
        window.cancelAnimationFrame(selectionScrollAnimationRef.current);
        selectionScrollAnimationRef.current = null;
      }
      const durationMs = 1000;
      const startTime = performance.now();
      const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
      const step = (now: number) => {
        const elapsed = now - startTime;
        const progress = Math.min(elapsed / durationMs, 1);
        element.scrollTop = startTop + distance * easeInOutCubic(progress);
        if (progress < 1) {
          selectionScrollAnimationRef.current = window.requestAnimationFrame(step);
          return;
        }
        selectionScrollAnimationRef.current = null;
      };
      selectionScrollAnimationRef.current = window.requestAnimationFrame(step);
    });
    return () => {
      window.cancelAnimationFrame(id);
      if (selectionScrollAnimationRef.current != null) {
        window.cancelAnimationFrame(selectionScrollAnimationRef.current);
        selectionScrollAnimationRef.current = null;
      }
    };
  }, [baseHeight, isCompact, rows, selectedContactId]);

  useEffect(() => {
    if (isCompact) return;
    const frameId = window.requestAnimationFrame(() => {
      rowVirtualizer.measure();
    });
    const timeoutId = window.setTimeout(() => {
      rowVirtualizer.measure();
    }, 220);
    return () => {
      window.cancelAnimationFrame(frameId);
      window.clearTimeout(timeoutId);
    };
  }, [isCompact, rowVirtualizer, selectedContactId, showAddPanel]);

  useEffect(() => {
    if (isCompact) {
      setScrollThumb({ height: 0, top: 0, visible: false });
      setScrollGutterWidth(0);
      return;
    }
    const element = scrollContainerRef.current;
    if (!element) return;
    let frameId = 0;
    const updateThumb = () => {
      const { clientHeight, scrollHeight, scrollTop, offsetWidth, clientWidth } = element;
      setScrollGutterWidth(Math.max(0, offsetWidth - clientWidth));
      if (scrollHeight <= clientHeight + 1) {
        setScrollThumb({ height: 0, top: 0, visible: false });
        return;
      }
      const ratio = clientHeight / scrollHeight;
      const thumbHeight = Math.max(40, Math.round(clientHeight * ratio));
      const maxTop = Math.max(0, clientHeight - thumbHeight);
      const top = Math.min(maxTop, Math.round((scrollTop / (scrollHeight - clientHeight)) * maxTop));
      setScrollThumb({ height: thumbHeight, top, visible: true });
    };
    const scheduleUpdate = () => {
      window.cancelAnimationFrame(frameId);
      frameId = window.requestAnimationFrame(updateThumb);
    };
    scheduleUpdate();
    element.addEventListener('scroll', scheduleUpdate, { passive: true });
    window.addEventListener('resize', scheduleUpdate);
    return () => {
      window.cancelAnimationFrame(frameId);
      element.removeEventListener('scroll', scheduleUpdate);
      window.removeEventListener('resize', scheduleUpdate);
    };
  }, [isCompact, rows.length, selectedContactId, showAddPanel]);


  /* ── Bulk Action Handlers ── */

  const handleBulkSalesforceUpload = async () => {
    if (selectedCount === 0) return;
    setActionLoading('salesforce');
    const notificationId = addNotification({
      type: 'loading',
      title: 'Preparing Salesforce upload...',
      message: `Creating CSV for ${selectedCount} contacts`,
      duration: 0,
    });
    try {
      const res = await fetch('/api/contacts/bulk-actions/salesforce-upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contact_ids: selectedIds }),
      });
      const data = await res.json();
      if (data.success) {
        const link = document.createElement('a');
        link.href = `/api/contacts/salesforce-csv/${data.csv_filename}`;
        link.download = data.csv_filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        updateNotification(notificationId, {
          type: 'success',
          title: 'Ready for Salesforce',
          message: `CSV downloaded with ${data.exported} contacts.`,
          duration: 10000,
        });
      } else {
        updateNotification(notificationId, {
          type: 'error',
          title: 'Upload Failed',
          message: data.error || 'Failed to create CSV',
        });
      }
    } catch (error) {
      updateNotification(notificationId, {
        type: 'error',
        title: 'Upload Failed',
        message: error instanceof Error ? error.message : 'An error occurred',
      });
    } finally {
      setActionLoading(null);
    }
  };

  const handleBulkAction = (action: string, loadingKey: string, title: string) => {
    if (selectedCount === 0) return;
    setActionLoading(loadingKey);
    const notificationId = addNotification({
      type: 'loading',
      title: `${title}...`,
      message: `Processing ${selectedCount} contacts`,
      duration: 0,
    });
    bulkAction.mutate({ action, contactIds: selectedIds, notificationId });
  };

  const handleEnrollInCampaign = (campaignId: number) => {
    enrollInCampaign.mutate(
      { campaignId, contactIds: selectedIds },
      {
        onSuccess: () => setShowCampaignModal(false),
        onSettled: () => setActionLoading(null),
      }
    );
  };

  const handleBulkDelete = () => {
    if (selectedCount === 0) return;
    setShowDeleteConfirm(true);
  };

  const confirmBulkDelete = () => {
    setActionLoading('delete');
    bulkDeleteContacts.mutate(selectedIds, {
      onSuccess: () => {
        setRowSelection({});
        setShowDeleteConfirm(false);
      },
      onSettled: () => setActionLoading(null),
    });
  };

  useEffect(() => {
    setPageContext({
      listContext: 'contacts',
      selected: selectedContactId ? { contactId: selectedContactId } : {},
      loadedIds: { contactIds: tableData.slice(0, 200).map((c) => c.id) },
    });
  }, [selectedContactId, setPageContext, tableData]);

  /* ── Synced column widths (desktop) ── */

  const {
    containerRef: desktopTableRef,
    columnWidths: desktopColumnWidths,
    visibleColumnIds: desktopVisibleColumnIds,
    tableStyle: desktopTableStyle,
    fillWidth: desktopFillWidth,
    canShiftLeft: canShiftContactsLeft,
    canShiftRight: canShiftContactsRight,
    shiftLeft: shiftContactsLeft,
    shiftRight: shiftContactsRight,
  } = useFittedTableLayout(table, { controlWidth: CONTACTS_VIEWPORT_CONTROL_WIDTH });

  canShiftLeftRef.current = canShiftContactsLeft;
  canShiftRightRef.current = canShiftContactsRight;
  shiftLeftRef.current = shiftContactsLeft;
  shiftRightRef.current = shiftContactsRight;

  useEffect(() => {
    visibleColumnIdsRef.current = desktopVisibleColumnIds;
    visibleColumnWidthsRef.current = desktopColumnWidths;
    fillWidthRef.current = desktopFillWidth;
    const resizingId = table.getState().columnSizingInfo?.isResizingColumn;
    resizingColumnIdRef.current = typeof resizingId === 'string' ? resizingId : null;
  }, [desktopColumnWidths, desktopFillWidth, desktopVisibleColumnIds, table]);

  /* ── Render ── */

  const tabs = useMemo(
    () => [
      { id: 'all', label: 'All Contacts' },
      { id: 'sources', label: 'Sources' },
      { id: 'pipeline', label: 'Pipeline / Status' },
    ],
    []
  );

  const inlineControls = (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex min-w-0 items-center gap-2">
        <div className="min-w-0 flex-1">
          <PageSearchInput value={globalFilter} onChange={setGlobalFilter} placeholder="Search contacts..." />
        </div>
        <div ref={setViewportControlsTarget} className="flex h-8 w-14 shrink-0 items-center justify-center" />
      </div>
      {selectedCount > 0 ? (
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="inline-flex h-8 items-center rounded-none border border-indigo-200 bg-indigo-50 px-2.5 text-xs font-medium text-indigo-900">
            {selectedCount} selected
          </span>
          <HeaderActionButton
            compact
            data-assistant-id="export-contacts-button"
            onClick={() => api.exportContacts(false)}
            variant="secondary"
            icon={<Download className="w-3.5 h-3.5" />}
          >
            Export
          </HeaderActionButton>
          <HeaderActionButton
            compact
            onClick={handleBulkSalesforceUpload}
            disabled={actionLoading !== null}
            variant="primary"
            icon={actionLoading === 'salesforce' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
          >
            SF
          </HeaderActionButton>
          <HeaderActionButton
            compact
            onClick={() => handleBulkAction('linkedin-request', 'linkedin', 'Sending LinkedIn requests')}
            disabled={actionLoading !== null}
            variant="primary"
            icon={actionLoading === 'linkedin' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UserPlus className="w-3.5 h-3.5" />}
          >
            LI
          </HeaderActionButton>
          <HeaderActionButton
            compact
            onClick={() => handleBulkAction('send-email', 'email', 'Sending emails')}
            disabled={actionLoading !== null}
            variant="primary"
            icon={actionLoading === 'email' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
          >
            Email
          </HeaderActionButton>
          <HeaderActionButton
            compact
            onClick={() => handleBulkAction('collect-phone', 'phone', 'Collecting phone data')}
            disabled={actionLoading !== null}
            variant="primary"
            icon={actionLoading === 'phone' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Phone className="w-3.5 h-3.5" />}
          >
            Phone
          </HeaderActionButton>
          <HeaderActionButton
            compact
            onClick={() => setShowCampaignModal(true)}
            disabled={actionLoading !== null}
            variant="secondary"
            icon={<Target className="w-3.5 h-3.5" />}
          >
            Campaign
          </HeaderActionButton>
          <HeaderActionButton
            compact
            onClick={handleBulkDelete}
            disabled={actionLoading !== null}
            variant="danger"
            icon={actionLoading === 'delete' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
          >
            Delete
          </HeaderActionButton>
        </div>
      ) : null}
    </div>
  );

  return (
    <>
      {viewportControlsTarget && typeof document !== 'undefined'
        ? createPortal(
            <div className="flex h-full w-full items-center justify-center">
              {viewportControls}
            </div>,
            viewportControlsTarget,
          )
        : null}
      <WorkspacePageShell
        title="Contacts"
        subtitle={`${contacts.length} contacts · ${emailCount} with emails${filteredCount !== contacts.length ? ` · ${filteredCount} shown` : ''}`}
        contentClassName=""
        hideHeader
        preHeader={
          <EmailTabs
            tabs={tabs}
            activeTab={view}
            onSelectTab={(tabId) => {
              if (tabId === 'all' || tabId === 'sources' || tabId === 'pipeline') setContactsView(tabId);
            }}
          />
        }
        preHeaderAffectsLayout
        preHeaderClassName="h-14 flex items-end"
      >
        <div className="flex h-full min-h-0 flex-col bg-surface">
          <div className="shrink-0 bg-surface">
            {inlineControls}
          </div>
          <div className="flex min-h-0 flex-1 overflow-hidden bg-surface">
          {/* min-w-0 prevents table pane overflow from forcing horizontal overflow in split mode. */}
          {/* min-h-0 allows inner scroll areas to size and scroll correctly inside nested flex containers. */}
          <div ref={!isCompact ? desktopTableRef : undefined} className="flex min-w-0 min-h-0 flex-1 flex-col">
            {isLoading ? (
              <div className="min-h-0 flex-1 overflow-hidden">
                <LoadingSpinner />
              </div>
            ) : (
              <>
                {!isCompact && (
                  <div className="relative shrink-0" style={{ paddingRight: `${scrollGutterWidth}px` }}>
                    <table className="w-full border-collapse" style={desktopTableStyle}>
                      <SharedTableColGroupWithWidths table={table} columnWidths={desktopColumnWidths} visibleColumnIds={desktopVisibleColumnIds} fillerWidth={desktopFillWidth} controlWidth={CONTACTS_VIEWPORT_CONTROL_WIDTH} />
                      <SharedTableHeader
                        table={table}
                        onAutoFitColumn={autoFitColumn}
                        visibleColumnIds={desktopVisibleColumnIds}
                        columnWidths={desktopColumnWidths}
                        fillerWidth={desktopFillWidth}
                        controlWidth={CONTACTS_VIEWPORT_CONTROL_WIDTH}
                      />
                    </table>
                  </div>
                )}

                <div className="relative min-h-0 flex-1">
                  <div ref={scrollContainerRef} className="no-scrollbar min-h-0 h-full overflow-y-auto overflow-x-hidden">
                  {contactsError ? (
                    <EmptyState
                      icon={Users}
                      title="Could not load contacts"
                      description={contactsError.message || 'Please retry.'}
                      action={{ label: 'Retry', icon: RotateCcw, onClick: () => void refetchContacts() }}
                    />
                  ) : rows.length === 0 ? (
                    <EmptyState
                      icon={Users}
                      title="No contacts found"
                      description="Try adjusting your filters or add a new contact"
                      action={{ label: 'New Contact', icon: Plus, onClick: openAddPanel }}
                    />
                  ) : (
                    <div
                      style={{
                        height: `${rowVirtualizer.getTotalSize()}px`,
                        position: 'relative',
                        minWidth: undefined,
                      }}
                    >
                      {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                        const row = rows[virtualRow.index];
                        const contact = row.original;
                        const isActive = selectedContactId === contact.id;
                        const isSelected = row.getIsSelected();

                        return (
                          <div
                            key={row.id}
                            data-index={virtualRow.index}
                            ref={rowVirtualizer.measureElement}
                            style={{
                              position: 'absolute',
                              top: 0,
                              left: 0,
                              width: '100%',
                              transform: `translateY(${virtualRow.start}px)`,
                            }}
                          >
                            {isCompact ? (
                              <ContactCard
                                contact={contact}
                                isSelected={row.getIsSelected()}
                                isExpanded={false}
                                onToggleSelect={() => row.toggleSelected()}
                                onToggleExpand={() => handleOpenContact(contact.id)}
                              />
                            ) : (
                              <table className="w-full border-collapse" style={desktopTableStyle}>
                                <SharedTableColGroupWithWidths table={table} columnWidths={desktopColumnWidths} visibleColumnIds={desktopVisibleColumnIds} fillerWidth={desktopFillWidth} controlWidth={CONTACTS_VIEWPORT_CONTROL_WIDTH} />
                                <tbody>
                                  <tr
                                    className={`group ${SHARED_TABLE_ROW_HEIGHT_CLASS} cursor-pointer border-b border-border-subtle transition-colors ${
                                      isActive ? 'bg-accent/12' : isSelected ? 'bg-accent/8' : 'hover:bg-surface-hover/60'
                                    }`}
                                    onClick={(e) => {
                                      if (isInteractiveTarget(e.target)) return;
                                      lastFocusedRowRef.current = e.currentTarget;
                                      handleOpenContact(contact.id);
                                    }}
                                    onKeyDown={(e) => {
                                      if (e.key !== 'Enter' && e.key !== ' ') return;
                                      if (isInteractiveTarget(e.target)) return;
                                      e.preventDefault();
                                      lastFocusedRowRef.current = e.currentTarget;
                                      handleOpenContact(contact.id);
                                    }}
                                    tabIndex={0}
                                    aria-expanded={isActive}
                                    aria-controls={isActive ? 'contact-details-panel' : undefined}
                                    aria-label={`Open details for ${contact.name}`}
                                  >
                                    {(() => {
                                      const cells = filterCellsByIds(row.getVisibleCells(), desktopVisibleColumnIds);
                                      const trailingActionsCell = cells.length > 0 && cells[cells.length - 1]?.column.id === 'actions'
                                        ? cells[cells.length - 1]
                                        : null;
                                      const leadingCells = trailingActionsCell ? cells.slice(0, -1) : cells;
                                      return (
                                        <>
                                          {leadingCells.map((cell, index) => (
                                            <td
                                              key={cell.id}
                                              className={sharedCellClassName(cell, `${SHARED_TABLE_ROW_HEIGHT_CLASS} ${index === leadingCells.length - 1 && !trailingActionsCell ? '__shared-last__' : ''}`)}
                                              onClick={(event) => {
                                                if (cell.column.id !== 'select') return;
                                                event.stopPropagation();
                                                row.toggleSelected();
                                              }}
                                            >
                                              {cell.column.id === 'select' ? null : flexRender(cell.column.columnDef.cell, cell.getContext())}
                                            </td>
                                          ))}
                                          {desktopFillWidth > 0 && !trailingActionsCell ? (
                                            <td
                                              aria-hidden="true"
                                              className={`${SHARED_TABLE_ROW_HEIGHT_CLASS} px-0 py-0`}
                                            />
                                          ) : null}
                                          {trailingActionsCell ? (
                                            <td
                                              key={trailingActionsCell.id}
                                              className={sharedCellClassName(trailingActionsCell, `${SHARED_TABLE_ROW_HEIGHT_CLASS} __shared-last__`)}
                                              onClick={(event) => {
                                                if (trailingActionsCell.column.id !== 'select') return;
                                                event.stopPropagation();
                                                row.toggleSelected();
                                              }}
                                            >
                                              {flexRender(trailingActionsCell.column.columnDef.cell, trailingActionsCell.getContext())}
                                            </td>
                                          ) : null}
                                        </>
                                      );
                                    })()}
                                  </tr>
                                </tbody>
                              </table>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                  </div>
                  {!isCompact && scrollThumb.visible ? (
                    <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-0 w-2">
                      <div
                        className="absolute right-0 w-1.5 rounded-full bg-slate-200/75"
                        style={{ top: `${scrollThumb.top}px`, height: `${scrollThumb.height}px` }}
                      />
                    </div>
                  ) : null}
                </div>
              </>
            )}
          </div>
          {!isPhone && (showAddPanel || selectedContact) ? (
            <ResizableSidePanel
              ariaLabel="Contact details panel"
              storageKey="contacts_details_panel_width_v1"
              defaultWidth={460}
              minWidth={360}
              maxWidth={820}
            >
              {showAddPanel ? (
                <div id="contact-details-panel" tabIndex={-1} className="flex h-full min-h-0 flex-col outline-none">
                  <AddContactPanelContent
                    companies={companyNames}
                    isSubmitting={addContact.isPending}
                    onAdd={(data) => {
                      addContact.mutate(data, {
                        onSuccess: () => {
                          setShowAddPanel(false);
                        },
                      });
                    }}
                    onClose={() => closeAddPanel()}
                  />
                </div>
              ) : selectedContact ? (
                <div id="contact-details-panel" tabIndex={-1} className="flex h-full min-h-0 flex-col outline-none">
                  <ContactDetailsContent
                    contact={selectedContact}
                    onClose={closeContact}
                    onAddToCampaign={handleAddContactToCampaign}
                  />
                </div>
              ) : null}
            </ResizableSidePanel>
          ) : null}
          </div>
        </div>
      </WorkspacePageShell>
      {isPhone && showAddPanel ? (
        <BottomDrawerContainer onClose={() => closeAddPanel()}>
          <AddContactPanelContent
            companies={companyNames}
            isSubmitting={addContact.isPending}
            onAdd={(data) => {
              addContact.mutate(data, {
                onSuccess: () => {
                  setShowAddPanel(false);
                },
              });
            }}
            onClose={() => closeAddPanel()}
          />
        </BottomDrawerContainer>
      ) : null}
      {isPhone && !showAddPanel && selectedContact ? (
        <BottomDrawerContainer onClose={closeContact}>
          <ContactDetailsContent
            contact={selectedContact}
            onClose={closeContact}
            onAddToCampaign={handleAddContactToCampaign}
          />
        </BottomDrawerContainer>
      ) : null}
      {/* Campaign Enrollment Modal */}
      {showCampaignModal && (
        <CampaignEnrollmentModal
          campaigns={campaigns}
          selectedCount={selectedCount}
          onEnroll={handleEnrollInCampaign}
          onClose={() => setShowCampaignModal(false)}
          isEnrolling={enrollInCampaign.isPending}
        />
      )}

      {/* Bulk Delete Confirmation Dialog */}
      <ConfirmDialog
        open={showDeleteConfirm}
        title={`Delete ${selectedCount} contact${selectedCount !== 1 ? 's' : ''}?`}
        message="This action cannot be undone. The selected contacts will be permanently removed."
        confirmLabel="Delete"
        variant="danger"
        onConfirm={confirmBulkDelete}
        onCancel={() => setShowDeleteConfirm(false)}
      />

      {/* Single Contact Delete Confirmation Dialog */}
      <ConfirmDialog
        open={!!confirmDeleteSingle}
        title={`Delete ${confirmDeleteSingle?.name ?? 'contact'}?`}
        message="This contact will be permanently removed."
        confirmLabel="Delete"
        variant="danger"
        onConfirm={() => {
          if (confirmDeleteSingle) deleteContact.mutate(confirmDeleteSingle.id);
          setConfirmDeleteSingle(null);
        }}
        onCancel={() => setConfirmDeleteSingle(null)}
      />
    </>
  );
}
