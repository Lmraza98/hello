import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { usePageContext } from '../contexts/PageContextProvider';
import { normalizeQueryFilterParam } from '../utils/filterNormalization';
import {
  useReactTable,
  getCoreRowModel,
  getFilteredRowModel,
  getExpandedRowModel,
  getSortedRowModel,
  flexRender,
  type ColumnFiltersState,
  type SortingState,
  type ExpandedState,
} from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useIsMobile } from '../hooks/useIsMobile';
import { useCompanies } from '../hooks/useCompanies';
import { AddCompanyModal } from '../components/companies/AddCompanyModal';
import { CompanyDetail } from '../components/companies/CompanyDetail';
import { CompaniesFilterPanel } from '../components/companies/CompaniesFilterPanel';
import { CompanyCard } from '../components/companies/CompanyCard';
import { SearchToolbar } from '../components/shared/SearchToolbar';
import { PageHeader } from '../components/shared/PageHeader';
import { EmptyState } from '../components/shared/EmptyState';
import { LoadingSpinner } from '../components/shared/LoadingSpinner';
import { ConfirmDialog } from '../components/shared/ConfirmDialog';
import { createCompanyColumns } from '../components/companies/tableColumns';
import { Upload, Building2, Plus, RotateCcw, X, Trash2 } from 'lucide-react';
import { useRegisterCapabilities } from '../capabilities/useRegisterCapabilities';
import { getPageCapability } from '../capabilities/catalog';

/* ── Constants ─────────────────────────── */

const ROW_HEIGHT = 52;
const EXPANDED_HEIGHT = 160;

/* ── Main Component ────────────────────────────────────── */

