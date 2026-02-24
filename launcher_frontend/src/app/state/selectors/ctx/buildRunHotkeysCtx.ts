export function buildRunHotkeysCtx({ searchRef, graphRuntime, runOps, selectionState, filters, uiState, uiActions, selectionActions }) {
  return {
    searchRef,
    idsForRun: graphRuntime.idsForRun,
    handleRun: runOps.handleRun,
    selectedCaseId: selectionState.selectedCaseId,
    selectedCaseIds: selectionState.selectedCaseIds,
    selectedCase: filters.selectedCase,
    selectedTestId: selectionState.selectedTestId,
    drawerOpen: uiState.drawerOpen,
    setShowUtilityMenu: uiActions.setShowUtilityMenu,
    setShowArtifactsPopoverFor: uiActions.setShowArtifactsPopoverFor,
    setDrawerOpen: uiActions.setDrawerOpen,
    setSelectedCaseId: selectionActions.setSelectedCaseId,
    setSelectedTestId: selectionActions.setSelectedTestId,
  };
}

