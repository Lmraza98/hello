import React from "react";
import FilterBar from "../../components/FilterBar";
import LastRunStrip from "../../components/LastRunStrip";
import SuitesPane from "../../components/SuitesPane";
import CasesPane from "../../components/CasesPane";
import DetailsPane from "../../components/DetailsPane";
import { Z_GRAPH_UI, Z_PANE } from "../../lib/zIndex";
import RunHistorySection from "./RunHistorySection";

export default function TestsView(props) {
  const {
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
    aggregateFilterIds,
    setAggregateFilterIds,
    aggregateFilterOptions,
    activeFilterCount,
    clearFilters,
    latestRun,
    statusById,
    handleStop,
    layoutRef,
    detailsInline,
    suitesMinPx,
    casesMinPx,
    detailsMinPx,
    layout,
    DIVIDER_PX,
    startDrag,
    aggregateScopedSuites,
    collapsedSuites,
    setCollapsedSuites,
    handleRun,
    selectedTestId,
    selectedCaseIds,
    setSelectedCaseIds,
    setSelectedTestId,
    setDrawerOpen,
    visibleCases,
    selectedCase,
    setSelectedCaseId,
    triageActive,
    drawerOpen,
    OVERLAY_DETAILS_MIN_PX,
    overlayDetailsMaxWidth,
    detailsSelectedCase,
    bridge,
    tests,
    runs,
    logs,
    selectedRunId,
    handleSelectRun,
    runInspector,
    runHistoryCollapsed,
    setRunHistoryCollapsed,
    showArtifactsPopoverFor,
    setShowArtifactsPopoverFor,
  } = props;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-4">
      <FilterBar
        searchRef={searchRef}
        search={search}
        setSearch={setSearch}
        tag={tag}
        setTag={setTag}
        selectedSuiteId={selectedSuiteId}
        setSelectedSuiteId={setSelectedSuiteId}
        suites={suites}
        kind={kind}
        setKind={setKind}
        outcome={outcome}
        setOutcome={setOutcome}
        aggregateFilterIds={aggregateFilterIds}
        setAggregateFilterIds={setAggregateFilterIds}
        aggregateFilterOptions={aggregateFilterOptions}
        activeFilterCount={activeFilterCount}
        onClearFilters={clearFilters}
      />
      <LastRunStrip latestRun={latestRun} statusById={statusById} onStopRun={() => void handleStop("terminate_workers")} />
      <div ref={layoutRef} className="min-h-0 flex-1 overflow-hidden">
        <div className="flex h-full min-h-0 flex-col">
          <div className="relative min-h-0 flex-1">
            <div
              className="grid h-full min-h-0"
              style={
                detailsInline
                  ? {
                      gridTemplateColumns: `minmax(${suitesMinPx}px, ${layout.suites}fr) ${DIVIDER_PX}px minmax(${casesMinPx}px, ${layout.cases}fr) ${DIVIDER_PX}px minmax(${detailsMinPx}px, ${Math.max(1, layout.details)}fr)`,
                    }
                  : {
                      gridTemplateColumns: `minmax(${Math.min(suitesMinPx, 220)}px, ${layout.suites}fr) ${DIVIDER_PX}px minmax(${Math.min(casesMinPx, 260)}px, ${Math.max(1, layout.cases)}fr)`,
                    }
              }
            >
              <div className="min-h-0 min-w-0 pr-2">
                <SuitesPane
                  filteredSuites={aggregateScopedSuites}
                  collapsedSuites={collapsedSuites}
                  setCollapsedSuites={setCollapsedSuites}
                  handleRun={handleRun}
                  statusById={statusById}
                  selectedTestId={selectedTestId}
                  selectedCaseIds={selectedCaseIds}
                  setSelectedCaseIds={setSelectedCaseIds}
                  setSelectedTestId={setSelectedTestId}
                  setSelectedSuiteId={setSelectedSuiteId}
                  setDrawerOpen={setDrawerOpen}
                />
              </div>
              <div role="separator" aria-orientation="vertical" onPointerDown={(e) => startDrag("v1", e)} className="group relative cursor-col-resize touch-none" style={{ zIndex: Z_GRAPH_UI }}>
                <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-slate-700 group-hover:bg-blue-400" />
              </div>
              <div className="min-h-0 min-w-0 px-2">
                <CasesPane
                  visibleCases={visibleCases}
                  selectedCase={selectedCase}
                  statusById={statusById}
                  setSelectedCaseId={setSelectedCaseId}
                  setDrawerOpen={setDrawerOpen}
                  onRunCase={(caseId) => void handleRun([caseId])}
                  showDetailsButton={!detailsInline}
                  onOpenDetails={() => setDrawerOpen(true)}
                  triageActive={triageActive}
                />
              </div>
              {detailsInline ? (
                <>
                  <div role="separator" aria-orientation="vertical" onPointerDown={(e) => startDrag("v2", e)} className="group relative cursor-col-resize touch-none" style={{ zIndex: Z_GRAPH_UI }}>
                    <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-slate-700 group-hover:bg-blue-400" />
                  </div>
                  <div className="min-h-0 min-w-0 overflow-hidden pl-2">
                    <DetailsPane
                      drawerOpen={drawerOpen}
                      selectedCase={detailsSelectedCase}
                      setDrawerOpen={setDrawerOpen}
                      bridge={bridge}
                      tests={tests}
                      statusById={statusById}
                      runs={runs}
                      logs={logs}
                      selectedRunId={selectedRunId}
                      onSelectRun={(runId) => handleSelectRun(runId, { scope: false })}
                      runInspector={runInspector}
                    />
                  </div>
                </>
              ) : null}
            </div>
            {!detailsInline && drawerOpen ? (
              <div className="absolute inset-y-0 right-0 min-h-0 overflow-hidden border-l border-slate-700 bg-slate-950/95 pl-2 shadow-2xl" style={{ width: `${Math.max(OVERLAY_DETAILS_MIN_PX, Math.min(layout.detailsOverlayWidth, overlayDetailsMaxWidth))}px`, zIndex: Z_PANE }}>
                <div role="separator" aria-orientation="vertical" onPointerDown={(e) => startDrag("ov", e)} className="group absolute bottom-0 left-0 top-0 w-[10px] -translate-x-1/2 cursor-col-resize touch-none" style={{ zIndex: Z_PANE + 1 }}>
                  <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-slate-700 group-hover:bg-blue-400" />
                </div>
                <DetailsPane
                  drawerOpen={drawerOpen}
                  selectedCase={detailsSelectedCase}
                  setDrawerOpen={setDrawerOpen}
                  bridge={bridge}
                  tests={tests}
                  statusById={statusById}
                  runs={runs}
                  logs={logs}
                  selectedRunId={selectedRunId}
                  onSelectRun={(runId) => handleSelectRun(runId, { scope: false })}
                  runInspector={runInspector}
                />
              </div>
            ) : null}
          </div>
          <RunHistorySection
            collapsed={runHistoryCollapsed}
            setCollapsed={setRunHistoryCollapsed}
            heightPx={layout.artifactsHeight}
            onStartResize={(e) => startDrag("h", e)}
            runs={runs}
            showArtifactsPopoverFor={showArtifactsPopoverFor}
            setShowArtifactsPopoverFor={setShowArtifactsPopoverFor}
            bridge={bridge}
            selectedRunId={selectedRunId}
            onSelectRun={(runId) => handleSelectRun(runId, { scope: Boolean(runId) })}
          />
        </div>
      </div>
    </div>
  );
}