export default function Companies({ openAddModal, onModalOpened }: { openAddModal?: boolean; onModalOpened?: () => void }) {
  const isMobile = useIsMobile();
  const location = useLocation();
  const { setPageContext } = usePageContext();
  const {
    companies,
    companiesLoading: isLoading,
    addCompany,
    deleteCompany,
    bulkDeleteCompanies,
    resetCompanies,
    importCompanies,
  } = useCompanies();

  const [showAddModal, setShowAddModal] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<{ id: number; name: string } | null>(null);
  const [showBulkDeleteConfirm, setShowBulkDeleteConfirm] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [globalFilter, setGlobalFilter] = useState('');
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [sorting, setSorting] = useState<SortingState>([]);
  const [expanded, setExpanded] = useState<ExpandedState>({});
  const [rowSelection, setRowSelection] = useState<Record<string, boolean>>({});
  useRegisterCapabilities(getPageCapability('companies'));
  const fileInputRef = useRef<HTMLInputElement>(null);
  const filterRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (openAddModal) {
      setShowAddModal(true);
      onModalOpened?.();
    }
  }, [openAddModal, onModalOpened]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    setGlobalFilter(params.get('q') || '');
    const nextFilters: ColumnFiltersState = [];
    const company = normalizeQueryFilterParam('company', params.get('company'));
    const vertical = normalizeQueryFilterParam('vertical', params.get('vertical'));
    const tier = normalizeQueryFilterParam('tier', params.get('tier'));
    if (company) nextFilters.push({ id: 'company_name', value: company });
    if (vertical) nextFilters.push({ id: 'vertical', value: vertical });
    if (tier) nextFilters.push({ id: 'tier', value: tier });
    setColumnFilters(nextFilters);
  }, [location.search]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (filterRef.current && !filterRef.current.contains(e.target as Node)) setShowFilters(false);
    }
    if (showFilters && !isMobile) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showFilters, isMobile]);

  /* ── Columns ── */

  const columns = useMemo(
    () => createCompanyColumns((id, name) => {
      setConfirmDelete({ id, name });
    }),
    []
  );

  /* ── Table ── */

  const table = useReactTable({
    data: companies,
    columns,
    state: { globalFilter, columnFilters, sorting, expanded, rowSelection },
    onGlobalFilterChange: setGlobalFilter,
    onColumnFiltersChange: setColumnFilters,
    onSortingChange: setSorting,
    onExpandedChange: setExpanded,
    onRowSelectionChange: setRowSelection,
    getRowId: (row) => String(row.id),
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getExpandedRowModel: getExpandedRowModel(),
    globalFilterFn: (row, _id, filterValue) =>
      row.original.company_name.toLowerCase().includes(filterValue.toLowerCase()),
  });

  const { rows } = table.getRowModel();
  const filteredCount = table.getFilteredRowModel().rows.length;
  const selectedIds = Object.keys(rowSelection).map(Number);
  const selectedCount = selectedIds.length;
  const activeFilterCount = columnFilters.length;

  /* ── Virtualizer ── */

  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: useCallback(
      (index: number) => rows[index]?.getIsExpanded() ? ROW_HEIGHT + EXPANDED_HEIGHT : ROW_HEIGHT,
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [rows, expanded],
    ),
    overscan: 20,
  });

  // Re-measure all rows when expanded state changes
  useEffect(() => {
    rowVirtualizer.measure();
  }, [expanded, rowVirtualizer]);

  /* ── File import ── */

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const result = await importCompanies(file);
      alert(`Imported ${result.imported} companies`);
    } catch {
      alert('Import failed');
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  /* ── Bulk delete ── */

  const handleBulkDelete = () => {
    if (selectedCount === 0) return;
    setShowBulkDeleteConfirm(true);
  };

  const confirmBulkDelete = () => {
    bulkDeleteCompanies.mutate(selectedIds, {
      onSuccess: () => {
        setRowSelection({});
        setShowBulkDeleteConfirm(false);
      },
    });
  };

  /* ── Column widths for synced header/body ── */

  const colWidths = table.getHeaderGroups()[0]?.headers.map((h) =>
    h.column.id === 'company_name' ? undefined : h.getSize()
  ) ?? [];

  const colGroup = !isMobile ? (
    <colgroup>
      {table.getHeaderGroups()[0]?.headers.map((h, i) => (
        <col key={h.id} style={{ width: colWidths[i] ? `${colWidths[i]}px` : undefined }} />
      ))}
    </colgroup>
  ) : null;

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const selectedCompanyId = Number(params.get('selectedCompanyId'));
    setPageContext({
      listContext: 'companies',
      selected: Number.isFinite(selectedCompanyId) ? { companyId: selectedCompanyId } : {},
      loadedIds: { companyIds: companies.slice(0, 200).map((c) => c.id) },
    });
  }, [companies, location.search, setPageContext]);

  /* ── Render ── */

  return (
    <div className="h-full flex flex-col bg-surface">
      {/* Header */}
      <div className="sticky top-0 z-10 pb-3 md:pb-6">
        <div className="pt-5 px-4 md:pt-8 md:px-8">
          <input ref={fileInputRef} type="file" accept=".csv" onChange={handleFileUpload} className="hidden" />
          <PageHeader
            title="Companies"
            subtitle={`${companies.length} companies${filteredCount !== companies.length ? ` · ${filteredCount} shown` : ''}`}
            desktopActions={
              <>
                <button
                  onClick={() => setShowResetConfirm(true)}
                  className="flex items-center gap-2 px-4 py-2 border border-border text-text-muted rounded-lg text-sm font-medium hover:bg-surface-hover transition-colors"
                >
                  <RotateCcw className="w-4 h-4" /> Reset All
                </button>
                <button
                  onClick={() => setShowAddModal(true)}
                  className="flex items-center gap-2 px-4 py-2 border border-border text-text rounded-lg text-sm font-medium hover:bg-surface-hover transition-colors"
                >
                  <Plus className="w-4 h-4" /> Add
                </button>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="flex items-center gap-2 px-4 py-2 bg-accent text-white rounded-lg text-sm font-medium hover:bg-accent-hover transition-colors"
                >
                  <Upload className="w-4 h-4" /> Import CSV
                </button>
              </>
            }
            mobileActions={
              <>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="p-2 bg-accent text-white rounded-lg hover:bg-accent-hover transition-colors"
                >
                  <Upload className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setShowAddModal(true)}
                  className="p-2 border border-border text-text rounded-lg hover:bg-surface-hover transition-colors"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </>
            }
          />

          {/* Bulk Actions Bar */}
          {selectedCount > 0 && (
            <div className="mb-3 p-3 bg-indigo-50 border border-indigo-200 rounded-lg">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-xs md:text-sm font-medium text-indigo-900 mr-1">{selectedCount} selected</span>
                <button
                  onClick={handleBulkDelete}
                  className="flex items-center gap-1 px-2 py-1.5 border border-red-300 text-red-700 rounded-md text-xs font-medium hover:bg-red-50 transition-colors"
                >
                  <Trash2 className="w-3 h-3" />
                  <span className="hidden md:inline">Delete</span>
                </button>
              </div>
            </div>
          )}

          {/* Toolbar */}
          <div ref={filterRef}>
            <SearchToolbar
              allSelected={table.getIsAllRowsSelected()}
              onToggleSelectAll={table.getToggleAllRowsSelectedHandler()}
              displayCount={selectedCount > 0 ? selectedCount : filteredCount}
              globalFilter={globalFilter}
              onGlobalFilterChange={setGlobalFilter}
              activeFilterCount={activeFilterCount}
              showFilters={showFilters && !isMobile}
              onToggleFilters={() => setShowFilters((v) => !v)}
              filterPanelContent={
                <CompaniesFilterPanel
                  columnFilters={columnFilters}
                  setColumnFilters={setColumnFilters}
                  companies={companies}
                  onClose={() => setShowFilters(false)}
                  isMobile={false}
                />
              }
            />
          </div>

          {/* Filter pills — scrollable on mobile */}
          {activeFilterCount > 0 && (
            <div className="flex items-center gap-1.5 mt-2 overflow-x-auto no-scrollbar">
              {columnFilters.map((f) => (
                <span key={f.id} className="inline-flex items-center gap-1 px-2 py-0.5 bg-accent/10 text-accent rounded-full text-[11px] font-medium whitespace-nowrap shrink-0">
                  {f.id}: {String(f.value)}
                  <button onClick={() => setColumnFilters((prev) => prev.filter((cf) => cf.id !== f.id))} className="hover:text-accent/70">
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Mobile filter bottom sheet */}
      {showFilters && isMobile && (
        <CompaniesFilterPanel
          columnFilters={columnFilters}
          setColumnFilters={setColumnFilters}
          companies={companies}
          onClose={() => setShowFilters(false)}
          isMobile
        />
      )}

      {/* Virtualized Table / List */}
      <div className="flex-1 min-h-0 px-4 md:px-8 pb-4 md:pb-8">
        {isLoading ? (
          <LoadingSpinner />
        ) : (
          <div className="bg-surface border border-border rounded-lg overflow-hidden flex flex-col h-full">
            {/* Desktop: fixed thead — ONLY on desktop */}
            {!isMobile && (
              <div className="shrink-0">
                <table className="w-full" style={{ tableLayout: 'fixed' }}>
                  {colGroup}
                  <thead>
                    {table.getHeaderGroups().map((headerGroup) => (
                      <tr key={headerGroup.id} className="border-b border-border bg-surface-hover/50">
                        {headerGroup.headers.map((header) => (
                          <th key={header.id}
                            className="text-left px-4 py-3 text-xs font-medium text-text-muted uppercase tracking-wider">
                            {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                          </th>
                        ))}
                      </tr>
                    ))}
                  </thead>
                </table>
              </div>
            )}

            {/* Scrollable virtualized body */}
            <div ref={scrollContainerRef} className="flex-1 overflow-y-auto">
              {rows.length === 0 ? (
                <EmptyState
                  icon={Building2}
                  title="No companies found"
                  description="Try adjusting your filters or add a new company"
                  action={{ label: 'Add Company', icon: Plus, onClick: () => setShowAddModal(true) }}
                />
              ) : (
                <div style={{ height: `${rowVirtualizer.getTotalSize()}px`, position: 'relative' }}>
                  {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                    const row = rows[virtualRow.index];
                    const isExpanded = row.getIsExpanded();
                    const company = row.original;

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
                        {isMobile ? (
                          /* ── Mobile: Card layout ── */
                          <CompanyCard
                            company={company}
                            isSelected={row.getIsSelected()}
                            isExpanded={isExpanded}
                            onToggleSelect={() => row.toggleSelected()}
                            onToggleExpand={() => row.toggleExpanded()}
                          />
                        ) : (
                          /* ── Desktop: Table row ── */
                          <table className="w-full" style={{ tableLayout: 'fixed' }}>
                            {colGroup}
                            <tbody>
                              <tr
                                className={`transition-colors cursor-pointer group border-b border-border-subtle ${
                                  row.getIsSelected() ? 'bg-accent/10' : 'hover:bg-surface-hover/60'
                                }`}
                                onClick={(e) => {
                                  if ((e.target as HTMLElement).closest('button, input[type="checkbox"]')) return;
                                  row.toggleExpanded();
                                }}
                              >
                                {row.getVisibleCells().map((cell) => (
                                  <td key={cell.id} className="px-4 py-3.5">
                                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                                  </td>
                                ))}
                              </tr>
                              {isExpanded && (
                                <tr className="bg-surface-hover/30 border-b border-border-subtle">
                                  <td colSpan={row.getVisibleCells().length} className="p-0">
                                    <div className="px-6 py-4 overflow-x-auto">
                                      <CompanyDetail company={company} />
                                    </div>
                                  </td>
                                </tr>
                              )}
                            </tbody>
                          </table>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {showAddModal && (
        <AddCompanyModal
          onAdd={(data) => {
            addCompany.mutate(data, {
              onSuccess: () => setShowAddModal(false),
            });
          }}
          onClose={() => setShowAddModal(false)}
        />
      )}

      <ConfirmDialog
        open={!!confirmDelete}
        title={`Delete ${confirmDelete?.name ?? 'company'}?`}
        message="This company and its data will be permanently removed."
        confirmLabel="Delete"
        variant="danger"
        onConfirm={() => {
          if (confirmDelete) deleteCompany.mutate(confirmDelete.id);
          setConfirmDelete(null);
        }}
        onCancel={() => setConfirmDelete(null)}
      />

      <ConfirmDialog
        open={showResetConfirm}
        title="Reset all companies?"
        message="This will reset every company back to pending status."
        confirmLabel="Reset All"
        variant="danger"
        onConfirm={() => {
          resetCompanies.mutate();
          setShowResetConfirm(false);
        }}
        onCancel={() => setShowResetConfirm(false)}
      />

      <ConfirmDialog
        open={showBulkDeleteConfirm}
        title={`Delete ${selectedCount} compan${selectedCount !== 1 ? 'ies' : 'y'}?`}
        message="This action cannot be undone. The selected companies will be permanently removed."
        confirmLabel="Delete"
        variant="danger"
        onConfirm={confirmBulkDelete}
        onCancel={() => setShowBulkDeleteConfirm(false)}
      />
    </div>
  );
}
