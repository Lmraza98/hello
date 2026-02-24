export function buildSelectorState({ dataState, selectionState, runState, uiState, graphDomain, layoutState, refs }) {
  return {
    data: dataState,
    selection: selectionState,
    run: runState,
    ui: uiState,
    graph: {
      graphDetailsOpen: graphDomain.graphDetailsOpen,
      graphState: graphDomain.graphState,
      setGraphState: graphDomain.setGraphState,
      childScopeEvents: graphDomain.childScopeEvents,
      setGraphSelectedRunTargetId: graphDomain.setGraphSelectedRunTargetId,
      setManualGraphChildId: graphDomain.setManualGraphChildId,
      setFollowActivePaused: graphDomain.setFollowActivePaused,
      setGraphDetailsOpen: graphDomain.setGraphDetailsOpen,
      graphScope: graphDomain.graphScope,
      setGraphScope: graphDomain.setGraphScope,
      setGraphBubbleAggregateId: graphDomain.setGraphBubbleAggregateId,
      followActiveChild: graphDomain.followActiveChild,
      followActivePaused: graphDomain.followActivePaused,
      setFollowActiveChild: graphDomain.setFollowActiveChild,
      graphScopedModel: graphDomain.graphScopedModel,
      setGraphScopedModel: graphDomain.setGraphScopedModel,
      setGraphBottomTab: graphDomain.setGraphBottomTab,
      graphBottomTab: graphDomain.graphBottomTab,
      graphBubbleAggregateId: graphDomain.graphBubbleAggregateId,
    },
    layout: layoutState,
    refs,
  };
}

