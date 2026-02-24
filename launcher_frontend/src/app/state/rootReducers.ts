type Updater<T> = T | ((current: T) => T);

function applyValueUpdate<T>(current: T, next: Updater<T>): T {
  return typeof next === "function" ? (next as (value: T) => T)(current) : next;
}

export const dataInitialState = {
  logs: "",
  startup: null,
  tests: [],
  statusById: {},
  runs: [],
};

type DataAction =
  | { type: "data/setLogs"; value: Updater<string> }
  | { type: "data/setStartup"; value: Updater<unknown> }
  | { type: "data/setTests"; value: Updater<unknown[]> }
  | { type: "data/setStatusById"; value: Updater<Record<string, unknown>> }
  | { type: "data/setRuns"; value: Updater<unknown[]> }
  | {
      type: "data/snapshotReceived";
      payload: {
        logs: string;
        startup: unknown;
        tests: unknown[];
        statusById: Record<string, unknown>;
        runs: unknown[];
      };
    };

export function dataReducer(state: typeof dataInitialState, action: DataAction) {
  switch (action.type) {
    case "data/setLogs":
      return { ...state, logs: applyValueUpdate(state.logs, action.value) };
    case "data/setStartup":
      return { ...state, startup: applyValueUpdate(state.startup, action.value) };
    case "data/setTests":
      return { ...state, tests: applyValueUpdate(state.tests, action.value) };
    case "data/setStatusById":
      return { ...state, statusById: applyValueUpdate(state.statusById, action.value) };
    case "data/setRuns":
      return { ...state, runs: applyValueUpdate(state.runs, action.value) };
    case "data/snapshotReceived":
      return {
        ...state,
        logs: action.payload.logs,
        startup: action.payload.startup,
        tests: action.payload.tests,
        statusById: action.payload.statusById,
        runs: action.payload.runs,
      };
    default:
      return state;
  }
}

export const selectionInitialState = {
  selectedCaseIds: new Set(),
  selectedSuiteId: "",
  selectedTestId: "",
  selectedCaseId: "",
  aggregateFilterIds: [],
  collapsedSuites: {},
  tag: "",
  kind: "",
  outcome: "",
  search: "",
};

type SelectionAction =
  | { type: "selection/setSelectedCaseIds"; value: Updater<Set<string>> }
  | { type: "selection/setSelectedSuiteId"; value: Updater<string> }
  | { type: "selection/setSelectedTestId"; value: Updater<string> }
  | { type: "selection/setSelectedCaseId"; value: Updater<string> }
  | { type: "selection/setAggregateFilterIds"; value: Updater<string[]> }
  | { type: "selection/setCollapsedSuites"; value: Updater<Record<string, boolean>> }
  | { type: "selection/setTag"; value: Updater<string> }
  | { type: "selection/setKind"; value: Updater<string> }
  | { type: "selection/setOutcome"; value: Updater<string> }
  | { type: "selection/setSearch"; value: Updater<string> };

export function selectionReducer(state: typeof selectionInitialState, action: SelectionAction) {
  switch (action.type) {
    case "selection/setSelectedCaseIds":
      return { ...state, selectedCaseIds: applyValueUpdate(state.selectedCaseIds, action.value) };
    case "selection/setSelectedSuiteId":
      return { ...state, selectedSuiteId: applyValueUpdate(state.selectedSuiteId, action.value) };
    case "selection/setSelectedTestId":
      return { ...state, selectedTestId: applyValueUpdate(state.selectedTestId, action.value) };
    case "selection/setSelectedCaseId":
      return { ...state, selectedCaseId: applyValueUpdate(state.selectedCaseId, action.value) };
    case "selection/setAggregateFilterIds":
      return { ...state, aggregateFilterIds: applyValueUpdate(state.aggregateFilterIds, action.value) };
    case "selection/setCollapsedSuites":
      return { ...state, collapsedSuites: applyValueUpdate(state.collapsedSuites, action.value) };
    case "selection/setTag":
      return { ...state, tag: applyValueUpdate(state.tag, action.value) };
    case "selection/setKind":
      return { ...state, kind: applyValueUpdate(state.kind, action.value) };
    case "selection/setOutcome":
      return { ...state, outcome: applyValueUpdate(state.outcome, action.value) };
    case "selection/setSearch":
      return { ...state, search: applyValueUpdate(state.search, action.value) };
    default:
      return state;
  }
}

