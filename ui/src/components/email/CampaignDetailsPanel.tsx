import { createPortal } from 'react-dom';
import { flexRender, getCoreRowModel, type ColumnDef, useReactTable } from '@tanstack/react-table';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, MoreHorizontal, SlidersHorizontal } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { emailApi } from '../../api/emailApi';
import type { CampaignContact, EmailCampaign, EmailTemplate } from '../../types/email';
import { useNotificationContext } from '../../contexts/NotificationContext';
import {
  FILTERABLE_VIEWPORT_CONTROL_WIDTH,
  SharedTableColGroupWithWidths,
  SharedTableHeader,
  useFittedTableLayout,
  usePersistentColumnSizing,
} from '../shared/resizableDataTable';
import { usePersistentColumnPreferences } from '../shared/usePersistentColumnPreferences';
import { ColumnVisibilityMenu } from '../shared/ColumnVisibilityMenu';
import { TableHeaderFilter } from '../shared/TableHeaderFilter';

type CampaignDetailsPanelProps = {
  campaign: EmailCampaign;
  onClose: () => void;
  onEditTemplates: (campaign: EmailCampaign) => void;
};

const CAMPAIGN_CONTACT_ACTIONS_WIDTH = 44;
const CAMPAIGN_TEMPLATE_ACTIONS_WIDTH = 44;

function formatNextSend(value?: string | null) {
  if (!value) return '-';
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return '-';
  return dt.toLocaleString();
}

function formatCampaignContactStep(item: CampaignContact, totalSteps: number) {
  const currentStep = Math.max(0, Number(item.current_step || 0));
  const maxSteps = Math.max(1, Number(totalSteps || 1));
  if (String(item.status || '').toLowerCase() === 'completed' || currentStep >= maxSteps) return 'Finished';
  return `Step ${currentStep + 1}`;
}

