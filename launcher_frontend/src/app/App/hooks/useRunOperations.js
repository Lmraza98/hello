import { useEffect } from "react";
import { useBridgePolling } from "./useBridgePolling";
import { useRunController } from "./useRunController";

export function useRunOperations(params) {
  const {
    bridge,
    liveMode,
    anyRunActive,
    statusResetActive,
    selectedRunId,
    activeRunId,
    setLogs,
    setStartup,
    setTests,
    setStatusById,
    setRuns,
    setActiveRunId,
    setSelectedRunId,
    setWaitingFirstEvent,
    setLastRunUpdateTs,
    setStatusResetActive,
    setSelectedSuiteId,
    setSelectedTestId,
    setSelectedCaseId,
    lastRunUpdateTs,
    loadingRun,
    setLoadingRun,
    idsForRun,
    runtimeDebug,
    graphState,
    graphScope,
    manualGraphChildId,
    graphDetailChildId,
    setPreviewBusy,
    setPreviewLine,
    activeRunRow,
    runs,
    setPausedRunState,
    pausedRunState,
    hasPausedRun,
    tests,
    runAutoTrackRef,
    setRunScopeEnabled,
    setLiveMode,
    setFollowActivePaused,
    setGraphScope,
    setChildScopeEvents,
    setChildProgressByParent,
    setShowUtilityMenu,
    tab,
    setDrawerOpen,
    setGraphDetailsOpen,
  } = params;

  const { refreshAll } = useBridgePolling({
    bridge,
    liveMode,
    anyRunActive,
    statusResetActive,
    selectedRunId,
    activeRunId,
    setLogs,
    setStartup,
    setTests,
    setStatusById,
    setRuns,
    setActiveRunId,
    setSelectedRunId,
    setWaitingFirstEvent,
    setLastRunUpdateTs,
    setStatusResetActive,
    setSelectedSuiteId,
    setSelectedTestId,
    setSelectedCaseId,
    lastRunUpdateTs,
  });

  async function handleStop(mode) {
    if (!bridge) return;
    if (bridge.stop) await bridge.stop(mode);
    else if (mode === "after_current") await bridge.cancel_current_test();
    else await bridge.cancel_run();
    if (mode !== "after_current") {
      setStatusById((prev) => {
        const next = { ...prev };
        Object.keys(next).forEach((id) => {
          next[id] = {
            ...(next[id] || {}),
            status: "not_run",
            duration: null,
            attempt: null,
            message: "",
            started_at: null,
            finished_at: null,
          };
        });
        return next;
      });
      setSelectedRunId(null);
      setRunScopeEnabled(false);
      setWaitingFirstEvent(false);
      setFollowActivePaused(false);
      setGraphScope((prev) => ({ ...prev, childId: "" }));
    }
    await refreshAll();
  }

  const runController = useRunController({
    bridge,
    loadingRun,
    setLoadingRun,
    idsForRun,
    runtimeDebug,
    graphState,
    graphScope,
    manualGraphChildId,
    graphDetailChildId,
    setStatusById,
    setLastRunUpdateTs,
    setPreviewBusy,
    setPreviewLine,
    activeRunRow,
    runs,
    setPausedRunState,
    handleStop,
    pausedRunState,
    hasPausedRun,
    tests,
    runAutoTrackRef,
    setActiveRunId,
    setSelectedRunId,
    setRunScopeEnabled,
    setLiveMode,
    setStatusResetActive,
    setWaitingFirstEvent,
    setFollowActivePaused,
    setGraphScope,
    refreshAll,
    anyRunActive,
    setChildScopeEvents,
    setChildProgressByParent,
    setShowUtilityMenu,
  });

  useEffect(() => {
    if (tab === "graph") {
      setDrawerOpen(false);
      setGraphDetailsOpen(Boolean(graphState.selectedNodeId));
    }
  }, [tab, graphState.selectedNodeId, setGraphDetailsOpen, setDrawerOpen]);

  return { ...runController, handleStop };
}
