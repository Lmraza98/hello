import { createColumnHelper, type Column, type ColumnDef } from '@tanstack/react-table';
import { useEffect, useRef, useState, type MutableRefObject, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  Building2,
  CheckCircle,
  ExternalLink,
  Filter,
  Mail,
  MoreHorizontal,
  Phone,
  XCircle,
} from 'lucide-react';
import type { Contact } from '../../api';
import { EngagementStatusBadge, SalesforceSyncBadge } from './SalesforceStatusBadge';
import { getContactSourceLabel } from './sourceLabel';

const columnHelper = createColumnHelper<Contact>();
const CONTACT_ACTIONS_COLUMN_WIDTH = 56;

type HeaderFilters = {
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
};

type ContactColumnsOptions = {
  compact?: boolean;
  actionsHeader?: React.ReactNode;
  headerFiltersRef?: MutableRefObject<HeaderFilters | null>;
  onAddToCampaign?: (contact: Contact) => void;
};

function getContactDetailsHref(contact: Contact) {
  return contact.salesforce_url || contact.linkedin_url || (contact.domain ? `https://${contact.domain}` : '');
}

function formatDateAdded(value: string | null | undefined) {
  if (!value) return '-';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '-';
  return parsed.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function SortableHeader({ column, children }: { column: Column<Contact, unknown>; children: React.ReactNode }) {
  const sorted = column.getIsSorted();
  return (
    <button
      type="button"
      className="flex items-center gap-0.5 hover:text-text transition-colors text-[11px] font-medium tracking-wide uppercase"
      onClick={column.getToggleSortingHandler()}
      aria-label={`Sort by ${String(children)}`}
    >
      {children}
      {sorted === 'asc' ? (
        <ArrowUp className="w-2.5 h-2.5" />
      ) : sorted === 'desc' ? (
        <ArrowDown className="w-2.5 h-2.5" />
      ) : (
        <ArrowUpDown className="w-2.5 h-2.5 opacity-40" />
      )}
    </button>
  );
}

function HeaderFilterMenu({
  filterId,
  open,
  onToggle,
  active,
  label,
  children,
}: {
  filterId: string;
  open: boolean;
  onToggle: (filterId: string) => void;
  active: boolean;
  label: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onToggle(filterId);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [filterId, onToggle, open]);

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onToggle(filterId);
        }}
        aria-label={`Filter ${label}`}
        className={`inline-flex h-4 w-4 items-center justify-center rounded-none transition-colors ${active ? 'text-text' : 'text-text-dim hover:text-text'}`}
      >
        <Filter className="h-3 w-3" />
      </button>
      {open ? (
        <div
          className="absolute left-0 top-6 z-40 w-40 rounded-none border border-border bg-surface p-2 shadow-lg"
          onClick={(event) => event.stopPropagation()}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}

function FilterableHeader({
  filterId,
  open,
  onToggle,
  column,
  label,
  active,
  filterContent,
}: {
  filterId: string;
  open: boolean;
  onToggle: (filterId: string) => void;
  column: Column<Contact, unknown>;
  label: string;
  active: boolean;
  filterContent: ReactNode;
}) {
  return (
    <div className="flex items-center gap-1">
      <SortableHeader column={column}>{label}</SortableHeader>
      <HeaderFilterMenu filterId={filterId} open={open} onToggle={onToggle} active={active} label={label}>
        {filterContent}
      </HeaderFilterMenu>
    </div>
  );
}

function RowActionsMenu({
  contact,
  onAddToCampaign,
  onDelete,
}: {
  contact: Contact;
  onAddToCampaign?: (contact: Contact) => void;
  onDelete: (id: number, name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number } | null>(null);
  const detailsHref = getContactDetailsHref(contact);

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
    <div ref={ref} className="relative flex items-center justify-center">
      <button
        ref={buttonRef}
        type="button"
        aria-label={`Open actions for ${contact.name}`}
        data-row-control
        onClick={(event) => {
          event.stopPropagation();
          setOpen((value) => !value);
        }}
        className="inline-flex h-5 w-5 items-center justify-center rounded-none text-text-muted transition-colors hover:bg-surface-hover hover:text-text"
      >
        <MoreHorizontal className="h-3.5 w-3.5" />
      </button>
      {open && menuPosition && typeof document !== 'undefined'
        ? createPortal(
            <div
              className="fixed z-[120] w-44 -translate-x-full -translate-y-1/2 rounded-none border border-border bg-surface p-1 shadow-lg"
              style={{ top: `${menuPosition.top}px`, left: `${menuPosition.left}px` }}
              onClick={(event) => event.stopPropagation()}
            >
              {onAddToCampaign ? (
                <button
                  type="button"
                  data-row-control
                  onClick={() => {
                    onAddToCampaign(contact);
                    setOpen(false);
                  }}
                  className="block h-8 w-full rounded-none px-2 text-left text-[11px] text-text hover:bg-surface-hover"
                >
                  Add to campaign
                </button>
              ) : null}
              {contact.email ? (
                <a
                  href={`mailto:${contact.email}`}
                  aria-label={`Send email to ${contact.name}`}
                  data-row-control
                  onClick={() => setOpen(false)}
                  className="flex h-8 w-full items-center gap-1 rounded-none px-2 text-left text-[11px] text-text hover:bg-surface-hover"
                >
                  Email
                  <Mail className="h-3.5 w-3.5" />
                </a>
              ) : null}
              {contact.phone ? (
                <a
                  href={`tel:${contact.phone}`}
                  aria-label={`Call ${contact.name}`}
                  data-row-control
                  onClick={() => setOpen(false)}
                  className="flex h-8 w-full items-center gap-1 rounded-none px-2 text-left text-[11px] text-text hover:bg-surface-hover"
                >
                  Phone
                  <Phone className="h-3.5 w-3.5" />
                </a>
              ) : null}
              <button
                type="button"
                data-row-control
                disabled={!detailsHref}
                onClick={() => {
                  if (detailsHref) window.open(detailsHref, '_blank', 'noopener,noreferrer');
                  setOpen(false);
                }}
                className="flex h-8 w-full items-center gap-1 rounded-none px-2 text-left text-[11px] text-text hover:bg-surface-hover disabled:cursor-not-allowed disabled:text-text-dim disabled:hover:bg-transparent"
              >
                Open full details
                <ExternalLink className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                data-row-control
                onClick={() => {
                  if (contact.id) onDelete(contact.id, contact.name);
                  setOpen(false);
                }}
                className="flex h-8 w-full items-center gap-1 rounded-none px-2 text-left text-[11px] text-rose-700 hover:bg-rose-50"
              >
                Delete
              </button>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

export function createContactColumns(onDelete: (id: number, name: string) => void, options: ContactColumnsOptions = {}) {
  const compact = options.compact === true;

  const columns: ColumnDef<Contact, unknown>[] = [
    columnHelper.display({
      id: 'select',
      header: ({ table }) => (
        <button
          type="button"
          aria-label="Select all visible contacts"
          aria-pressed={table.getIsAllRowsSelected()}
          onClick={() => table.toggleAllRowsSelected(!table.getIsAllRowsSelected())}
          className="block h-full w-full"
          data-row-control
        />
      ),
      cell: () => null,
      size: 32,
      minSize: 32,
      maxSize: 32,
      enableResizing: false,
      meta: {
        label: 'Select',
        minWidth: 32,
        defaultWidth: 32,
        maxWidth: 32,
        resizable: false,
        align: 'center',
      },
    }),
    columnHelper.accessor('name', {
      header: ({ column }) => <SortableHeader column={column}>Name</SortableHeader>,
      cell: ({ getValue }) => (
        <div className="text-[11px] font-semibold leading-tight text-text truncate" title={getValue()}>
          {getValue()}
        </div>
      ),
      filterFn: (row, _id, value) => row.original.name.toLowerCase().includes(value.toLowerCase()),
      size: 188,
      minSize: 180,
      maxSize: Number.MAX_SAFE_INTEGER,
      meta: {
        label: 'Name',
        minWidth: 180,
        defaultWidth: 240,
        maxWidth: 420,
        resizable: true,
        align: 'left',
        grow: 2,
        measureValue: (row: Contact) => `${row.name} ${row.title || ''}`.trim(),
      },
    }),
  ];

  if (!compact) {
    columns.push(
      columnHelper.accessor('first_name', {
        id: 'first_name',
        header: ({ column }) => options.headerFiltersRef?.current ? (
          <FilterableHeader
            column={column}
            filterId="first_name"
            open={options.headerFiltersRef.current.openFilterId === 'first_name'}
            onToggle={(filterId) => options.headerFiltersRef?.current?.setOpenFilterId(options.headerFiltersRef.current?.openFilterId === filterId ? null : filterId)}
            label="First Name"
            active={Boolean(options.headerFiltersRef.current.firstName)}
            filterContent={
              <input
                value={options.headerFiltersRef.current.firstName}
                onChange={(event) => options.headerFiltersRef?.current?.setFirstName(event.target.value)}
                placeholder="Filter"
                className="h-7 w-full rounded-none border border-border bg-surface px-2 text-[11px] text-text focus:border-accent focus:outline-none"
              />
            }
          />
        ) : <SortableHeader column={column}>First Name</SortableHeader>,
        cell: ({ row }) => (
          <div className="max-w-[160px] truncate text-[10px] leading-tight text-text-muted" title={row.original.first_name || '-'}>
            {row.original.first_name || '-'}
          </div>
        ),
        filterFn: (row, _id, value) => (row.original.first_name?.toLowerCase().includes(String(value).toLowerCase()) ?? false),
        size: 136,
        minSize: 112,
        maxSize: Number.MAX_SAFE_INTEGER,
        meta: {
          label: 'First Name',
          minWidth: 112,
          defaultWidth: 136,
          maxWidth: 200,
          resizable: true,
          align: 'left',
          measureValue: (row: Contact) => row.first_name || '-',
        },
      }),
      columnHelper.accessor('last_name', {
        id: 'last_name',
        header: ({ column }) => options.headerFiltersRef?.current ? (
          <FilterableHeader
            column={column}
            filterId="last_name"
            open={options.headerFiltersRef.current.openFilterId === 'last_name'}
            onToggle={(filterId) => options.headerFiltersRef?.current?.setOpenFilterId(options.headerFiltersRef.current?.openFilterId === filterId ? null : filterId)}
            label="Last Name"
            active={Boolean(options.headerFiltersRef.current.lastName)}
            filterContent={
              <input
                value={options.headerFiltersRef.current.lastName}
                onChange={(event) => options.headerFiltersRef?.current?.setLastName(event.target.value)}
                placeholder="Filter"
                className="h-7 w-full rounded-none border border-border bg-surface px-2 text-[11px] text-text focus:border-accent focus:outline-none"
              />
            }
          />
        ) : <SortableHeader column={column}>Last Name</SortableHeader>,
        cell: ({ row }) => (
          <div className="max-w-[160px] truncate text-[10px] leading-tight text-text-muted" title={row.original.last_name || '-'}>
            {row.original.last_name || '-'}
          </div>
        ),
        filterFn: (row, _id, value) => (row.original.last_name?.toLowerCase().includes(String(value).toLowerCase()) ?? false),
        size: 148,
        minSize: 120,
        maxSize: Number.MAX_SAFE_INTEGER,
        meta: {
          label: 'Last Name',
          minWidth: 120,
          defaultWidth: 148,
          maxWidth: 220,
          resizable: true,
          align: 'left',
          measureValue: (row: Contact) => row.last_name || '-',
        },
      }),
      columnHelper.accessor('title', {
        header: ({ column }) => options.headerFiltersRef?.current ? (
          <FilterableHeader
            column={column}
            filterId="title"
            open={options.headerFiltersRef.current.openFilterId === 'title'}
            onToggle={(filterId) => options.headerFiltersRef?.current?.setOpenFilterId(options.headerFiltersRef.current?.openFilterId === filterId ? null : filterId)}
            label="Title"
            active={Boolean(options.headerFiltersRef.current.title)}
            filterContent={
              <input
                value={options.headerFiltersRef.current.title}
                onChange={(event) => options.headerFiltersRef?.current?.setTitle(event.target.value)}
                placeholder="Filter"
                className="h-7 w-full rounded-none border border-border bg-surface px-2 text-[11px] text-text focus:border-accent focus:outline-none"
              />
            }
          />
        ) : <SortableHeader column={column}>Title</SortableHeader>,
        cell: ({ getValue }) => (
          <div className="max-w-[220px] text-[10px] leading-tight text-text-muted truncate" title={getValue() || '-'}>
            {getValue() || '-'}
          </div>
        ),
        filterFn: (row, _id, value) => (row.original.title?.toLowerCase().includes(value.toLowerCase()) ?? false),
        size: 190,
        minSize: 140,
        maxSize: Number.MAX_SAFE_INTEGER,
        meta: {
          label: 'Title',
          minWidth: 140,
          defaultWidth: 190,
          maxWidth: 280,
          resizable: true,
          align: 'left',
          measureValue: (row: Contact) => row.title || '-',
        },
      }),
      columnHelper.accessor('company_name', {
        header: ({ column }) => options.headerFiltersRef?.current ? (
          <FilterableHeader
            column={column}
            filterId="company_name"
            open={options.headerFiltersRef.current.openFilterId === 'company_name'}
            onToggle={(filterId) => options.headerFiltersRef?.current?.setOpenFilterId(options.headerFiltersRef.current?.openFilterId === filterId ? null : filterId)}
            label="Company"
            active={Boolean(options.headerFiltersRef.current.company)}
            filterContent={
              <input
                value={options.headerFiltersRef.current.company}
                onChange={(event) => options.headerFiltersRef?.current?.setCompany(event.target.value)}
                placeholder="Filter"
                className="h-7 w-full rounded-none border border-border bg-surface px-2 text-[11px] text-text focus:border-accent focus:outline-none"
              />
            }
          />
        ) : <SortableHeader column={column}>Company</SortableHeader>,
        cell: ({ getValue }) => (
          <div className="flex items-center gap-1 text-[10px] leading-tight text-text-muted min-w-0">
            <Building2 className="w-3 h-3 shrink-0" />
            <span className="truncate max-w-[220px]" title={getValue()}>
              {getValue()}
            </span>
          </div>
        ),
        filterFn: (row, _id, value) => row.original.company_name.toLowerCase().includes(value.toLowerCase()),
        size: 210,
        minSize: 160,
        maxSize: Number.MAX_SAFE_INTEGER,
        meta: {
          label: 'Company',
          minWidth: 160,
          defaultWidth: 210,
          maxWidth: 280,
          resizable: true,
          align: 'left',
          measureValue: (row: Contact) => row.company_name,
        },
      }),
      columnHelper.accessor('email', {
        header: ({ column }) => <SortableHeader column={column}>Email</SortableHeader>,
        cell: ({ getValue }) => {
          const email = getValue();
          return email ? (
            <div className="flex items-center gap-1 text-[10px] text-text min-w-0 leading-tight">
              <CheckCircle className="w-3 h-3 text-success shrink-0" />
              <span className="truncate font-mono tracking-tight" title={email}>
                {email}
              </span>
            </div>
          ) : (
            <span className="flex items-center gap-1 text-[10px] text-text-dim leading-tight">
              <XCircle className="w-3 h-3 shrink-0" /> No email
            </span>
          );
        },
        filterFn: (row, _id, value) => {
          const mode = String(value || '').toLowerCase();
          if (!mode) return true;
          const hasEmail = !!row.original.email;
          if (mode === 'yes' || mode === 'has') return hasEmail;
          if (mode === 'no') return !hasEmail;
          return true;
        },
        size: 230,
        minSize: 180,
        maxSize: Number.MAX_SAFE_INTEGER,
        meta: {
          label: 'Email',
          minWidth: 180,
          defaultWidth: 230,
          maxWidth: 320,
          resizable: true,
          align: 'left',
          measureValue: (row: Contact) => row.email || 'No email',
        },
      }),
      columnHelper.accessor('scraped_at', {
        id: 'scraped_at',
        header: ({ column }) => <SortableHeader column={column}>Date Added</SortableHeader>,
        cell: ({ getValue }) => {
          const value = getValue();
          const formatted = formatDateAdded(value);
          return (
            <div className="text-[10px] leading-tight text-text-muted" title={formatted}>
              {formatted}
            </div>
          );
        },
        sortingFn: (rowA, rowB) => {
          const left = rowA.original.scraped_at ? Date.parse(rowA.original.scraped_at) : Number.NaN;
          const right = rowB.original.scraped_at ? Date.parse(rowB.original.scraped_at) : Number.NaN;
          const normalizedLeft = Number.isFinite(left) ? left : Number.NEGATIVE_INFINITY;
          const normalizedRight = Number.isFinite(right) ? right : Number.NEGATIVE_INFINITY;
          return normalizedLeft - normalizedRight;
        },
        size: 112,
        minSize: 112,
        maxSize: Number.MAX_SAFE_INTEGER,
        meta: {
          label: 'Date Added',
          minWidth: 112,
          defaultWidth: 112,
          maxWidth: 160,
          resizable: true,
          align: 'left',
          measureValue: (row: Contact) => formatDateAdded(row.scraped_at),
        },
      })
    );
  }

  columns.push(
    columnHelper.accessor((row) => getContactSourceLabel(row), {
      id: 'lead_source',
      header: ({ column }) => options.headerFiltersRef?.current ? (
        <FilterableHeader
          column={column}
          filterId="lead_source"
          open={options.headerFiltersRef.current.openFilterId === 'lead_source'}
          onToggle={(filterId) => options.headerFiltersRef?.current?.setOpenFilterId(options.headerFiltersRef.current?.openFilterId === filterId ? null : filterId)}
          label="Source"
          active={Boolean(options.headerFiltersRef.current.source)}
          filterContent={
            <select
              value={options.headerFiltersRef.current.source}
              onChange={(event) => options.headerFiltersRef?.current?.setSource(event.target.value)}
              className="h-7 w-full rounded-none border border-border bg-surface px-2 text-[11px] text-text focus:border-accent focus:outline-none"
            >
              <option value="">All</option>
              {options.headerFiltersRef.current.sourceOptions.map((source) => (
                <option key={source} value={source}>
                  {source}
                </option>
              ))}
            </select>
          }
        />
      ) : <SortableHeader column={column}>Source</SortableHeader>,
      cell: ({ getValue }) => {
        const source = (getValue() || 'LinkedIn').toString();
        return (
          <span className="block truncate text-[10px] leading-tight text-text-muted" title={source}>
            {source}
          </span>
        );
      },
      filterFn: (row, _id, value) => {
        const selected = String(value || '')
          .split(',')
          .map((s) => s.trim().toLowerCase())
          .filter(Boolean);
        if (!selected.length) return true;
        const source = getContactSourceLabel(row.original).toLowerCase();
        return selected.includes(source);
      },
      size: compact ? 110 : 110,
      minSize: 96,
      maxSize: Number.MAX_SAFE_INTEGER,
      meta: {
        label: 'Source',
        minWidth: 96,
        defaultWidth: 112,
        maxWidth: 180,
        resizable: true,
        align: 'left',
        measureValue: (row: Contact) => getContactSourceLabel(row),
      },
    }),
    columnHelper.accessor('engagement_status', {
      header: ({ column }) => options.headerFiltersRef?.current ? (
        <FilterableHeader
          column={column}
          filterId="engagement_status"
          open={options.headerFiltersRef.current.openFilterId === 'engagement_status'}
          onToggle={(filterId) => options.headerFiltersRef?.current?.setOpenFilterId(options.headerFiltersRef.current?.openFilterId === filterId ? null : filterId)}
          label="Status"
          active={Boolean(options.headerFiltersRef.current.status)}
          filterContent={
            <select
              value={options.headerFiltersRef.current.status}
              onChange={(event) => options.headerFiltersRef?.current?.setStatus(event.target.value)}
              className="h-7 w-full rounded-none border border-border bg-surface px-2 text-[11px] text-text focus:border-accent focus:outline-none"
            >
              <option value="">All</option>
              <option value="replied">Replied</option>
              <option value="failed">Failed</option>
              <option value="completed">Completed</option>
              <option value="scheduled">Scheduled</option>
              <option value="in_sequence">In Sequence</option>
              <option value="enrolled">Enrolled</option>
              <option value="synced">Synced to Salesforce</option>
              <option value="needs_sync">Needs Sync</option>
            </select>
          }
        />
      ) : <span className="text-[11px] font-medium tracking-wide uppercase">Status</span>,
      cell: ({ row, getValue }) => (
        <div className="flex items-center gap-1.5">
          <EngagementStatusBadge status={getValue()} />
          <SalesforceSyncBadge status={row.original.salesforce_sync_status} />
        </div>
      ),
      filterFn: (row, _id, value) => {
        const filterValue = String(value || '').toLowerCase();
        const status = (row.original.engagement_status || 'needs_sync').toLowerCase();
        return !filterValue || status === filterValue;
      },
      size: compact ? 120 : 84,
      minSize: 96,
      maxSize: Number.MAX_SAFE_INTEGER,
      meta: {
        label: 'Status',
        minWidth: 96,
        defaultWidth: compact ? 120 : 112,
        maxWidth: 160,
        resizable: true,
        align: 'left',
        measureValue: (row: Contact) => `${row.engagement_status || 'needs_sync'} ${row.salesforce_sync_status || ''}`.trim(),
      },
    }),
    columnHelper.display({
      id: 'actions',
      header: () => options.actionsHeader ?? null,
      cell: ({ row }) => <RowActionsMenu contact={row.original} onAddToCampaign={options.onAddToCampaign} onDelete={onDelete} />,
      size: CONTACT_ACTIONS_COLUMN_WIDTH,
      minSize: CONTACT_ACTIONS_COLUMN_WIDTH,
      maxSize: CONTACT_ACTIONS_COLUMN_WIDTH,
      enableResizing: false,
      meta: {
        label: 'Actions',
        minWidth: CONTACT_ACTIONS_COLUMN_WIDTH,
        defaultWidth: CONTACT_ACTIONS_COLUMN_WIDTH,
        maxWidth: CONTACT_ACTIONS_COLUMN_WIDTH,
        resizable: false,
        align: 'right',
        headerClassName: 'sticky right-0 z-20 bg-surface px-0',
        cellClassName: 'sticky right-0 z-40 overflow-visible bg-surface px-0 text-center',
      },
    }),
  );

  if (!compact) {
    // Already added core wide columns in non-compact mode.
  }

  return columns;
}

export const contactColumns = createContactColumns(() => {});
