import { useMemo, useState, useRef, useCallback } from 'react';
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  flexRender,
  createColumnHelper,
  type SortingState,
} from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  clearFunctionGemmaFailures,
  clearFunctionGemmaLabels,
  downloadFunctionGemmaSftJsonlSplit,
  downloadFunctionGemmaFailuresJsonl,
  downloadFunctionGemmaTrainingBundle,
  getFunctionGemmaFailures,
  getFunctionGemmaLabels,
  upsertFunctionGemmaLabel,
  type FunctionGemmaFailureLabel,
  type FunctionGemmaFailureCapture,
} from '../../chat/finetuneCapture';
import { TOOLS } from '../../chat/tools';
import {
  Download,
  RefreshCw,
  Trash2,
  ChevronDown,
  ChevronUp,
  ArrowUpDown,
} from 'lucide-react';
import { useRegisterCapabilities } from '../../capabilities/useRegisterCapabilities';
import { getPageCapability } from '../../capabilities/catalog';

/* ── Constants ─────────────────────────── */

const ROW_HEIGHT = 80;

/* ── Badge ─────────────────────────────── */

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center px-1.5 py-0.5 rounded border border-border text-[11px] text-text-muted leading-tight">
      {children}
    </span>
  );
}

/* ── Stat Pill ─────────────────────────── */

function StatPill({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 bg-surface border border-border rounded-lg text-xs">
      <span className="text-text-muted">{label}</span>
      <span className="font-medium text-text">{value}</span>
    </div>
  );
}

/* ── Get Initial Label ─────────────────── */

function getInitialLabel(
  capture: FunctionGemmaFailureCapture,
  existing?: FunctionGemmaFailureLabel,
) {
  if (existing) {
    return {
      toolName: existing.tool_name,
      argsJson: existing.tool_arguments_json,
      skip: existing.skip,
      notes: existing.notes || '',
    };
  }
  const fromToken = capture.token_tool_calls[0];
  if (fromToken) {
    return {
      toolName: fromToken.name,
      argsJson: JSON.stringify(fromToken.args || {}, null, 2),
      skip: false,
      notes: '',
    };
  }
  const fromNative = capture.native_tool_calls[0];
  if (fromNative) {
    try {
      const parsed = JSON.parse(fromNative.function.arguments || '{}');
      return {
        toolName: fromNative.function.name,
        argsJson: JSON.stringify(parsed, null, 2),
        skip: false,
        notes: '',
      };
    } catch {
      return {
        toolName: fromNative.function.name,
        argsJson: '{}',
        skip: false,
        notes: '',
      };
    }
  }
  return { toolName: '', argsJson: '{}', skip: false, notes: '' };
}

/* ── Inline Label Editor ───────────────── */

function LabelEditor({
  capture,
  saved,
  onSaved,
}: {
  capture: FunctionGemmaFailureCapture;
  saved?: FunctionGemmaFailureLabel;
  onSaved: () => void;
}) {
  const initial = getInitialLabel(capture, saved);
  const [toolName, setToolName] = useState(initial.toolName);
  const [argsJson, setArgsJson] = useState(initial.argsJson);
  const [skip, setSkip] = useState(initial.skip);
  const [notes, setNotes] = useState(initial.notes);
  const [status, setStatus] = useState<string>('');

  const save = () => {
    if (!skip) {
      if (!toolName.trim()) {
        setStatus('Tool is required unless skipped.');
        return;
      }
      try {
        const parsed = JSON.parse(argsJson || '{}');
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          setStatus('Arguments must be a JSON object.');
          return;
        }
      } catch {
        setStatus('Arguments JSON is invalid.');
        return;
      }
    }
    upsertFunctionGemmaLabel({
      id: capture.id,
      tool_name: skip ? '' : toolName.trim(),
      tool_arguments_json: skip ? '{}' : argsJson,
      skip,
      notes: notes.trim() || undefined,
    });
    setStatus('Saved ✓');
    onSaved();
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5">
        <select
          value={toolName}
          onChange={(e) => setToolName(e.target.value)}
          disabled={skip}
          className="flex-1 min-w-0 px-1.5 py-1 text-[11px] rounded border border-border bg-bg text-text disabled:opacity-50"
        >
          <option value="">Select tool</option>
          {TOOLS.map((tool) => (
            <option key={tool.function.name} value={tool.function.name}>
              {tool.function.name}
            </option>
          ))}
        </select>
        <label className="inline-flex items-center gap-1 text-[11px] text-text-muted whitespace-nowrap">
          <input
            type="checkbox"
            checked={skip}
            onChange={(e) => setSkip(e.target.checked)}
          />
          Skip
        </label>
      </div>
      <textarea
        value={argsJson}
        onChange={(e) => setArgsJson(e.target.value)}
        disabled={skip}
        rows={3}
        className="w-full px-1.5 py-1 text-[11px] rounded border border-border bg-bg text-text font-mono disabled:opacity-50 resize-y"
      />
      <div className="flex items-center gap-1.5">
        <input
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Notes"
          className="flex-1 min-w-0 px-1.5 py-1 text-[11px] rounded border border-border bg-bg text-text"
        />
        <button
          onClick={save}
          className="shrink-0 px-2 py-1 rounded border border-border text-[11px] text-text hover:bg-surface-hover font-medium"
        >
          Save
        </button>
      </div>
      {status && (
        <span className="text-[10px] text-text-muted">{status}</span>
      )}
    </div>
  );
}

