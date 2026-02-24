/**
 * Owns run action handlers (run/pause/stop/preview/cache/state/copy) while
 * preserving the bridge method contracts and existing state semantics.
 */
export function useRunController(params) {
  const {
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
  } = params;

  async function handlePreview() {
    if (!bridge) return;
    setPreviewBusy(true);
    try {
      const runIds = idsForRun("selected");
      const raw = await bridge.preview_plan(runIds.length ? runIds : idsForRun("all"), []);
      const plan = Array.isArray(raw) ? raw : [];
      if (!plan.length) {
        setPreviewLine("No plan");
        return;
      }
      const depCount = plan.reduce((acc, row) => acc + (Array.isArray(row.deps) && row.deps.length ? 1 : 0), 0);
      const skipCount = plan.reduce((acc, row) => acc + (row.skip ? 1 : 0), 0);
      const compact = plan.slice(0, 4).map((row) => `${row.order}:${row.id}`).join(" -> ");
      const more = plan.length > 6 ? ` (+${plan.length - 6} more)` : "";
      const meta = depCount || skipCount ? ` | deps:${depCount} skip:${skipCount}` : "";
      setPreviewLine(`${compact}${more}${meta}`);
    } catch (error) {
      const message = error?.message ? String(error.message) : "Preview failed";
      setPreviewLine(`Preview failed: ${message}`);
    } finally {
      setPreviewBusy(false);
    }
  }

  async function handleManualRefresh() {
    if (!bridge) return;
    if (typeof bridge.reload_catalog_state === "function") {
      try {
        await bridge.reload_catalog_state();
      } catch (error) {
        console.warn("[launcher] reload_catalog_state failed", error);
      }
    }
    await refreshAll();
  }

  function deriveRemainingIdsForResume(runRow) {
    if (!runRow || !Array.isArray(runRow.tests)) return [];
    const terminal = new Set(["passed", "failed", "skipped", "canceled"]);
    const selectedOrder = Array.isArray(runRow.selected_test_ids)
      ? runRow.selected_test_ids.map((id) => String(id || "")).filter(Boolean)
      : runRow.tests.map((row) => String(row?.id || "")).filter(Boolean);
    const byStatus = new Map(
      runRow.tests
        .filter((row) => row && typeof row === "object")
        .map((row) => [String(row.id || ""), String(row.status || "not_run").toLowerCase()])
    );
    return selectedOrder.filter((id) => {
      const status = byStatus.get(id) || "not_run";
      if (terminal.has(status)) return false;
      if (status === "running") return false;
      return true;
    });
  }

  async function handlePauseRun() {
    const row =
      activeRunRow ||
      runs.find((r) => ["running", "queued", "retrying"].includes(String(r?.status || "").toLowerCase())) ||
      null;
    if (!row) return;
    const remainingIds = deriveRemainingIdsForResume(row);
    setPausedRunState({
      runId: String(row.run_id || ""),
      remainingIds,
      pausedAt: Date.now(),
    });
    await handleStop("after_current");
  }

  async function handleRun(ids, options = {}) {
    if (!bridge || loadingRun) return;
    const wantResume = Boolean(options.resumePaused) && (!Array.isArray(ids) || ids.length === 0);
    const requestedIds =
      wantResume && hasPausedRun
        ? pausedRunState.remainingIds
        : (Array.isArray(ids) && ids.length ? ids : idsForRun("all"));
    if (runtimeDebug) {
      console.warn("[run-selected] requestedIds", {
        requestedIds: (requestedIds || []).map((id) => String(id || "")),
        selectedNodeId: String(graphState?.selectedNodeId || ""),
        graphScope,
        manualGraphChildId: String(manualGraphChildId || ""),
        graphDetailChildId: String(graphDetailChildId || ""),
      });
    }
    if (requestedIds.length) {
      setStatusById((prev) => {
        const next = { ...prev };
        const ts = Date.now() / 1000;
        requestedIds.forEach((id) => {
          const current = next[id] || {};
          next[id] = { ...current, status: "queued", lastRun: ts };
        });
        return next;
      });
      setLastRunUpdateTs(Date.now());
    }
    setLoadingRun(true);
    try {
      const out = await bridge.run_plan(requestedIds, []);
      const rid = String(out?.run_id || "");
      if (rid) {
        setPausedRunState(null);
        setActiveRunId(rid);
        setSelectedRunId(rid);
        const requestedSet = new Set((requestedIds || []).map((id) => String(id || "")));
        const requestedAggregates = (tests || [])
          .filter((row) => requestedSet.has(String(row?.id || "")) && Array.isArray(row?.children) && row.children.length > 0)
          .sort((a, b) => {
            const aid = String(a?.id || "");
            const bid = String(b?.id || "");
            if (aid === "python-tests-all" && bid !== "python-tests-all") return -1;
            if (bid === "python-tests-all" && aid !== "python-tests-all") return 1;
            const ac = Array.isArray(a?.children) ? a.children.length : 0;
            const bc = Array.isArray(b?.children) ? b.children.length : 0;
            if (ac !== bc) return bc - ac;
            return aid.localeCompare(bid);
          });
        const aggregateDirect = requestedAggregates[0] || null;
        const aggregateFallback =
          (tests || []).find((row) => String(row?.id || "") === "python-tests-all" && Array.isArray(row?.children) && row.children.length > 0) || null;
        const aggregateId = String(aggregateDirect?.id || aggregateFallback?.id || "");
        runAutoTrackRef.current = { runId: rid, aggregateId, engaged: false };
      }
      setRunScopeEnabled(false);
      setLiveMode(true);
      setStatusResetActive(false);
      setLastRunUpdateTs(Date.now());
      setWaitingFirstEvent(true);
      setFollowActivePaused(false);
      setGraphScope((prev) => ({ ...prev, childId: "" }));
      await refreshAll();
    } finally {
      setLoadingRun(false);
    }
  }

  async function handleClearState() {
    setStatusById({});
    setChildScopeEvents([]);
    setChildProgressByParent({});
    setActiveRunId("");
    setSelectedRunId(null);
    setPausedRunState(null);
    setWaitingFirstEvent(false);
    setStatusResetActive(true);
    if (anyRunActive && bridge?.cancel_run) {
      await bridge.cancel_run();
    }
  }

  async function handleClearCache() {
    if (!bridge || typeof bridge.clear_step_cache !== "function") return;
    try {
      const out = await bridge.clear_step_cache();
      const cleared = Number(out?.cleared || 0);
      setPreviewLine(`Cache cleared (${cleared} entries)`);
    } catch (error) {
      const message = error?.message ? String(error.message) : "cache clear failed";
      setPreviewLine(`Cache clear failed: ${message}`);
    }
    await refreshAll();
  }

  async function copyLogs() {
    if (!bridge) return;
    const text = await bridge.get_logs();
    await navigator.clipboard.writeText(text || "");
    setShowUtilityMenu(false);
  }

  async function copyDiagnostics() {
    if (!bridge) return;
    const text = await bridge.get_diagnostics_summary();
    await navigator.clipboard.writeText(text || "");
    setShowUtilityMenu(false);
  }

  return {
    handlePreview,
    handleManualRefresh,
    handlePauseRun,
    handleRun,
    handleClearState,
    handleClearCache,
    copyLogs,
    copyDiagnostics,
  };
}
