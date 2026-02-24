import { useMemo, useReducer, useRef } from "react";
import { usePywebviewBridge } from "./usePywebviewBridge";
import { useSplitPaneLayout } from "./useSplitPaneLayout";
import { useFiltersAndSelection } from "./useFiltersAndSelection";
import { useGraphController } from "./useGraphController";
import { useGraphRuntime } from "./useGraphRuntime";
import { useRunHotkeys } from "./useRunHotkeys";
import { useRunSelectionActions } from "./useRunSelectionActions";
import { useRunOperations } from "./useRunOperations";
import { useAppShellViewModel } from "./useAppShellViewModel";
import { LAYOUT_CONSTANTS } from "../constants/layoutConstants";
import {
  dataInitialState,
  dataReducer,
  runInitialState,
  runReducer,
  selectionInitialState,
  selectionReducer,
  uiInitialState,
  uiReducer,
} from "../state/rootReducers";
import { useRootDispatchers } from "../state/useRootDispatchers";
import { useRuntimeDebugFlag } from "./useRuntimeDebugFlag";
import { useGraphModel } from "./graph/useGraphModel";
import { selectChromeInput, selectGraphInput, selectRunOpsInput, selectTestsInput } from "../state/selectors/rootSelectors";
import {
  buildGraphRuntimeCtx,
  buildRunHotkeysCtx,
  buildRunOpsCtx,
  buildSelectorState,
  buildShellLayoutInput,
  buildShellUiInput,
} from "../state/selectors/ctx";