export const runInitialState = {
  selectedRunId: null,
  runScopeEnabled: false,
  loadingRun: false,
  liveMode: true,
  activeRunId: "",
  pausedRunState: null,
  lastRunUpdateTs: 0,
  waitingFirstEvent: false,
  statusResetActive: false,
  previewLine: "",
  previewBusy: false,
};

type RunAction =
  | { type: "run/setSelectedRunId"; value: Updater<string | null> }
  | { type: "run/setRunScopeEnabled"; value: Updater<boolean> }
  | { type: "run/setLoadingRun"; value: Updater<boolean> }
  | { type: "run/setLiveMode"; value: Updater<boolean> }
  | { type: "run/setActiveRunId"; value: Updater<string> }
  | { type: "run/setPausedRunState"; value: Updater<unknown> }
  | { type: "run/setLastRunUpdateTs"; value: Updater<number> }
  | { type: "run/setWaitingFirstEvent"; value: Updater<boolean> }
  | { type: "run/setStatusResetActive"; value: Updater<boolean> }
  | { type: "run/setPreviewLine"; value: Updater<string> }
  | { type: "run/setPreviewBusy"; value: Updater<boolean> };

export function runReducer(state: typeof runInitialState, action: RunAction) {
  switch (action.type) {
    case "run/setSelectedRunId":
      return { ...state, selectedRunId: applyValueUpdate(state.selectedRunId, action.value) };
    case "run/setRunScopeEnabled":
      return { ...state, runScopeEnabled: applyValueUpdate(state.runScopeEnabled, action.value) };
    case "run/setLoadingRun":
      return { ...state, loadingRun: applyValueUpdate(state.loadingRun, action.value) };
    case "run/setLiveMode":
      return { ...state, liveMode: applyValueUpdate(state.liveMode, action.value) };
    case "run/setActiveRunId":
      return { ...state, activeRunId: applyValueUpdate(state.activeRunId, action.value) };
    case "run/setPausedRunState":
      return { ...state, pausedRunState: applyValueUpdate(state.pausedRunState, action.value) };
    case "run/setLastRunUpdateTs":
      return { ...state, lastRunUpdateTs: applyValueUpdate(state.lastRunUpdateTs, action.value) };
    case "run/setWaitingFirstEvent":
      return { ...state, waitingFirstEvent: applyValueUpdate(state.waitingFirstEvent, action.value) };
    case "run/setStatusResetActive":
      return { ...state, statusResetActive: applyValueUpdate(state.statusResetActive, action.value) };
    case "run/setPreviewLine":
      return { ...state, previewLine: applyValueUpdate(state.previewLine, action.value) };
    case "run/setPreviewBusy":
      return { ...state, previewBusy: applyValueUpdate(state.previewBusy, action.value) };
    default:
      return state;
  }
}

export const uiInitialState = {
  tab: "tests",
  drawerOpen: false,
  runHistoryCollapsed: false,
  showUtilityMenu: false,
  showIssuesDrawer: false,
  showArtifactsPopoverFor: null,
};

type UiAction =
  | { type: "ui/setTab"; value: Updater<string> }
  | { type: "ui/setDrawerOpen"; value: Updater<boolean> }
  | { type: "ui/setRunHistoryCollapsed"; value: Updater<boolean> }
  | { type: "ui/setShowUtilityMenu"; value: Updater<boolean> }
  | { type: "ui/setShowIssuesDrawer"; value: Updater<boolean> }
  | { type: "ui/setShowArtifactsPopoverFor"; value: Updater<string | null> };

export function uiReducer(state: typeof uiInitialState, action: UiAction) {
  switch (action.type) {
    case "ui/setTab":
      return { ...state, tab: applyValueUpdate(state.tab, action.value) };
    case "ui/setDrawerOpen":
      return { ...state, drawerOpen: applyValueUpdate(state.drawerOpen, action.value) };
    case "ui/setRunHistoryCollapsed":
      return { ...state, runHistoryCollapsed: applyValueUpdate(state.runHistoryCollapsed, action.value) };
    case "ui/setShowUtilityMenu":
      return { ...state, showUtilityMenu: applyValueUpdate(state.showUtilityMenu, action.value) };
    case "ui/setShowIssuesDrawer":
      return { ...state, showIssuesDrawer: applyValueUpdate(state.showIssuesDrawer, action.value) };
    case "ui/setShowArtifactsPopoverFor":
      return { ...state, showArtifactsPopoverFor: applyValueUpdate(state.showArtifactsPopoverFor, action.value) };
    default:
      return state;
  }
}