/* ── Column Definitions ────────────────── */

const columnHelper = createColumnHelper<FunctionGemmaFailureCapture>();

/* ── Main Component ────────────────────── */

export default function AdminFinetune() {
  const [rows, setRows] = useState<FunctionGemmaFailureCapture[]>(() =>
    getFunctionGemmaFailures(),
  );
  const [labels, setLabels] = useState<FunctionGemmaFailureLabel[]>(() =>
    getFunctionGemmaLabels(),
  );
  const [busy, setBusy] = useState(false);
  const [exportStatus, setExportStatus] = useState('');
  const [sorting, setSorting] = useState<SortingState>([
    { id: 'timestamp', desc: true },
  ]);
  const [showStats, setShowStats] = useState(false);
  useRegisterCapabilities(getPageCapability('admin.finetune'));

  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const refresh = () => {
    setRows(getFunctionGemmaFailures());
    setLabels(getFunctionGemmaLabels());
  };

  const labelMap = useMemo(
    () => new Map(labels.map((l) => [l.id, l])),
    [labels],
  );

  const stats = useMemo(() => {
    const byReason: Record<string, number> = {};
    const byTool: Record<string, number> = {};
    let successCount = 0;
    let recoveredCount = 0;
    let failedCount = 0;
    let labeled = 0;
    let skipped = 0;
    for (const row of rows) {
      if ((row.outcome || 'failed') === 'success') successCount += 1;
      if (row.outcome === 'recovered_by_gemma') recoveredCount += 1;
      if (!row.outcome || row.outcome === 'failed') failedCount += 1;

      if (row.failure_reason && row.failure_reason !== 'none') {
        byReason[row.failure_reason] =
          (byReason[row.failure_reason] || 0) + 1;
      }
      for (const t of row.selected_tools) {
        byTool[t] = (byTool[t] || 0) + 1;
      }
      const label = labelMap.get(row.id);
      if (label) {
        labeled += 1;
        if (label.skip) skipped += 1;
      }
    }
    const topReasons = Object.entries(byReason)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
    const topTools = Object.entries(byTool)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8);
    return {
      topReasons,
      topTools,
      successCount,
      recoveredCount,
      failedCount,
      labeled,
      skipped,
      unlabeled: Math.max(0, rows.length - labeled),
    };
  }, [rows, labelMap]);

  /* ── Actions ── */

  const clearAll = () => {
    setBusy(true);
    clearFunctionGemmaFailures();
    clearFunctionGemmaLabels();
    refresh();
    setBusy(false);
  };

  const exportSft = () => {
    const split = downloadFunctionGemmaSftJsonlSplit(0.2, 42);
    setExportStatus(
      `train=${split.train.length}, test=${split.test.length}, skipped=${split.skipped}, invalid=${split.invalid.length}`,
    );
  };

  /* ── TanStack Table columns ── */

  const columns = useMemo(
    () => [
      columnHelper.accessor('timestamp', {
        header: 'Time',
        size: 130,
        cell: (info) => (
          <span className="text-[11px] text-text-muted whitespace-nowrap">
            {new Date(info.getValue()).toLocaleString()}
          </span>
        ),
      }),
      columnHelper.accessor('user_message', {
        header: 'Message',
        size: 200,
        cell: (info) => (
          <span className="text-xs text-text line-clamp-2">
            {info.getValue()}
          </span>
        ),
      }),
      columnHelper.accessor('failure_reason', {
        header: 'Reason',
        size: 160,
        cell: (info) => (
          <span className="text-[11px] text-text-muted font-mono">
            {info.getValue()}
          </span>
        ),
      }),
      columnHelper.accessor('outcome', {
        header: 'Outcome',
        size: 100,
        cell: (info) => {
          const value = info.getValue() || 'failed';
          const label =
            value === 'success'
              ? 'success'
              : value === 'recovered_by_gemma'
                ? 'recovered'
                : 'failed';
          const cls =
            value === 'success'
              ? 'text-emerald-700 border-emerald-200 bg-emerald-50'
              : value === 'recovered_by_gemma'
                ? 'text-amber-700 border-amber-200 bg-amber-50'
                : 'text-red-700 border-red-200 bg-red-50';
          return <span className={`inline-flex px-2 py-0.5 rounded border text-[11px] ${cls}`}>{label}</span>;
        },
      }),
      columnHelper.accessor('selected_tools', {
        header: 'Shortlist',
        size: 220,
        enableSorting: false,
        cell: (info) => (
          <div className="flex flex-wrap gap-0.5">
            {info
              .getValue()
              .slice(0, 6)
              .map((t: string) => (
                <Badge key={t}>{t}</Badge>
              ))}
            {info.getValue().length > 6 && (
              <Badge>+{info.getValue().length - 6}</Badge>
            )}
          </div>
        ),
      }),
      columnHelper.accessor('executed_tools', {
        header: 'Executed',
        size: 180,
        enableSorting: false,
        cell: (info) => {
          const calls = info.getValue() || [];
          if (calls.length === 0) {
            return <span className="text-[11px] text-text-muted">none</span>;
          }
          return (
            <div className="flex flex-wrap gap-0.5">
              {calls.slice(0, 4).map((t: string, idx: number) => (
                <Badge key={`${t}-${idx}`}>{t}</Badge>
              ))}
              {calls.length > 4 && <Badge>+{calls.length - 4}</Badge>}
            </div>
          );
        },
      }),
      columnHelper.accessor('native_tool_calls', {
        header: 'Native',
        size: 60,
        cell: (info) => (
          <span className="text-[11px] text-text-muted text-center block">
            {info.getValue().length}
          </span>
        ),
      }),
      columnHelper.accessor('token_tool_calls', {
        header: 'Token',
        size: 60,
        cell: (info) => (
          <span className="text-[11px] text-text-muted text-center block">
            {info.getValue().length}
          </span>
        ),
      }),
      columnHelper.display({
        id: 'label',
        header: 'Label',
        size: 280,
        cell: (info) => (
          <LabelEditor
            capture={info.row.original}
            saved={labelMap.get(info.row.original.id)}
            onSaved={refresh}
          />
        ),
      }),
    ],
    [labelMap],
  );

  /* ── TanStack Table ── */

  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  const tableRows = table.getRowModel().rows;

  /* ── Virtualizer ── */

  const rowVirtualizer = useVirtualizer({
    count: tableRows.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: useCallback(() => ROW_HEIGHT, []),
    overscan: 10,
  });

  /* ── Column widths for synced header/body ── */

  const colGroup = (
    <colgroup>
      {table.getHeaderGroups()[0]?.headers.map((h) => (
        <col key={h.id} style={{ width: `${h.getSize()}px` }} />
      ))}
    </colgroup>
  );

  /* ── Render ── */

  return (
    <div className="h-full flex flex-col">
      {/* ── Compact Header ── */}
      <div className="shrink-0 px-4 md:px-6 pt-4 pb-3 space-y-2">
        {/* Title row + actions */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-text leading-tight">
              FunctionGemma Fine-tune
            </h2>
            <p className="text-xs text-text-muted mt-0.5">
              Label FunctionGemma tool-route attempts and export SFT artifacts
            </p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end">
            <button
              onClick={refresh}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 border border-border rounded-lg text-xs text-text-muted hover:bg-surface-hover"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Refresh
            </button>
            <button
              onClick={downloadFunctionGemmaFailuresJsonl}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 border border-border rounded-lg text-xs text-text hover:bg-surface-hover"
            >
              <Download className="w-3.5 h-3.5" />
              Captures
            </button>
            <button
              onClick={downloadFunctionGemmaTrainingBundle}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 border border-border rounded-lg text-xs text-text hover:bg-surface-hover"
            >
              <Download className="w-3.5 h-3.5" />
              Bundle
            </button>
            <button
              onClick={exportSft}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 border border-border rounded-lg text-xs text-text hover:bg-surface-hover"
            >
              <Download className="w-3.5 h-3.5" />
              SFT Split
            </button>
            <button
              onClick={clearAll}
              disabled={busy}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 border border-red-300 text-red-600 rounded-lg text-xs hover:bg-red-50 disabled:opacity-50"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Clear
            </button>
          </div>
        </div>

        {/* Inline stats bar + collapsible details */}
        <div className="flex items-center gap-2 flex-wrap">
          <StatPill label="Captures" value={rows.length} />
          <StatPill label="Success" value={stats.successCount} />
          <StatPill label="Recovered" value={stats.recoveredCount} />
          <StatPill label="Failed" value={stats.failedCount} />
          <StatPill
            label="Labeled"
            value={`${stats.labeled}/${rows.length}`}
          />
          <StatPill label="Unlabeled" value={stats.unlabeled} />
          {stats.topReasons[0] && (
            <StatPill
              label="Top reason"
              value={`${stats.topReasons[0][0]} (${stats.topReasons[0][1]})`}
            />
          )}
          {stats.topTools[0] && (
            <StatPill
              label="Top tool"
              value={`${stats.topTools[0][0]} (${stats.topTools[0][1]})`}
            />
          )}
          <button
            onClick={() => setShowStats((v) => !v)}
            className="inline-flex items-center gap-1 px-2 py-1 text-[11px] text-text-muted hover:text-text rounded"
          >
            {showStats ? (
              <>
                <ChevronUp className="w-3 h-3" /> Less
              </>
            ) : (
              <>
                <ChevronDown className="w-3 h-3" /> Pipeline
              </>
            )}
          </button>
          {exportStatus && (
            <span className="text-[11px] text-text-muted ml-auto">
              {exportStatus}
            </span>
          )}
        </div>

        {/* Collapsible pipeline info */}
        {showStats && (
          <div className="text-xs text-text-muted bg-surface border border-border rounded-lg px-3 py-2 space-y-0.5">
            <span className="font-medium text-text text-[11px] uppercase tracking-wide">
              Pipeline
            </span>
            <div>1. Label each captured route row below</div>
            <div>2. Export SFT Train/Test split</div>
            <div>3. Train with the exported JSONL</div>
            <div>4. Keep labeling new captures as they arrive</div>
          </div>
        )}
      </div>

      {/* ── Table ── */}
      <div className="flex-1 min-h-0 px-4 md:px-6 pb-4">
        <div className="bg-surface border border-border rounded-lg overflow-hidden flex flex-col h-full">
          {/* Fixed header */}
          <div className="shrink-0 border-b border-border">
            <table
              className="w-full min-w-[1100px]"
              style={{ tableLayout: 'fixed' }}
            >
              {colGroup}
              <thead>
                {table.getHeaderGroups().map((headerGroup) => (
                  <tr
                    key={headerGroup.id}
                    className="bg-surface-hover/50"
                  >
                    {headerGroup.headers.map((header) => (
                      <th
                        key={header.id}
                        className="text-left px-3 py-2 text-[11px] font-medium text-text-muted uppercase tracking-wider select-none"
                        onClick={header.column.getToggleSortingHandler()}
                        style={{
                          cursor: header.column.getCanSort()
                            ? 'pointer'
                            : 'default',
                        }}
                      >
                        <div className="flex items-center gap-1">
                          {header.isPlaceholder
                            ? null
                            : flexRender(
                                header.column.columnDef.header,
                                header.getContext(),
                              )}
                          {header.column.getCanSort() && (
                            <ArrowUpDown className="w-3 h-3 opacity-40" />
                          )}
                        </div>
                      </th>
                    ))}
                  </tr>
                ))}
              </thead>
            </table>
          </div>

          {/* Virtualized scrollable body */}
          <div ref={scrollContainerRef} className="flex-1 overflow-y-auto">
            {tableRows.length === 0 ? (
              <div className="flex items-center justify-center py-12 text-sm text-text-muted">
                No captures yet.
              </div>
            ) : (
              <div
                style={{
                  height: `${rowVirtualizer.getTotalSize()}px`,
                  position: 'relative',
                  minWidth: '1100px',
                }}
              >
                {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                  const row = tableRows[virtualRow.index];
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
                      <table
                        className="w-full"
                        style={{ tableLayout: 'fixed' }}
                      >
                        {colGroup}
                        <tbody>
                          <tr className="border-b border-border-subtle hover:bg-surface-hover/40 transition-colors align-top">
                            {row.getVisibleCells().map((cell) => (
                              <td key={cell.id} className="px-3 py-2">
                                {flexRender(
                                  cell.column.columnDef.cell,
                                  cell.getContext(),
                                )}
                              </td>
                            ))}
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
