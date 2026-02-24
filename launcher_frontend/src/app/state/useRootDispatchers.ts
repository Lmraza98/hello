import { useMemo } from "react";

type Dispatch = (action: { type: string; value?: unknown; payload?: unknown }) => void;

function withAction(dispatch: Dispatch, type: string) {
  return (value: unknown) => dispatch({ type, value });
}

export function useRootDispatchers({
  dataDispatch,
  selectionDispatch,
  runDispatch,
  uiDispatch,
}: {
  dataDispatch: Dispatch;
  selectionDispatch: Dispatch;
  runDispatch: Dispatch;
  uiDispatch: Dispatch;
}) {
  return useMemo(
    () => ({
      data: {
        setLogs: withAction(dataDispatch, "data/setLogs"),
        setStartup: withAction(dataDispatch, "data/setStartup"),
        setTests: withAction(dataDispatch, "data/setTests"),
        setStatusById: withAction(dataDispatch, "data/setStatusById"),
        setRuns: withAction(dataDispatch, "data/setRuns"),
        applyDataSnapshot: (payload: unknown) => dataDispatch({ type: "data/snapshotReceived", payload }),
      },
      selection: {
        setSelectedCaseIds: withAction(selectionDispatch, "selection/setSelectedCaseIds"),
        setSelectedSuiteId: withAction(selectionDispatch, "selection/setSelectedSuiteId"),
        setSelectedTestId: withAction(selectionDispatch, "selection/setSelectedTestId"),
        setSelectedCaseId: withAction(selectionDispatch, "selection/setSelectedCaseId"),
        setAggregateFilterIds: withAction(selectionDispatch, "selection/setAggregateFilterIds"),
        setCollapsedSuites: withAction(selectionDispatch, "selection/setCollapsedSuites"),
        setTag: withAction(selectionDispatch, "selection/setTag"),
        setKind: withAction(selectionDispatch, "selection/setKind"),
        setOutcome: withAction(selectionDispatch, "selection/setOutcome"),
        setSearch: withAction(selectionDispatch, "selection/setSearch"),
      },
      run: {
        setSelectedRunId: withAction(runDispatch, "run/setSelectedRunId"),
        setRunScopeEnabled: withAction(runDispatch, "run/setRunScopeEnabled"),
        setLoadingRun: withAction(runDispatch, "run/setLoadingRun"),
        setLiveMode: withAction(runDispatch, "run/setLiveMode"),
        setActiveRunId: withAction(runDispatch, "run/setActiveRunId"),
        setPausedRunState: withAction(runDispatch, "run/setPausedRunState"),
        setLastRunUpdateTs: withAction(runDispatch, "run/setLastRunUpdateTs"),
        setWaitingFirstEvent: withAction(runDispatch, "run/setWaitingFirstEvent"),
        setStatusResetActive: withAction(runDispatch, "run/setStatusResetActive"),
        setPreviewLine: withAction(runDispatch, "run/setPreviewLine"),
        setPreviewBusy: withAction(runDispatch, "run/setPreviewBusy"),
      },
      ui: {
        setTab: withAction(uiDispatch, "ui/setTab"),
        setDrawerOpen: withAction(uiDispatch, "ui/setDrawerOpen"),
        setRunHistoryCollapsed: withAction(uiDispatch, "ui/setRunHistoryCollapsed"),
        setShowUtilityMenu: withAction(uiDispatch, "ui/setShowUtilityMenu"),
        setShowIssuesDrawer: withAction(uiDispatch, "ui/setShowIssuesDrawer"),
        setShowArtifactsPopoverFor: withAction(uiDispatch, "ui/setShowArtifactsPopoverFor"),
      },
    }),
    [dataDispatch, selectionDispatch, runDispatch, uiDispatch]
  );
}