export function useAppOrchestrationRoot() {
  const searchRef = useRef(null);
  const { bridge, bridgeError } = usePywebviewBridge();
  const runtimeDebug = useRuntimeDebugFlag();

  const [dataState, dataDispatch] = useReducer(dataReducer, dataInitialState);
  const [selectionState, selectionDispatch] = useReducer(selectionReducer, selectionInitialState);
  const [runState, runDispatch] = useReducer(runReducer, runInitialState);
  const [uiState, uiDispatch] = useReducer(uiReducer, uiInitialState);

  const actions = useRootDispatchers({ dataDispatch, selectionDispatch, runDispatch, uiDispatch });
  const { data: dataActions, selection: selectionActions, run: runActions, ui: uiActions } = actions;
  const graphDomain = useGraphController();

  const splitLayout = useSplitPaneLayout({
    tab: uiState.tab,
    runHistoryCollapsed: uiState.runHistoryCollapsed,
    graphDetailsOpen: graphDomain.graphDetailsOpen,
    ...LAYOUT_CONSTANTS,
  });
  const {
    testsLayoutRef,
    graphLayoutRef,
    layout,
    detailsInline,
    suitesMinPx,
    casesMinPx,
    detailsMinPx,
    overlayDetailsMaxWidth,
    graphCanInlineDetails,
    graphRightWidthClamped,
    startDrag,
    startGraphDividerDrag,
  } = splitLayout;

  const filters = useFiltersAndSelection({
    tests: dataState.tests,
    statusById: dataState.statusById,
    runs: dataState.runs,
    selectedRunId: runState.selectedRunId,
    runScopeEnabled: runState.runScopeEnabled,
    selectedSuiteId: selectionState.selectedSuiteId,
    setSelectedSuiteId: selectionActions.setSelectedSuiteId,
    selectedTestId: selectionState.selectedTestId,
    setSelectedTestId: selectionActions.setSelectedTestId,
    selectedCaseId: selectionState.selectedCaseId,
    setSelectedCaseId: selectionActions.setSelectedCaseId,
    aggregateFilterIds: selectionState.aggregateFilterIds,
    setAggregateFilterIds: selectionActions.setAggregateFilterIds,
    tag: selectionState.tag,
    kind: selectionState.kind,
    outcome: selectionState.outcome,
    search: selectionState.search,
    tab: uiState.tab,
    setSelectedRunId: runActions.setSelectedRunId,
  });

  const { graphModel } = useGraphModel({
    aggregateScopedSuites: filters.aggregateScopedSuites,
    selectedSuiteId: selectionState.selectedSuiteId,
    selectedTestId: selectionState.selectedTestId,
    visibleCases: filters.visibleCases,
    statusById: dataState.statusById,
    runs: dataState.runs,
    selectedRunId: runState.selectedRunId,
    runScopeEnabled: runState.runScopeEnabled,
    tab: uiState.tab,
    runtimeDebug,
  });

  const graphRuntime = useGraphRuntime(
    buildGraphRuntimeCtx({
      runtimeDebug,
      bridge,
      uiState,
      graphModel,
      graphDomain,
      runState,
      dataState,
      dataActions,
      selectionState,
      filters,
    })
  );

  const hasPausedRun = useMemo(
    () => Boolean(runState.pausedRunState && Array.isArray(runState.pausedRunState.remainingIds) && runState.pausedRunState.remainingIds.length > 0),
    [runState.pausedRunState]
  );

  const runOps = useRunOperations(
    buildRunOpsCtx({
      bridge,
      runState,
      graphRuntime,
      dataActions,
      runActions,
      selectionActions,
      runtimeDebug,
      graphDomain,
      hasPausedRun,
      dataState,
      uiActions,
      uiState,
    })
  );

  const runSelection = useRunSelectionActions({
    setTag: selectionActions.setTag,
    setKind: selectionActions.setKind,
    setOutcome: selectionActions.setOutcome,
    setSelectedSuiteId: selectionActions.setSelectedSuiteId,
    setAggregateFilterIds: selectionActions.setAggregateFilterIds,
    setSelectedRunId: runActions.setSelectedRunId,
    runScopeEnabled: runState.runScopeEnabled,
    setRunScopeEnabled: runActions.setRunScopeEnabled,
    setGraphScopedModel: graphDomain.setGraphScopedModel,
    setGraphScope: graphDomain.setGraphScope,
    selectedRunId: runState.selectedRunId,
  });

  useRunHotkeys(
    buildRunHotkeysCtx({
      searchRef,
      graphRuntime,
      runOps,
      selectionState,
      filters,
      uiState,
      uiActions,
      selectionActions,
    })
  );

  const selectorState = useMemo(
    () =>
      buildSelectorState({
        dataState,
        selectionState,
        runState,
        uiState,
        graphDomain,
        layoutState: { graphLayoutRef, graphCanInlineDetails, graphRightWidthClamped },
        refs: { searchRef },
      }),
    [
      dataState,
      selectionState,
      runState,
      uiState,
      graphDomain,
      graphLayoutRef,
      graphCanInlineDetails,
      graphRightWidthClamped,
      searchRef,
    ]
  );
  const selectorDerived = useMemo(() => ({ ...filters, ...graphRuntime, hasPausedRun }), [filters, graphRuntime, hasPausedRun]);
  const selectorActions = useMemo(
    () => ({
      selection: selectionActions,
      run: { ...runOps, handleSelectRun: runSelection.handleSelectRun, setLiveMode: runActions.setLiveMode },
      ui: {
        setTab: uiActions.setTab,
        setShowIssuesDrawer: uiActions.setShowIssuesDrawer,
      },
    }),
    [selectionActions, runOps, runSelection.handleSelectRun, runActions.setLiveMode, uiActions.setTab, uiActions.setShowIssuesDrawer]
  );

  const { chrome, topBar, testsView, graphView } = useAppShellViewModel({
    chrome: selectChromeInput(selectorState, { bridge, bridgeError, startup: dataState.startup, logs: dataState.logs }, selectorActions) as Parameters<
      typeof useAppShellViewModel
    >[0]["chrome"],
    runOps: selectRunOpsInput(selectorState, selectorDerived, selectorActions) as Parameters<typeof useAppShellViewModel>[0]["runOps"],
    testsActions: { clearFilters: runSelection.clearFilters },
    tests: selectTestsInput(selectorState, selectorDerived, selectorActions) as Parameters<typeof useAppShellViewModel>[0]["tests"],
    graph: selectGraphInput(selectorState, selectorDerived, selectorActions) as Parameters<typeof useAppShellViewModel>[0]["graph"],
    layout: buildShellLayoutInput({
      layout,
      startDrag,
      testsLayoutRef,
      detailsInline,
      suitesMinPx,
      casesMinPx,
      detailsMinPx,
      overlayDetailsMaxWidth,
      graphLayoutRef,
      graphCanInlineDetails,
      graphRightWidthClamped,
      startGraphDividerDrag,
      constants: LAYOUT_CONSTANTS,
    }),
    ui: buildShellUiInput({ uiState, uiActions }),
  });

  return { chrome, topBar, testsView, graphView };
}
