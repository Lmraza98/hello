export function buildShellUiInput({ uiState, uiActions }) {
  return {
    showUtilityMenu: uiState.showUtilityMenu,
    setShowUtilityMenu: uiActions.setShowUtilityMenu,
    drawerOpen: uiState.drawerOpen,
    setDrawerOpen: uiActions.setDrawerOpen,
    runHistoryCollapsed: uiState.runHistoryCollapsed,
    setRunHistoryCollapsed: uiActions.setRunHistoryCollapsed,
    showArtifactsPopoverFor: uiState.showArtifactsPopoverFor,
    setShowArtifactsPopoverFor: uiActions.setShowArtifactsPopoverFor,
  };
}

