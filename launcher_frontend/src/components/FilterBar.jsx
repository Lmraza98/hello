import React from "react";
import { X } from "lucide-react";

export default function FilterBar({
  searchRef,
  search,
  setSearch,
  tag,
  setTag,
  selectedSuiteId,
  setSelectedSuiteId,
  suites,
  kind,
  setKind,
  outcome,
  setOutcome,
  aggregateFilterIds = [],
  setAggregateFilterIds,
  aggregateFilterOptions = [],
  activeFilterCount,
  onClearFilters,
}) {
  const selectClass =
    "h-7 rounded-full bg-slate-800/70 px-2 text-xs text-slate-100 outline-none [color-scheme:dark] [&>option]:bg-slate-900 [&>option]:text-slate-100";
  const chipBase = "inline-flex h-7 items-center gap-1 rounded-full border px-2 text-xs";
  const chipIdle = "border-slate-700/70 bg-slate-800/70 text-slate-200";
  const chipActive = "border-blue-500/70 bg-slate-800 text-blue-200 shadow-[0_0_0_1px_rgba(59,130,246,0.35)]";

  return (
    <div className="mb-2">
      <div className="flex w-full flex-wrap items-center gap-2 rounded-xl bg-slate-900/80 px-3 py-2">
        <label className={`inline-flex h-10 min-w-[320px] flex-1 items-center gap-2 rounded-lg px-3 text-base ${search ? "bg-slate-800/80" : "bg-slate-900/30"}`}>
          <span className="text-slate-300">/</span>
          <input
            ref={searchRef}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search cases or files"
            className="min-w-0 flex-1 bg-transparent text-slate-100 outline-none placeholder:text-slate-400"
          />
          {search ? (
            <button type="button" onClick={() => setSearch("")} className="rounded-full bg-slate-700/70 p-0.5 text-slate-200">
              <X className="h-3 w-3" />
            </button>
          ) : null}
        </label>

        <label className={`${chipBase} ${selectedSuiteId ? chipActive : chipIdle}`}>
          <span className="text-slate-300">Suite:</span>
          <select value={selectedSuiteId} onChange={(e) => setSelectedSuiteId(e.target.value)} className={selectClass}>
            <option value="">All</option>
            {suites.map((s) => <option key={s.suiteId} value={s.suiteId}>{s.suiteName}</option>)}
          </select>
          {selectedSuiteId ? (
            <button type="button" onClick={() => setSelectedSuiteId("")} className="rounded-full p-0.5 text-slate-200 hover:bg-slate-700/70" title="Clear suite filter">
              <X className="h-3 w-3" />
            </button>
          ) : null}
        </label>

        {aggregateFilterOptions.length > 0 ? (
          <div className={`${chipBase} ${aggregateFilterIds.length ? chipActive : chipIdle}`}>
            <span className="text-slate-300">Aggregate:</span>
            <select
              value=""
              onChange={(e) => {
                const value = String(e.target.value || "");
                if (!value) return;
                if (!aggregateFilterIds.includes(value)) setAggregateFilterIds([...aggregateFilterIds, value]);
              }}
              className={selectClass}
            >
              <option value="">Add...</option>
              {aggregateFilterOptions
                .filter((row) => !aggregateFilterIds.includes(row.id))
                .map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.name}{typeof row.total === "number" ? ` (${row.total})` : ""}
                  </option>
                ))}
            </select>
            {aggregateFilterIds.map((id) => {
              const row = aggregateFilterOptions.find((r) => r.id === id);
              return (
                <span key={id} className="inline-flex items-center gap-1 rounded-full bg-slate-700/80 px-2 py-0.5 text-[10px] text-slate-100">
                  <span className="max-w-[120px] truncate">{row?.name || id}</span>
                  <button
                    type="button"
                    onClick={() => setAggregateFilterIds(aggregateFilterIds.filter((v) => v !== id))}
                    className="rounded-full p-0.5 hover:bg-slate-600/80"
                    title="Remove aggregate filter"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              );
            })}
            {aggregateFilterIds.length ? (
              <button type="button" onClick={() => setAggregateFilterIds([])} className="rounded-full p-0.5 text-slate-200 hover:bg-slate-700/70" title="Clear all aggregate filters">
                <X className="h-3 w-3" />
              </button>
            ) : null}
          </div>
        ) : null}

        <label className={`${chipBase} ${kind ? chipActive : chipIdle}`}>
          <span className="text-slate-300">Kind:</span>
          <select value={kind} onChange={(e) => setKind(e.target.value)} className={selectClass}>
            <option value="">Any</option>
            <option value="unit">Unit</option>
            <option value="integration">Integration</option>
            <option value="live">Live</option>
            <option value="smoke">Smoke</option>
            <option value="custom">Custom</option>
          </select>
          {kind ? (
            <button type="button" onClick={() => setKind("")} className="rounded-full p-0.5 text-slate-200 hover:bg-slate-700/70" title="Clear kind filter">
              <X className="h-3 w-3" />
            </button>
          ) : null}
        </label>

        <label className={`${chipBase} ${outcome ? chipActive : chipIdle}`}>
          <span className="text-slate-300">Outcome:</span>
          <select value={outcome} onChange={(e) => setOutcome(e.target.value)} className={selectClass}>
            <option value="">Any</option>
            <option value="idle">Idle</option>
            <option value="queued">Queued</option>
            <option value="running">Running</option>
            <option value="passed">Passed</option>
            <option value="failed">Failed</option>
            <option value="canceled">Canceled</option>
            <option value="timed_out">Timed out</option>
          </select>
          {outcome ? (
            <button type="button" onClick={() => setOutcome("")} className="rounded-full p-0.5 text-slate-200 hover:bg-slate-700/70" title="Clear outcome filter">
              <X className="h-3 w-3" />
            </button>
          ) : null}
        </label>

        <label className={`${chipBase} ${tag ? chipActive : chipIdle}`}>
          <span className="text-slate-300">Tag:</span>
          <input value={tag} onChange={(e) => setTag(e.target.value)} placeholder="any" className="w-20 bg-transparent text-slate-100 outline-none placeholder:text-slate-400" />
          {tag ? (
            <button type="button" onClick={() => setTag("")} className="rounded-full p-0.5 text-slate-200 hover:bg-slate-700/70">
              <X className="h-3 w-3" />
            </button>
          ) : null}
        </label>

        {activeFilterCount > 0 ? (
          <button type="button" onClick={onClearFilters} className="ml-auto text-xs text-slate-300 underline-offset-2 hover:text-slate-100 hover:underline">
            Clear
          </button>
        ) : null}
      </div>
    </div>
  );
}
