import { useCallback, useEffect } from "react";

/**
 * Poll launcher bridge state and reconcile frontend run/test snapshots.
 * Keeps the original cadence behavior:
 * - 700ms when live mode is on or a run is active
 * - 1200ms otherwise
 */
export function useBridgePolling({
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
}) {
  const refreshAll = useCallback(async () => {
    if (!bridge) return;
    const [logText, startupState, testRows, statusRows, runRows] = await Promise.all([
      bridge.get_logs(),
      bridge.get_startup_state(),
      bridge.get_tests(),
      bridge.get_test_status(),
      bridge.get_runs(),
    ]);
    setLogs(logText || "");
    setStartup(startupState || null);
    setTests(testRows || []);
    const hasActiveSelection = Boolean(selectedRunId || activeRunId);
    if (!statusResetActive || hasActiveSelection) {
      setStatusById(statusRows || {});
    } else {
      setStatusById({});
    }
    setRuns(runRows || []);
    const runningRun = (runRows || []).find((row) => ["running", "queued", "retrying"].includes(String(row?.status || "").toLowerCase()));
    const currentRunRow = activeRunId ? (runRows || []).find((row) => String(row?.run_id || "") === String(activeRunId)) : null;
    const hasProgress = Object.values(statusRows || {}).some((row) => {
      const st = String(row?.status || "").toLowerCase();
      return ["running", "queued", "retrying", "passed", "failed", "timed_out", "canceled"].includes(st);
    });
    if (runningRun?.run_id && hasProgress) {
      setActiveRunId(String(runningRun.run_id));
      if (!selectedRunId) setSelectedRunId(String(runningRun.run_id));
    } else if (!currentRunRow) {
      setWaitingFirstEvent(false);
      setActiveRunId("");
    }
    const sawActiveRun = Boolean(currentRunRow || (runningRun?.run_id && String(runningRun.run_id) === String(activeRunId)));
    if (hasProgress || sawActiveRun) {
      setLastRunUpdateTs(Date.now());
      setWaitingFirstEvent(false);
    }
    if (runningRun?.run_id || hasActiveSelection) {
      setStatusResetActive(false);
    }
    const rows = testRows || [];
    const availableSuiteIds = new Set(rows.map((r) => r.suite_id));
    const availableTestIds = new Set(rows.map((r) => r.id));
    setSelectedSuiteId((prev) => {
      if (prev && availableSuiteIds.has(prev)) return prev;
      return "";
    });
    setSelectedTestId((prev) => {
      if (prev && availableTestIds.has(prev)) return prev;
      return "";
    });
    setSelectedCaseId((prev) => (prev ? prev : ""));
  }, [
    bridge,
    selectedRunId,
    activeRunId,
    statusResetActive,
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
  ]);

  useEffect(() => {
    if (!bridge) return;
    void refreshAll();
    const intervalMs = liveMode || anyRunActive ? 700 : 1200;
    const id = window.setInterval(() => void refreshAll(), intervalMs);
    return () => window.clearInterval(id);
  }, [bridge, liveMode, anyRunActive, statusResetActive, selectedRunId, activeRunId, refreshAll]);

  useEffect(() => {
    if (!activeRunId) return;
    if (!liveMode) return;
    if (!anyRunActive) {
      setWaitingFirstEvent(false);
      return;
    }
    const id = window.setTimeout(() => {
      const stale = Date.now() - (lastRunUpdateTs || 0) > 2000;
      setWaitingFirstEvent(stale);
    }, 2100);
    return () => window.clearTimeout(id);
  }, [activeRunId, liveMode, anyRunActive, lastRunUpdateTs, setWaitingFirstEvent]);

  return { refreshAll };
}
