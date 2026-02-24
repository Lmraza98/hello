import React, { useEffect, useMemo, useRef, useState } from "react";
import { PanelRightOpen } from "lucide-react";
import CaseTreeList from "./CaseTreeList";
import { buildCaseTree, buildDefaultExpandedSet } from "../lib/caseTree";

export default function CasesPane({
  visibleCases,
  selectedCase,
  statusById,
  setSelectedCaseId,
  setDrawerOpen,
  onRunCase,
  showDetailsButton = false,
  onOpenDetails,
  triageActive = false,
}) {
  const [groupMode, setGroupMode] = useState(() => {
    try {
      return localStorage.getItem("launcher.cases.groupMode") || "path";
    } catch {
      return "path";
    }
  });
  const [manualGroupOverride, setManualGroupOverride] = useState(() => {
    try {
      return localStorage.getItem("launcher.cases.groupManual") === "1";
    } catch {
      return false;
    }
  });
  const effectiveGroupMode = manualGroupOverride ? groupMode : triageActive ? "outcome" : "path";
  const enrichedCases = useMemo(
    () =>
      visibleCases.map((row) => ({
        ...row,
        parentDuration: statusById[row.testId]?.duration ?? null,
      })),
    [visibleCases, statusById]
  );

  const { root, mode, hasAnyTags } = useMemo(
    () => buildCaseTree({ cases: enrichedCases, statusById, groupMode: effectiveGroupMode }),
    [enrichedCases, statusById, effectiveGroupMode]
  );

  const [expanded, setExpanded] = useState(() => new Set());
  const lastModeRef = useRef(mode);
  useEffect(() => {
    const autoExpanded = buildDefaultExpandedSet({
      root,
      selectedCaseId: selectedCase?.id || "",
      expandFailedBranches: mode === "outcome",
    });
    setExpanded((prev) => {
      // Reset only when grouping mode changes; otherwise preserve user-expanded branches.
      if (lastModeRef.current !== mode) {
        lastModeRef.current = mode;
        return autoExpanded;
      }
      if (!prev.size) return autoExpanded;
      const merged = new Set(prev);
      autoExpanded.forEach((id) => merged.add(id));
      return merged;
    });
  }, [root, selectedCase?.id, mode]);

  function updateMode(nextMode) {
    setGroupMode(nextMode);
    setManualGroupOverride(true);
    try {
      localStorage.setItem("launcher.cases.groupMode", nextMode);
      localStorage.setItem("launcher.cases.groupManual", "1");
    } catch {}
  }

  const modeOptions = [
    { id: "path", label: "Path" },
    { id: "suite", label: "Suite" },
    { id: "outcome", label: "Outcome" },
    ...(hasAnyTags ? [{ id: "tag", label: "Tag" }] : []),
  ];

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden border-l border-slate-800/70 pl-3 pr-1">
      <div className="sticky top-0 z-10 mb-2 flex items-center justify-between bg-slate-950/95 py-1">
        <div className="flex items-center gap-2">
          <div className="text-sm font-semibold text-slate-200">Cases</div>
          <div className="text-xs text-slate-300">{visibleCases.length}</div>
          <label className="inline-flex items-center gap-1 rounded-full bg-slate-800/70 px-2 py-0.5 text-[11px] text-slate-200">
            Group:
            <select
              value={effectiveGroupMode}
              onChange={(e) => updateMode(e.target.value)}
              className="rounded-full bg-transparent text-[11px] text-slate-100 outline-none"
            >
              {modeOptions.map((m) => (
                <option key={m.id} value={m.id}>{m.label}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="flex items-center gap-2">
          {showDetailsButton ? (
            <button type="button" onClick={onOpenDetails} className="inline-flex items-center gap-1 rounded-md border border-slate-700 px-2 py-0.5 text-[11px] text-slate-200">
              <PanelRightOpen className="h-3.5 w-3.5" />
              Details
            </button>
          ) : null}
        </div>
      </div>
      {!visibleCases.length ? <div className="text-xs text-slate-500">No discovered cases for selected test.</div> : null}
      {visibleCases.length ? (
        <CaseTreeList
          root={root}
          expanded={expanded}
          setExpanded={setExpanded}
          selectedCaseId={selectedCase?.id || ""}
          onSelectCase={setSelectedCaseId}
          onRunCase={onRunCase}
          setDrawerOpen={setDrawerOpen}
        />
      ) : null}
    </section>
  );
}
