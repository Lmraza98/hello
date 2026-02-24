import { useCallback, useEffect } from "react";
import { useInterval } from "./useInterval";
import { useLatestRef } from "./useLatestRef";
import type { BridgeApi, Setter } from "../types/common";
import type { RunRow, StatusRow, TestRow } from "../types/contracts";

export type UseBridgePollingParams = {
  bridge: BridgeApi | null;
  liveMode: boolean;
  anyRunActive: boolean;
  statusResetActive: boolean;
  selectedRunId: string | null;
  activeRunId: string;
  setLogs: Setter<string>;
  setStartup: Setter<unknown>;
  setTests: Setter<TestRow[]>;
  setStatusById: Setter<Record<string, StatusRow>>;
  setRuns: Setter<RunRow[]>;
  setActiveRunId: Setter<string>;
  setSelectedRunId: Setter<string | null>;
  setWaitingFirstEvent: Setter<boolean>;
  setLastRunUpdateTs: Setter<number>;
  setStatusResetActive: Setter<boolean>;
  setSelectedSuiteId: Setter<string>;
  setSelectedTestId: Setter<string>;
  setSelectedCaseId: Setter<string>;
  lastRunUpdateTs: number;
  applyDataSnapshot?: (snapshot: {
    logs: string;
    startup: unknown;
    tests: TestRow[];
    statusById: Record<string, StatusRow>;
    runs: RunRow[];
  }) => void;
};

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
  applyDataSnapshot,
}: UseBridgePollingParams) {
  type StatusRowLike = { status?: string };
  const selectedRunIdRef = useLatestRef(selectedRunId);
  const activeRunIdRef = useLatestRef(activeRunId);
  const statusResetActiveRef = useLatestRef(statusResetActive);
  const lastRunUpdateTsRef = useLatestRef(lastRunUpdateTs);

  const refreshAll = useCallback(async () => {
    if (!bridge) return;
    const [logText, startupState, testRows, statusRows, runRows] = (await Promise.all([
      bridge.get_logs(),
      bridge.get_startup_state(),
      bridge.get_tests(),
      bridge.get_test_status(),
      bridge.get_runs(),
    ])) as [string | null | undefined, unknown, TestRow[] | null | undefined, Record<string, StatusRow> | null | undefined, RunRow[] | null | undefined];
    const selectedRunIdValue = selectedRunIdRef.current;
    const activeRunIdValue = activeRunIdRef.current;
    const statusResetActiveValue = statusResetActiveRef.current;
    const hasActiveSelection = Boolean(selectedRunIdValue || activeRunIdValue);
    const nextStatusById = !statusResetActiveValue || hasActiveSelection ? (statusRows || {}) : {};
    if (typeof applyDataSnapshot === "function") {
      applyDataSnapshot({
        logs: logText || "",
        startup: startupState || null,
        tests: testRows || [],
        statusById: nextStatusById,
        runs: runRows || [],
      });
    } else {
      setLogs(logText || "");
      setStartup(startupState || null);
      setTests(testRows || []);
      setStatusById(nextStatusById);
      setRuns(runRows || []);
    }

    const runningRun = (runRows || []).find((row) => ["running", "queued", "retrying"].includes(String(row?.status || "").toLowerCase()));
    const currentRunRow = activeRunIdValue ? (runRows || []).find((row) => String(row?.run_id || "") === String(activeRunIdValue)) : null;
    const hasProgress = Object.values((statusRows || {}) as Record<string, StatusRowLike>).some((row) => {
      const st = String(row?.status || "").toLowerCase();
      return ["running", "queued", "retrying", "passed", "failed", "timed_out", "canceled"].includes(st);
    });
    if (runningRun?.run_id && hasProgress) {
      setActiveRunId(String(runningRun.run_id));
      if (!selectedRunIdValue) setSelectedRunId(String(runningRun.run_id));
    } else if (!currentRunRow) {
      setWaitingFirstEvent(false);
      setActiveRunId("");
    }
    const sawActiveRun = Boolean(currentRunRow || (runningRun?.run_id && String(runningRun.run_id) === String(activeRunIdValue)));
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
    applyDataSnapshot,
    selectedRunIdRef,
    activeRunIdRef,
    statusResetActiveRef,
  ]);

  const intervalMs = liveMode || anyRunActive ? 700 : 1200;

  useEffect(() => {
    if (!bridge) return;
    void refreshAll();
  }, [bridge, intervalMs, refreshAll]);

  useInterval(
    () => {
      if (!bridge) return;
      return refreshAll();
    },
    bridge ? intervalMs : null
  );

  useEffect(() => {
    if (!activeRunId) return;
    if (!liveMode) return;
    if (!anyRunActive) {
      setWaitingFirstEvent(false);
      return;
    }
    const id = window.setTimeout(() => {
      const stale = Date.now() - (lastRunUpdateTsRef.current || 0) > 2000;
      setWaitingFirstEvent(stale);
    }, 2100);
    return () => window.clearTimeout(id);
  }, [activeRunId, liveMode, anyRunActive, setWaitingFirstEvent, lastRunUpdateTsRef]);

  return { refreshAll };
}
