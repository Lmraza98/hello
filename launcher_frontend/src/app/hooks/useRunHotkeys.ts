import { useEffect, type RefObject } from "react";

type UseRunHotkeysCtx = {
  searchRef: RefObject<HTMLInputElement | null>;
  idsForRun: (mode: "selected" | "all") => string[];
  handleRun: (ids?: string[]) => Promise<void> | void;
  selectedCase: { id?: string } | null;
  selectedTestId: string;
  drawerOpen: boolean;
  setShowUtilityMenu: (value: boolean) => void;
  setShowArtifactsPopoverFor: (value: string | null) => void;
  setDrawerOpen: (value: boolean) => void;
  setSelectedCaseId: (value: string) => void;
  setSelectedTestId: (value: string) => void;
};

export function useRunHotkeys(ctx: UseRunHotkeysCtx) {
  const {
    searchRef,
    idsForRun,
    handleRun,
    selectedCase,
    selectedTestId,
    drawerOpen,
    setShowUtilityMenu,
    setShowArtifactsPopoverFor,
    setDrawerOpen,
    setSelectedCaseId,
    setSelectedTestId,
  } = ctx;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
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
  }, [
    idsForRun,
    handleRun,
    selectedCase?.id,
    selectedTestId,
    drawerOpen,
    searchRef,
    setShowUtilityMenu,
    setShowArtifactsPopoverFor,
    setDrawerOpen,
    setSelectedCaseId,
    setSelectedTestId,
  ]);
}
