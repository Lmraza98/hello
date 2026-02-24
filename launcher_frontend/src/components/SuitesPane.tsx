import React from "react";
import { ChevronDown, ChevronRight, Play } from "lucide-react";
import StatusBadge from "./StatusBadge";

export default function SuitesPane({
  filteredSuites,
  collapsedSuites,
  setCollapsedSuites,
  handleRun,
  statusById,
  selectedTestId,
  selectedCaseIds,
  setSelectedCaseIds,
  setSelectedTestId,
  setSelectedSuiteId,
  setDrawerOpen,
}) {
  const suiteCount = filteredSuites.length;
  const caseCount = filteredSuites.reduce((sum, suite) => sum + suite.cases.length, 0);

  return (
    <section className="flex h-full flex-col min-h-0 overflow-hidden">
      <div className="shrink-0 mb-3 flex items-center justify-between border-b border-slate-800/80 pb-3 text-sm">
        <div className="font-semibold tracking-wide text-slate-200">Suites & Files</div>
        <div className="text-[11px] font-medium text-slate-500 bg-slate-900/50 px-2 py-0.5 rounded-full ring-1 ring-slate-800/60">
          {suiteCount} suite{suiteCount !== 1 ? 's' : ''}, {caseCount} case{caseCount !== 1 ? 's' : ''}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto overflow-x-hidden pr-2 space-y-3 pb-4">
        {filteredSuites.map((suite) => {
          const collapsed = collapsedSuites[suite.suiteId] ?? false;
          return (
            <div key={suite.suiteId} className="flex flex-col gap-1">
              <div className="group flex items-center justify-between rounded-md px-1.5 py-1 transition-colors hover:bg-slate-900/40">
                <button
                  type="button"
                  onClick={() => {
                    setSelectedSuiteId(suite.suiteId);
                    setCollapsedSuites((prev) => ({ ...prev, [suite.suiteId]: !collapsed }));
                  }}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                >
                  <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-sm bg-slate-800/50 text-slate-400 group-hover:text-slate-200 group-hover:bg-slate-800 transition-colors">
                    {collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                  </div>
                  <div className="truncate text-[13px] font-semibold text-slate-200">{suite.suiteName}</div>
                  <div className="rounded-full bg-slate-800/60 px-1.5 py-0.5 text-[9px] font-medium text-slate-400">
                    {suite.cases.length}
                  </div>
                </button>
                <button 
                  type="button" 
                  onClick={() => void handleRun(suite.cases.map((c) => c.id))} 
                  className="shrink-0 rounded flex h-6 w-6 items-center justify-center border border-blue-500/30 bg-blue-500/10 text-blue-400 opacity-0 transition-all hover:bg-blue-500/20 group-hover:opacity-100" 
                  title="Run suite"
                >
                  <Play className="h-3 w-3 ml-0.5" />
                </button>
              </div>
              {!collapsed && suite.cases.length > 0 ? (
                <div className="ml-3 space-y-0.5 border-l border-slate-800/60 pl-3">
                  {suite.cases.map((row) => {
                    const rowStatus = statusById[row.id]?.status || "idle";
                    const isSelected = selectedTestId === row.id;
                    const checked = selectedCaseIds.has(row.id);
                    return (
                      <div 
                        key={row.id} 
                        className={`group flex items-center justify-between gap-3 rounded-md px-2.5 py-2 text-xs transition-colors ${isSelected ? "bg-blue-900/20 ring-1 ring-blue-500/30" : "hover:bg-slate-900/60"}`}
                      >
                        <button 
                          type="button" 
                          onClick={() => { setSelectedTestId(row.id); setSelectedSuiteId(row.suite_id); setDrawerOpen(false); }} 
                          className="min-w-0 flex-1 text-left flex flex-col justify-center"
                        >
                          <div className={`truncate ${isSelected ? "font-medium text-blue-100" : "text-slate-300 group-hover:text-slate-200"}`}>
                            {row.name}
                          </div>
                          <div className={`mt-0.5 truncate text-[10px] ${isSelected ? "text-blue-300/70" : "text-slate-500"}`}>
                            {row.file_path || row.id}
                          </div>
                        </button>
                        <div className="flex shrink-0 items-center gap-2.5">
                          <button 
                            type="button" 
                            onClick={() => void handleRun([row.id])} 
                            className="flex h-5 w-5 items-center justify-center rounded-full bg-blue-500/10 text-blue-400 opacity-0 transition-all hover:bg-blue-500/20 group-hover:opacity-100" 
                            title="Run test"
                          >
                            <Play className="h-2.5 w-2.5 ml-0.5" />
                          </button>
                          <StatusBadge status={rowStatus} showIdleText={isSelected} />
                          <label className="flex h-5 w-5 cursor-pointer items-center justify-center">
                            <input 
                              type="checkbox" 
                              className="h-3.5 w-3.5 rounded border-slate-700 bg-slate-900/50 text-blue-500 focus:ring-blue-500/30 focus:ring-offset-0"
                              checked={checked} 
                              onChange={(e) => setSelectedCaseIds((prev) => {
                                const next = new Set(prev);
                                if (e.target.checked) next.add(row.id);
                                else next.delete(row.id);
                                return next;
                              })} 
                            />
                          </label>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}
