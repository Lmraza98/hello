import { useEffect } from "react";

export function useRunHotkeys(params) {
  const {
    searchRef,
    idsForRun,
    handleRun,
    selectedCaseId,
    selectedCaseIds,
    selectedCase,
    selectedTestId,
    drawerOpen,
    setShowUtilityMenu,
    setShowArtifactsPopoverFor,
    setDrawerOpen,
    setSelectedCaseId,
    setSelectedTestId,
  } = params;

  useEffect(() => {
    const onKeyDown = (event) => {
      const target = event.target;
      const typing = target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
      if (event.key === "/" && !typing) {
        event.preventDefault();
        searchRef.current?.focus();
      }
      if (!typing && event.key === "Enter") {
        event.preventDefault();
        const selectedIds = idsForRun("selected");
        if (selectedIds.length) void handleRun(selectedIds);
      }
      if (!typing && (event.key === "r" || event.key === "R")) {
        event.preventDefault();
        const rerunId = selectedCase?.id || selectedTestId;
        if (rerunId) void handleRun([rerunId]);
      }
      if (event.key === "Escape") {
        setShowUtilityMenu(false);
        setShowArtifactsPopoverFor(null);
        if (drawerOpen) setDrawerOpen(false);
        else {
          setSelectedCaseId("");
          setSelectedTestId("");
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [idsForRun, handleRun, selectedCase?.id, selectedTestId, selectedCaseId, selectedCaseIds, drawerOpen]);
}