function CampaignContactRowActionsMenu({
  item,
  onRemove,
  disabled,
}: {
  item: CampaignContact;
  onRemove: (campaignContactId: number) => void;
  disabled: boolean;
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
          aria-label={`Open actions for ${item.contact_name}`}
          data-row-control
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
              className="fixed z-[120] w-40 -translate-x-full -translate-y-1/2 rounded-none border border-border bg-surface p-1 shadow-lg"
              style={{ top: `${menuPosition.top}px`, left: `${menuPosition.left}px` }}
              onClick={(event) => event.stopPropagation()}
            >
              <button
                type="button"
                onClick={() => {
                  onRemove(item.id);
                  setOpen(false);
                }}
                disabled={disabled}
                className="block h-8 w-full rounded-none px-2 text-left text-[11px] text-rose-700 hover:bg-rose-50 disabled:opacity-50"
              >
                Delete
              </button>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

function CampaignTemplateRowActionsMenu({
  template,
  onEditTemplates,
}: {
  template: EmailTemplate;
  onEditTemplates: () => void;
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
          aria-label={`Open actions for template step ${template.step_number}`}
          data-row-control
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
                  onEditTemplates();
                  setOpen(false);
                }}
                className="block h-8 w-full rounded-none px-2 text-left text-[11px] text-text hover:bg-surface-hover"
              >
                Edit templates
              </button>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

function CampaignContactsHeaderActionsMenu({
  onEditTemplates,
}: {
  onEditTemplates: () => void;
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
          aria-label="Open enrolled table actions"
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
                  onEditTemplates();
                  setOpen(false);
                }}
                className="block h-8 w-full rounded-none px-2 text-left text-[11px] text-text hover:bg-surface-hover"
              >
                Edit templates
              </button>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

export function CampaignDetailsPanel({ campaign, onClose: _onClose, onEditTemplates: _onEditTemplates }: CampaignDetailsPanelProps) {
  const queryClient = useQueryClient();
  const { addNotification } = useNotificationContext();
  const [contactSearch, setContactSearch] = useState('');
  const [showFiltersMenu, setShowFiltersMenu] = useState(false);
  const [openHeaderFilterId, setOpenHeaderFilterId] = useState<string | null>(null);
  const [nameFilter, setNameFilter] = useState('');
  const [emailFilter, setEmailFilter] = useState('');
  const [stepFilter, setStepFilter] = useState('');
  const [dateTimeFilter, setDateTimeFilter] = useState('');
  const [showTemplateFiltersMenu, setShowTemplateFiltersMenu] = useState(false);
  const [openTemplateHeaderFilterId, setOpenTemplateHeaderFilterId] = useState<string | null>(null);
  const [templateStepFilter, setTemplateStepFilter] = useState('');
  const [templateSubjectFilter, setTemplateSubjectFilter] = useState('');
  const [templateBodyFilter, setTemplateBodyFilter] = useState('');
  const enrolledScrollContainerRef = useRef<HTMLDivElement | null>(null);
  const templateScrollContainerRef = useRef<HTMLDivElement | null>(null);
  const filterRef = useRef<HTMLDivElement | null>(null);
  const templateFilterRef = useRef<HTMLDivElement | null>(null);
  const enrolledTableRef = useRef<any>(null);
  const templatesTableRef = useRef<any>(null);
  const canShiftLeftRef = useRef(false);
  const canShiftRightRef = useRef(false);
  const shiftLeftRef = useRef<() => void>(() => {});
  const shiftRightRef = useRef<() => void>(() => {});
  const canShiftTemplateLeftRef = useRef(false);
  const canShiftTemplateRightRef = useRef(false);
  const shiftTemplateLeftRef = useRef<() => void>(() => {});
  const shiftTemplateRightRef = useRef<() => void>(() => {});
  const [enrolledScrollThumb, setEnrolledScrollThumb] = useState<{ height: number; top: number; visible: boolean }>({
    height: 0,
    top: 0,
    visible: false,
  });
  const [templateScrollThumb, setTemplateScrollThumb] = useState<{ height: number; top: number; visible: boolean }>({
    height: 0,
    top: 0,
    visible: false,
  });

  const enrolledQuery = useQuery({
    queryKey: ['campaignContacts', campaign.id],
    queryFn: () => emailApi.getCampaignContacts(campaign.id),
  });

  const enrolledContacts = useMemo(() => enrolledQuery.data ?? [], [enrolledQuery.data]);
  const templates = useMemo(() => [...(campaign.templates ?? [])].sort((a, b) => a.step_number - b.step_number), [campaign.templates]);

  const filteredEnrolledContacts = useMemo(() => {
    const q = contactSearch.trim().toLowerCase();
    const nameValue = nameFilter.trim().toLowerCase();
    const emailValue = emailFilter.trim().toLowerCase();
    const stepValue = stepFilter.trim().toLowerCase();
    const dateTimeValue = dateTimeFilter.trim().toLowerCase();
    return enrolledContacts.filter((item) => {
      const haystack = [item.contact_name, item.email || '', item.company_name || '', item.title || ''].join(' ').toLowerCase();
      const matchesSearch = !q || haystack.includes(q);
      const matchesName = !nameValue || item.contact_name.toLowerCase().includes(nameValue);
      const matchesEmail = !emailValue || (item.email || '').toLowerCase().includes(emailValue);
      const stepLabel = formatCampaignContactStep(item, campaign.num_emails).toLowerCase();
      const matchesStep = !stepValue || stepLabel.includes(stepValue);
      const dateLabel = formatNextSend(item.next_email_at).toLowerCase();
      const matchesDateTime = !dateTimeValue || dateLabel.includes(dateTimeValue);
      return matchesSearch && matchesName && matchesEmail && matchesStep && matchesDateTime;
    });
  }, [campaign.num_emails, contactSearch, dateTimeFilter, emailFilter, enrolledContacts, nameFilter, stepFilter]);

  const removeMutation = useMutation({
    mutationFn: (campaignContactId: number) => emailApi.removeCampaignContact(campaign.id, campaignContactId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['campaignContacts', campaign.id] });
      queryClient.invalidateQueries({ queryKey: ['emailCampaigns'] });
      queryClient.invalidateQueries({ queryKey: ['emailStats'] });
      addNotification({ type: 'success', title: 'Contact removed from campaign' });
    },
    onError: (err: Error) => {
      addNotification({ type: 'error', title: 'Could not remove contact', message: err.message });
    },
  });

  useEffect(() => {
    function handleClick(event: MouseEvent) {
      if (filterRef.current && !filterRef.current.contains(event.target as Node)) setShowFiltersMenu(false);
    }
    if (showFiltersMenu) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showFiltersMenu]);

  useEffect(() => {
    function handleClick(event: MouseEvent) {
      if (templateFilterRef.current && !templateFilterRef.current.contains(event.target as Node)) setShowTemplateFiltersMenu(false);
    }
    if (showTemplateFiltersMenu) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showTemplateFiltersMenu]);

  const managedColumnIds = useMemo(() => ['contact_name', 'email', 'step', 'next_email_at'], []);
  const { columnOrder: managedColumnOrder, setColumnOrder: setManagedColumnOrder, columnVisibility, setColumnVisibility } = usePersistentColumnPreferences({
    storageKey: `campaign-details-enrolled-${campaign.id}-prefs`,
    columnIds: managedColumnIds,
    initialVisibility: Object.fromEntries(managedColumnIds.map((id) => [id, true])),
  });

  const moveManagedColumn = (columnId: string, delta: -1 | 1) => {
    setManagedColumnOrder((prev) => {
      const index = prev.indexOf(columnId);
      const nextIndex = index + delta;
      if (index < 0 || nextIndex < 0 || nextIndex >= prev.length) return prev;
      const next = [...prev];
      const [item] = next.splice(index, 1);
      next.splice(nextIndex, 0, item);
      return next;
    });
  };

  const columnLabelMap = useMemo(
    () => ({
      contact_name: 'Name',
      email: 'Email',
      step: 'Step',
      next_email_at: 'Date & Time',
    }),
    [],
  );

  const stepOptions = useMemo(
    () =>
      Array.from(new Set(enrolledContacts.map((item) => formatCampaignContactStep(item, campaign.num_emails)))).sort((a, b) => {
        if (a === 'Finished') return 1;
        if (b === 'Finished') return -1;
        return a.localeCompare(b, undefined, { numeric: true });
      }),
    [campaign.num_emails, enrolledContacts],
  );

  const filteredTemplates = useMemo(() => {
    const stepValue = templateStepFilter.trim().toLowerCase();
    const subjectValue = templateSubjectFilter.trim().toLowerCase();
    const bodyValue = templateBodyFilter.trim().toLowerCase();
    return templates.filter((item) => {
      const stepLabel = `Step ${item.step_number}`.toLowerCase();
      const matchesStep = !stepValue || stepLabel.includes(stepValue);
      const matchesSubject = !subjectValue || item.subject_template.toLowerCase().includes(subjectValue);
      const matchesBody = !bodyValue || item.body_template.toLowerCase().includes(bodyValue);
      return matchesStep && matchesSubject && matchesBody;
    });
  }, [templateBodyFilter, templateStepFilter, templateSubjectFilter, templates]);

  const managedTemplateColumnIds = useMemo(() => ['step_number', 'subject_template', 'body_template'], []);
  const {
    columnOrder: managedTemplateColumnOrder,
    setColumnOrder: setManagedTemplateColumnOrder,
    columnVisibility: templateColumnVisibility,
    setColumnVisibility: setTemplateColumnVisibility,
  } = usePersistentColumnPreferences({
    storageKey: `campaign-details-templates-${campaign.id}-prefs`,
    columnIds: managedTemplateColumnIds,
    initialVisibility: Object.fromEntries(managedTemplateColumnIds.map((id) => [id, true])),
  });

  const moveManagedTemplateColumn = (columnId: string, delta: -1 | 1) => {
    setManagedTemplateColumnOrder((prev) => {
      const index = prev.indexOf(columnId);
      const nextIndex = index + delta;
      if (index < 0 || nextIndex < 0 || nextIndex >= prev.length) return prev;
      const next = [...prev];
      const [item] = next.splice(index, 1);
      next.splice(nextIndex, 0, item);
      return next;
    });
  };

  const templateColumnLabelMap = useMemo(
    () => ({
      step_number: 'Step',
      subject_template: 'Subject',
      body_template: 'Body',
    }),
    [],
  );

  const templateStepOptions = useMemo(
    () => Array.from(new Set(templates.map((item) => `Step ${item.step_number}`))).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
    [templates],
  );

  const viewportControls = useMemo(
    () => (
      <div className="relative flex h-full items-center justify-center gap-0.5 bg-surface" ref={filterRef}>
        <button
          type="button"
          onClick={() => setShowFiltersMenu((value) => !value)}
          className="inline-flex h-5 w-5 items-center justify-center rounded-none text-text-muted transition-colors hover:bg-surface-hover hover:text-text"
          title="Columns"
          aria-label="Open visible columns menu"
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
          <ChevronRight className="h-3.5 w-3.5 rotate-180" />
        </button>
        <button
          type="button"
          onClick={() => shiftRightRef.current()}
          disabled={!canShiftRightRef.current}
          aria-label="Show more columns"
          className="inline-flex h-4 w-4 items-center justify-center rounded-sm text-text-muted transition-colors hover:bg-surface-hover hover:text-text disabled:opacity-30"
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
        {showFiltersMenu ? (
          <div className="absolute right-0 top-7 z-20 w-[260px] rounded-none border border-border bg-surface p-3 shadow-lg">
            <ColumnVisibilityMenu
              items={managedColumnOrder.map((columnId, index) => ({
                id: columnId,
                label: columnLabelMap[columnId as keyof typeof columnLabelMap] ?? columnId,
                visible: enrolledTableRef.current?.getColumn(columnId)?.getIsVisible() ?? true,
                canHide: true,
                canMoveUp: index > 0,
                canMoveDown: index < managedColumnOrder.length - 1,
              }))}
              onToggle={(columnId, visible) => {
                enrolledTableRef.current?.getColumn(columnId)?.toggleVisibility(visible);
              }}
              onMoveUp={(columnId) => moveManagedColumn(columnId, -1)}
              onMoveDown={(columnId) => moveManagedColumn(columnId, 1)}
            />
          </div>
        ) : null}
      </div>
    ),
    [columnLabelMap, managedColumnOrder, showFiltersMenu],
  );

  const templateViewportControls = useMemo(
    () => (
      <div className="relative flex h-full items-center justify-center gap-0.5 bg-surface" ref={templateFilterRef}>
        <button
          type="button"
          onClick={() => setShowTemplateFiltersMenu((value) => !value)}
          className="inline-flex h-5 w-5 items-center justify-center rounded-none text-text-muted transition-colors hover:bg-surface-hover hover:text-text"
          title="Columns"
          aria-label="Open template visible columns menu"
        >
          <SlidersHorizontal className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => shiftTemplateLeftRef.current()}
          disabled={!canShiftTemplateLeftRef.current}
          aria-label="Show previous template columns"
          className="inline-flex h-4 w-4 items-center justify-center rounded-sm text-text-muted transition-colors hover:bg-surface-hover hover:text-text disabled:opacity-30"
        >
          <ChevronRight className="h-3.5 w-3.5 rotate-180" />
        </button>
        <button
          type="button"
          onClick={() => shiftTemplateRightRef.current()}
          disabled={!canShiftTemplateRightRef.current}
          aria-label="Show more template columns"
          className="inline-flex h-4 w-4 items-center justify-center rounded-sm text-text-muted transition-colors hover:bg-surface-hover hover:text-text disabled:opacity-30"
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
        {showTemplateFiltersMenu ? (
          <div className="absolute right-0 top-7 z-20 w-[260px] rounded-none border border-border bg-surface p-3 shadow-lg">
            <ColumnVisibilityMenu
              items={managedTemplateColumnOrder.map((columnId, index) => ({
                id: columnId,
                label: templateColumnLabelMap[columnId as keyof typeof templateColumnLabelMap] ?? columnId,
                visible: templatesTableRef.current?.getColumn(columnId)?.getIsVisible() ?? true,
                canHide: true,
                canMoveUp: index > 0,
                canMoveDown: index < managedTemplateColumnOrder.length - 1,
              }))}
              onToggle={(columnId, visible) => {
                templatesTableRef.current?.getColumn(columnId)?.toggleVisibility(visible);
              }}
              onMoveUp={(columnId) => moveManagedTemplateColumn(columnId, -1)}
              onMoveDown={(columnId) => moveManagedTemplateColumn(columnId, 1)}
            />
          </div>
        ) : null}
      </div>
    ),
    [managedTemplateColumnOrder, showTemplateFiltersMenu, templateColumnLabelMap],
  );

  const actionsHeader = useMemo(
    () => (
      <CampaignContactsHeaderActionsMenu onEditTemplates={() => _onEditTemplates(campaign)} />
    ),
    [_onEditTemplates, campaign],
  );

  const toggleHeaderFilter = (filterId: string) => {
    setOpenHeaderFilterId((current) => (current === filterId ? null : filterId));
  };

  const toggleTemplateHeaderFilter = (filterId: string) => {
    setOpenTemplateHeaderFilterId((current) => (current === filterId ? null : filterId));
  };

  const enrolledColumns = useMemo<ColumnDef<CampaignContact>[]>(
    () => [
      {
        id: 'contact_name',
        header: () => (
          <div className="flex items-center gap-1">
            <span>Name</span>
            <TableHeaderFilter
              open={openHeaderFilterId === 'contact_name'}
              active={Boolean(nameFilter)}
              label="Name"
              onToggle={() => toggleHeaderFilter('contact_name')}
            >
              <input
                value={nameFilter}
                onChange={(event) => setNameFilter(event.target.value)}
                placeholder="Filter"
                className="h-7 w-full rounded-none border border-border bg-surface px-2 text-[11px] text-text focus:border-accent focus:outline-none"
              />
            </TableHeaderFilter>
          </div>
        ),
        accessorFn: (row) => row.contact_name,
        cell: ({ row }) => <span className="block truncate text-[11px] font-medium text-text">{row.original.contact_name}</span>,
        size: 172,
        minSize: 148,
        maxSize: Number.MAX_SAFE_INTEGER,
        meta: {
          label: 'Name',
          minWidth: 148,
          defaultWidth: 172,
          maxWidth: 260,
          resizable: true,
          align: 'left',
          measureValue: (row: CampaignContact) => row.contact_name,
        },
      },
      {
        id: 'email',
        header: () => (
          <div className="flex items-center gap-1">
            <span>Email</span>
            <TableHeaderFilter
              open={openHeaderFilterId === 'email'}
              active={Boolean(emailFilter)}
              label="Email"
              onToggle={() => toggleHeaderFilter('email')}
            >
              <input
                value={emailFilter}
                onChange={(event) => setEmailFilter(event.target.value)}
                placeholder="Filter"
                className="h-7 w-full rounded-none border border-border bg-surface px-2 text-[11px] text-text focus:border-accent focus:outline-none"
              />
            </TableHeaderFilter>
          </div>
        ),
        accessorFn: (row) => row.email || '-',
        cell: ({ row }) => <span className="block truncate text-[11px] text-text-muted">{row.original.email || '-'}</span>,
        size: 210,
        minSize: 176,
        maxSize: Number.MAX_SAFE_INTEGER,
        meta: {
          label: 'Email',
          minWidth: 176,
          defaultWidth: 210,
          maxWidth: 320,
          resizable: true,
          align: 'left',
          measureValue: (row: CampaignContact) => row.email || '-',
        },
      },
      {
        id: 'step',
        header: () => (
          <div className="flex items-center gap-1">
            <span>Step</span>
            <TableHeaderFilter
              open={openHeaderFilterId === 'step'}
              active={Boolean(stepFilter)}
              label="Step"
              onToggle={() => toggleHeaderFilter('step')}
              align="right"
            >
              <select
                value={stepFilter}
                onChange={(event) => setStepFilter(event.target.value)}
                className="h-7 w-full rounded-none border border-border bg-surface px-2 text-[11px] text-text focus:border-accent focus:outline-none"
              >
                <option value="">All</option>
                {stepOptions.map((option) => (
                  <option key={option} value={option.toLowerCase()}>
                    {option}
                  </option>
                ))}
              </select>
            </TableHeaderFilter>
          </div>
        ),
        accessorFn: (row) => formatCampaignContactStep(row, campaign.num_emails),
        cell: ({ row }) => <span className="block truncate text-[11px] text-text-muted">{formatCampaignContactStep(row.original, campaign.num_emails)}</span>,
        size: 72,
        minSize: 64,
        maxSize: Number.MAX_SAFE_INTEGER,
        meta: {
          label: 'Step',
          minWidth: 64,
          defaultWidth: 72,
          maxWidth: 90,
          resizable: true,
          align: 'left',
          measureValue: (row: CampaignContact) => formatCampaignContactStep(row, campaign.num_emails),
        },
      },
      {
        id: 'next_email_at',
        header: () => (
          <div className="flex items-center gap-1">
            <span>Date & Time</span>
            <TableHeaderFilter
              open={openHeaderFilterId === 'next_email_at'}
              active={Boolean(dateTimeFilter)}
              label="Date & Time"
              onToggle={() => toggleHeaderFilter('next_email_at')}
              align="right"
            >
              <input
                value={dateTimeFilter}
                onChange={(event) => setDateTimeFilter(event.target.value)}
                placeholder="Filter"
                className="h-7 w-full rounded-none border border-border bg-surface px-2 text-[11px] text-text focus:border-accent focus:outline-none"
              />
            </TableHeaderFilter>
          </div>
        ),
        accessorFn: (row) => formatNextSend(row.next_email_at),
        cell: ({ row }) => <span className="block truncate text-[11px] text-text-muted">{formatNextSend(row.original.next_email_at)}</span>,
        size: 156,
        minSize: 132,
        maxSize: Number.MAX_SAFE_INTEGER,
        meta: {
          label: 'Date & Time',
          minWidth: 132,
          defaultWidth: 156,
          maxWidth: 220,
          resizable: true,
          align: 'left',
          measureValue: (row: CampaignContact) => formatNextSend(row.next_email_at),
        },
      },
      {
        id: 'actions',
        header: () => actionsHeader,
        cell: ({ row }) => (
          <CampaignContactRowActionsMenu
            item={row.original}
            onRemove={(campaignContactId) => removeMutation.mutate(campaignContactId)}
            disabled={removeMutation.isPending}
          />
        ),
        size: CAMPAIGN_CONTACT_ACTIONS_WIDTH,
        minSize: CAMPAIGN_CONTACT_ACTIONS_WIDTH,
        maxSize: CAMPAIGN_CONTACT_ACTIONS_WIDTH,
        enableResizing: false,
        meta: {
          label: 'Actions',
          minWidth: CAMPAIGN_CONTACT_ACTIONS_WIDTH,
          defaultWidth: CAMPAIGN_CONTACT_ACTIONS_WIDTH,
          maxWidth: CAMPAIGN_CONTACT_ACTIONS_WIDTH,
          resizable: false,
          align: 'right',
          headerClassName: 'sticky right-0 z-20 bg-surface px-0',
          cellClassName: 'sticky right-0 z-40 overflow-visible bg-surface px-0 text-center',
        },
      },
    ],
    [actionsHeader, campaign.num_emails, dateTimeFilter, emailFilter, nameFilter, openHeaderFilterId, removeMutation, stepFilter, stepOptions],
  );

  const templateActionsHeader = useMemo(
    () => <CampaignContactsHeaderActionsMenu onEditTemplates={() => _onEditTemplates(campaign)} />,
    [_onEditTemplates, campaign],
  );

  const templateColumns = useMemo<ColumnDef<EmailTemplate>[]>(
    () => [
      {
        id: 'step_number',
        header: () => (
          <div className="flex items-center gap-1">
            <span>Step</span>
            <TableHeaderFilter
              open={openTemplateHeaderFilterId === 'step_number'}
              active={Boolean(templateStepFilter)}
              label="Step"
              onToggle={() => toggleTemplateHeaderFilter('step_number')}
              align="right"
            >
              <select
                value={templateStepFilter}
                onChange={(event) => setTemplateStepFilter(event.target.value)}
                className="h-7 w-full rounded-none border border-border bg-surface px-2 text-[11px] text-text focus:border-accent focus:outline-none"
              >
                <option value="">All</option>
                {templateStepOptions.map((option) => (
                  <option key={option} value={option.toLowerCase()}>
                    {option}
                  </option>
                ))}
              </select>
            </TableHeaderFilter>
          </div>
        ),
        accessorFn: (row) => `Step ${row.step_number}`,
        cell: ({ row }) => <span className="block truncate text-[11px] text-text-muted">{`Step ${row.original.step_number}`}</span>,
        size: 76,
        minSize: 68,
        maxSize: Number.MAX_SAFE_INTEGER,
        meta: {
          label: 'Step',
          minWidth: 68,
          defaultWidth: 76,
          maxWidth: 96,
          resizable: true,
          align: 'left',
          measureValue: (row: EmailTemplate) => `Step ${row.step_number}`,
        },
      },
      {
        id: 'subject_template',
        header: () => (
          <div className="flex items-center gap-1">
            <span>Subject</span>
            <TableHeaderFilter
              open={openTemplateHeaderFilterId === 'subject_template'}
              active={Boolean(templateSubjectFilter)}
              label="Subject"
              onToggle={() => toggleTemplateHeaderFilter('subject_template')}
            >
              <input
                value={templateSubjectFilter}
                onChange={(event) => setTemplateSubjectFilter(event.target.value)}
                placeholder="Filter"
                className="h-7 w-full rounded-none border border-border bg-surface px-2 text-[11px] text-text focus:border-accent focus:outline-none"
              />
            </TableHeaderFilter>
          </div>
        ),
        accessorFn: (row) => row.subject_template,
        cell: ({ row }) => <span className="block truncate text-[11px] font-medium text-text">{row.original.subject_template}</span>,
        size: 210,
        minSize: 164,
        maxSize: Number.MAX_SAFE_INTEGER,
        meta: {
          label: 'Subject',
          minWidth: 164,
          defaultWidth: 210,
          maxWidth: 320,
          resizable: true,
          align: 'left',
          measureValue: (row: EmailTemplate) => row.subject_template,
        },
      },
      {
        id: 'body_template',
        header: () => (
          <div className="flex items-center gap-1">
            <span>Body</span>
            <TableHeaderFilter
              open={openTemplateHeaderFilterId === 'body_template'}
              active={Boolean(templateBodyFilter)}
              label="Body"
              onToggle={() => toggleTemplateHeaderFilter('body_template')}
              align="right"
            >
              <input
                value={templateBodyFilter}
                onChange={(event) => setTemplateBodyFilter(event.target.value)}
                placeholder="Filter"
                className="h-7 w-full rounded-none border border-border bg-surface px-2 text-[11px] text-text focus:border-accent focus:outline-none"
              />
            </TableHeaderFilter>
          </div>
        ),
        accessorFn: (row) => row.body_template,
        cell: ({ row }) => <span className="block truncate text-[11px] text-text-muted">{row.original.body_template}</span>,
        size: 268,
        minSize: 180,
        maxSize: Number.MAX_SAFE_INTEGER,
        meta: {
          label: 'Body',
          minWidth: 180,
          defaultWidth: 268,
          maxWidth: 420,
          resizable: true,
          align: 'left',
          measureValue: (row: EmailTemplate) => row.body_template,
        },
      },
      {
        id: 'actions',
        header: () => templateActionsHeader,
        cell: ({ row }) => <CampaignTemplateRowActionsMenu template={row.original} onEditTemplates={() => _onEditTemplates(campaign)} />,
        size: CAMPAIGN_TEMPLATE_ACTIONS_WIDTH,
        minSize: CAMPAIGN_TEMPLATE_ACTIONS_WIDTH,
        maxSize: CAMPAIGN_TEMPLATE_ACTIONS_WIDTH,
        enableResizing: false,
        meta: {
          label: 'Actions',
          minWidth: CAMPAIGN_TEMPLATE_ACTIONS_WIDTH,
          defaultWidth: CAMPAIGN_TEMPLATE_ACTIONS_WIDTH,
          maxWidth: CAMPAIGN_TEMPLATE_ACTIONS_WIDTH,
          resizable: false,
          align: 'right',
          headerClassName: 'sticky right-0 z-20 bg-surface px-0',
          cellClassName: 'sticky right-0 z-40 overflow-visible bg-surface px-0 text-center',
        },
      },
    ],
    [
      _onEditTemplates,
      campaign,
      openTemplateHeaderFilterId,
      templateActionsHeader,
      templateBodyFilter,
      templateStepFilter,
      templateStepOptions,
      templateSubjectFilter,
    ],
  );

  const { columnSizing: enrolledColumnSizing, setColumnSizing: setEnrolledColumnSizing, autoFitColumn: autoFitEnrolledColumn } = usePersistentColumnSizing({
    columns: enrolledColumns,
    rows: filteredEnrolledContacts,
    storageKey: `campaign-details-enrolled-${campaign.id}`,
  });

  const enrolledTable = useReactTable({
    data: filteredEnrolledContacts,
    columns: enrolledColumns,
    state: {
      columnSizing: enrolledColumnSizing,
      columnVisibility,
      columnOrder: [...managedColumnOrder, 'actions'],
    },
    onColumnSizingChange: setEnrolledColumnSizing,
    onColumnVisibilityChange: setColumnVisibility,
    onColumnOrderChange: (updater) => {
      setManagedColumnOrder((prev) => {
        const current = [...prev, 'actions'];
        const next = typeof updater === 'function' ? updater(current) : updater;
        const orderedManaged = next.filter((id) => managedColumnIds.includes(id));
        managedColumnIds.forEach((id) => {
          if (!orderedManaged.includes(id)) orderedManaged.push(id);
        });
        return orderedManaged;
      });
    },
    getRowId: (row) => String(row.id),
    getCoreRowModel: getCoreRowModel(),
    columnResizeMode: 'onChange',
  });
  enrolledTableRef.current = enrolledTable;

  const {
    columnSizing: templateColumnSizing,
    setColumnSizing: setTemplateColumnSizing,
    autoFitColumn: autoFitTemplateColumn,
  } = usePersistentColumnSizing({
    columns: templateColumns,
    rows: filteredTemplates,
    storageKey: `campaign-details-templates-${campaign.id}`,
  });

  const templatesTable = useReactTable({
    data: filteredTemplates,
    columns: templateColumns,
    state: {
      columnSizing: templateColumnSizing,
      columnVisibility: templateColumnVisibility,
      columnOrder: [...managedTemplateColumnOrder, 'actions'],
    },
    onColumnSizingChange: setTemplateColumnSizing,
    onColumnVisibilityChange: setTemplateColumnVisibility,
    onColumnOrderChange: (updater) => {
      setManagedTemplateColumnOrder((prev) => {
        const current = [...prev, 'actions'];
        const next = typeof updater === 'function' ? updater(current) : updater;
        const orderedManaged = next.filter((id) => managedTemplateColumnIds.includes(id));
        managedTemplateColumnIds.forEach((id) => {
          if (!orderedManaged.includes(id)) orderedManaged.push(id);
        });
        return orderedManaged;
      });
    },
    getRowId: (row) => String(row.id),
    getCoreRowModel: getCoreRowModel(),
    columnResizeMode: 'onChange',
  });
  templatesTableRef.current = templatesTable;

  const {
    containerRef: enrolledTableContainerRef,
    columnWidths: enrolledColumnWidths,
    visibleColumnIds: enrolledVisibleColumnIds,
    tableStyle: enrolledTableStyle,
    fillWidth: enrolledFillWidth,
    canShiftLeft: canShiftEnrolledLeft,
    canShiftRight: canShiftEnrolledRight,
    shiftLeft: shiftEnrolledLeft,
    shiftRight: shiftEnrolledRight,
  } = useFittedTableLayout(enrolledTable, { controlWidth: FILTERABLE_VIEWPORT_CONTROL_WIDTH });

  canShiftLeftRef.current = canShiftEnrolledLeft;
  canShiftRightRef.current = canShiftEnrolledRight;
  shiftLeftRef.current = shiftEnrolledLeft;
  shiftRightRef.current = shiftEnrolledRight;

  const {
    containerRef: templatesTableContainerRef,
    columnWidths: templateColumnWidths,
    visibleColumnIds: templateVisibleColumnIds,
    tableStyle: templateTableStyle,
    fillWidth: templateFillWidth,
    canShiftLeft: canShiftTemplatesLeft,
    canShiftRight: canShiftTemplatesRight,
    shiftLeft: shiftTemplatesLeft,
    shiftRight: shiftTemplatesRight,
  } = useFittedTableLayout(templatesTable, { controlWidth: FILTERABLE_VIEWPORT_CONTROL_WIDTH });

  canShiftTemplateLeftRef.current = canShiftTemplatesLeft;
  canShiftTemplateRightRef.current = canShiftTemplatesRight;
  shiftTemplateLeftRef.current = shiftTemplatesLeft;
  shiftTemplateRightRef.current = shiftTemplatesRight;

  useEffect(() => {
    const container = enrolledScrollContainerRef.current;
    if (!container) return;

    const updateThumb = () => {
      const { scrollHeight, clientHeight, scrollTop } = container;
      if (scrollHeight <= clientHeight + 1) {
        setEnrolledScrollThumb((prev) =>
          prev.visible || prev.height !== 0 || prev.top !== 0 ? { height: 0, top: 0, visible: false } : prev,
        );
        return;
      }

      const ratio = clientHeight / scrollHeight;
      const height = Math.max(40, Math.round(clientHeight * ratio));
      const maxTop = Math.max(0, clientHeight - height);
      const top = maxTop * (scrollTop / Math.max(1, scrollHeight - clientHeight));

      setEnrolledScrollThumb((prev) =>
        prev.height === height && prev.top === top && prev.visible
          ? prev
          : { height, top, visible: true },
      );
    };

    updateThumb();
    container.addEventListener('scroll', updateThumb, { passive: true });
    window.addEventListener('resize', updateThumb);

    return () => {
      container.removeEventListener('scroll', updateThumb);
      window.removeEventListener('resize', updateThumb);
    };
  }, [filteredEnrolledContacts.length]);

  useEffect(() => {
    const container = templateScrollContainerRef.current;
    if (!container) return;

    const updateThumb = () => {
      const { scrollHeight, clientHeight, scrollTop } = container;
      if (scrollHeight <= clientHeight + 1) {
        setTemplateScrollThumb((prev) =>
          prev.visible || prev.height !== 0 || prev.top !== 0 ? { height: 0, top: 0, visible: false } : prev,
        );
        return;
      }

      const ratio = clientHeight / scrollHeight;
      const height = Math.max(40, Math.round(clientHeight * ratio));
      const maxTop = Math.max(0, clientHeight - height);
      const top = maxTop * (scrollTop / Math.max(1, scrollHeight - clientHeight));

      setTemplateScrollThumb((prev) =>
        prev.height === height && prev.top === top && prev.visible ? prev : { height, top, visible: true },
      );
    };

    updateThumb();
    container.addEventListener('scroll', updateThumb, { passive: true });
    window.addEventListener('resize', updateThumb);

    return () => {
      container.removeEventListener('scroll', updateThumb);
      window.removeEventListener('resize', updateThumb);
    };
  }, [filteredTemplates.length]);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="sticky top-0 z-20 shrink-0 border-b border-border bg-surface">
        <div className="px-3 pb-2">
          <h3 className="truncate text-sm font-semibold text-text">{campaign.name}</h3>
          <p className="truncate text-xs text-text-muted">{campaign.description || 'Campaign details'}</p>
        </div>
        <div className="flex items-center gap-1.5 px-3 pb-2">
          <span className="inline-flex h-5 items-center rounded-full border border-border bg-bg px-2 text-[11px] text-text-muted capitalize">
            {campaign.status || 'draft'}
          </span>
          <span className="inline-flex h-5 items-center rounded-full border border-border bg-bg px-2 text-[11px] text-text-muted">
            {campaign.num_emails} steps
          </span>
          <span className="inline-flex h-5 items-center rounded-full border border-border bg-bg px-2 text-[11px] text-text-muted">
            {campaign.days_between_emails} day cadence
          </span>
          <span className="inline-flex h-5 items-center rounded-full border border-border bg-bg px-2 text-[11px] text-text-muted">
            {enrolledContacts.length} enrolled
          </span>
        </div>
      </div>

      <div className="min-h-0 flex flex-1 flex-col overflow-hidden text-xs">
        <section className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <input
            value={contactSearch}
            onChange={(event) => setContactSearch(event.target.value)}
            placeholder="Search contacts by name, email, company"
            className="h-[31px] w-full shrink-0 rounded-none border-none bg-surface px-2.5 text-xs text-text placeholder:text-xs placeholder:text-text-dim focus:outline-none"
          />

          <div className="min-h-0 flex flex-1 flex-col overflow-hidden">
            <div className="min-h-0 flex flex-1 flex-col">
              <div ref={enrolledTableContainerRef} className="flex h-full min-h-0 flex-col border border-border bg-bg/30 overflow-hidden">
                <div className="flex h-[31px] shrink-0 items-center justify-between border-b border-border bg-surface px-2.5">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">Enrolled</span>
                  <div className="flex h-full items-center justify-center">{viewportControls}</div>
                </div>
                <div className="min-h-0 flex-1 overflow-hidden">
                  {enrolledQuery.isLoading ? (
                    <p className="px-2.5 py-1.5 text-[11px] text-text-muted">Loading enrolled contacts...</p>
                  ) : filteredEnrolledContacts.length === 0 ? (
                    <p className="px-2.5 py-1.5 text-[11px] text-text-muted">No enrolled contacts.</p>
                  ) : (
                    <div className="flex h-full min-h-0 flex-col">
                      <table className="w-full border-collapse" style={enrolledTableStyle}>
                        <SharedTableColGroupWithWidths
                          table={enrolledTable}
                          columnWidths={enrolledColumnWidths}
                          visibleColumnIds={enrolledVisibleColumnIds}
                          fillerWidth={enrolledFillWidth}
                          controlWidth={FILTERABLE_VIEWPORT_CONTROL_WIDTH}
                        />
                        <SharedTableHeader
                          table={enrolledTable}
                          onAutoFitColumn={autoFitEnrolledColumn}
                          visibleColumnIds={enrolledVisibleColumnIds}
                          columnWidths={enrolledColumnWidths}
                          fillerWidth={enrolledFillWidth}
                          controlWidth={FILTERABLE_VIEWPORT_CONTROL_WIDTH}
                        />
                      </table>
                      <div className="relative min-h-0 flex-1">
                        <div ref={enrolledScrollContainerRef} className="no-scrollbar h-full min-h-0 overflow-y-auto overflow-x-hidden">
                          <table className="w-full border-collapse" style={enrolledTableStyle}>
                            <SharedTableColGroupWithWidths
                              table={enrolledTable}
                              columnWidths={enrolledColumnWidths}
                              visibleColumnIds={enrolledVisibleColumnIds}
                              fillerWidth={enrolledFillWidth}
                              controlWidth={FILTERABLE_VIEWPORT_CONTROL_WIDTH}
                            />
                            <tbody>
                              {enrolledTable.getRowModel().rows.map((row) => {
                                const cells = row.getVisibleCells().filter((cell) => enrolledVisibleColumnIds.includes(cell.column.id));
                                const trailingActionsCell =
                                  cells.length > 0 && cells[cells.length - 1]?.column.id === 'actions' ? cells[cells.length - 1] : null;
                                const leadingCells = trailingActionsCell ? cells.slice(0, -1) : cells;
                                return (
                                  <tr key={row.id} className="h-[31px] border-b border-border-subtle hover:bg-surface-hover/60">
                                    {leadingCells.map((cell, index) => (
                                      <td
                                        key={cell.id}
                                        className={`min-w-0 overflow-hidden px-3 py-0 align-middle text-[11px] leading-tight ${
                                          index === leadingCells.length - 1 && !trailingActionsCell ? '__shared-last__' : ''
                                        }`}
                                      >
                                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                                      </td>
                                    ))}
                                    {enrolledFillWidth > 0 && !trailingActionsCell ? <td aria-hidden="true" className="h-[31px] px-0 py-0" /> : null}
                                    {trailingActionsCell ? (
                                      <td key={trailingActionsCell.id} className="h-[31px] min-w-0 overflow-visible bg-surface px-0 py-0 align-middle text-center">
                                        {flexRender(trailingActionsCell.column.columnDef.cell, trailingActionsCell.getContext())}
                                      </td>
                                    ) : null}
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                        {enrolledScrollThumb.visible ? (
                          <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-0 w-2">
                            <div className="absolute right-0 w-1.5 rounded-full bg-slate-200/75" style={{ top: `${enrolledScrollThumb.top}px`, height: `${enrolledScrollThumb.height}px` }} />
                          </div>
                        ) : null}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
            <div className="min-h-0 flex flex-1 flex-col border-t border-border">
              <div ref={templatesTableContainerRef} className="flex h-full min-h-0 flex-col border border-t-0 border-border bg-bg/30 overflow-hidden">
                <div className="flex h-[31px] shrink-0 items-center justify-between border-b border-border bg-surface px-2.5">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">Templates</span>
                  <div className="flex h-full items-center justify-center">{templateViewportControls}</div>
                </div>
                <div className="min-h-0 flex-1 overflow-hidden">
                  {filteredTemplates.length === 0 ? (
                    <p className="px-2.5 py-1.5 text-[11px] text-text-muted">No linked templates.</p>
                  ) : (
                    <div className="flex h-full min-h-0 flex-col">
                      <table className="w-full border-collapse" style={templateTableStyle}>
                        <SharedTableColGroupWithWidths
                          table={templatesTable}
                          columnWidths={templateColumnWidths}
                          visibleColumnIds={templateVisibleColumnIds}
                          fillerWidth={templateFillWidth}
                          controlWidth={FILTERABLE_VIEWPORT_CONTROL_WIDTH}
                        />
                        <SharedTableHeader
                          table={templatesTable}
                          onAutoFitColumn={autoFitTemplateColumn}
                          visibleColumnIds={templateVisibleColumnIds}
                          columnWidths={templateColumnWidths}
                          fillerWidth={templateFillWidth}
                          controlWidth={FILTERABLE_VIEWPORT_CONTROL_WIDTH}
                        />
                      </table>
                      <div className="relative min-h-0 flex-1">
                        <div ref={templateScrollContainerRef} className="no-scrollbar h-full min-h-0 overflow-y-auto overflow-x-hidden">
                          <table className="w-full border-collapse" style={templateTableStyle}>
                            <SharedTableColGroupWithWidths
                              table={templatesTable}
                              columnWidths={templateColumnWidths}
                              visibleColumnIds={templateVisibleColumnIds}
                              fillerWidth={templateFillWidth}
                              controlWidth={FILTERABLE_VIEWPORT_CONTROL_WIDTH}
                            />
                            <tbody>
                              {templatesTable.getRowModel().rows.map((row) => {
                                const cells = row.getVisibleCells().filter((cell) => templateVisibleColumnIds.includes(cell.column.id));
                                const trailingActionsCell =
                                  cells.length > 0 && cells[cells.length - 1]?.column.id === 'actions' ? cells[cells.length - 1] : null;
                                const leadingCells = trailingActionsCell ? cells.slice(0, -1) : cells;
                                return (
                                  <tr key={row.id} className="h-[31px] border-b border-border-subtle hover:bg-surface-hover/60">
                                    {leadingCells.map((cell, index) => (
                                      <td
                                        key={cell.id}
                                        className={`min-w-0 overflow-hidden px-3 py-0 align-middle text-[11px] leading-tight ${
                                          index === leadingCells.length - 1 && !trailingActionsCell ? '__shared-last__' : ''
                                        }`}
                                      >
                                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                                      </td>
                                    ))}
                                    {templateFillWidth > 0 && !trailingActionsCell ? <td aria-hidden="true" className="h-[31px] px-0 py-0" /> : null}
                                    {trailingActionsCell ? (
                                      <td key={trailingActionsCell.id} className="h-[31px] min-w-0 overflow-visible bg-surface px-0 py-0 align-middle text-center">
                                        {flexRender(trailingActionsCell.column.columnDef.cell, trailingActionsCell.getContext())}
                                      </td>
                                    ) : null}
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                        {templateScrollThumb.visible ? (
                          <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-0 w-2">
                            <div className="absolute right-0 w-1.5 rounded-full bg-slate-200/75" style={{ top: `${templateScrollThumb.top}px`, height: `${templateScrollThumb.height}px` }} />
                          </div>
                        ) : null}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </section>

      </div>
    </div>
  );
}
