import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import type { PageContextSnapshot } from '../types/pageContext';

interface PageContextApi {
  pageContext: PageContextSnapshot;
  setPageContext: (partial: Partial<PageContextSnapshot>) => void;
}

const PageContextContext = createContext<PageContextApi | undefined>(undefined);

export function PageContextProvider({ children }: { children: ReactNode }) {
  const location = useLocation();
  const [extra, setExtra] = useState<Partial<PageContextSnapshot>>({});
  const setPageContext = useCallback((partial: Partial<PageContextSnapshot>) => {
    setExtra((prev) => {
      const next = { ...prev, ...partial };
      const prevJson = JSON.stringify(prev);
      const nextJson = JSON.stringify(next);
      if (prevJson === nextJson) return prev;
      return next;
    });
  }, []);

  const pageContext = useMemo<PageContextSnapshot>(() => {
    const params = new URLSearchParams(location.search);
    const filters: Record<string, string | number | boolean | null> = {};
    for (const [k, v] of params.entries()) {
      filters[k] = v;
    }
    return {
      route: location.pathname,
      filters,
      listContext: extra.listContext,
      selected: extra.selected,
      loadedIds: extra.loadedIds,
    };
  }, [location.pathname, location.search, extra]);

  const value = useMemo<PageContextApi>(
    () => ({
      pageContext,
      setPageContext,
    }),
    [pageContext, setPageContext]
  );

  return <PageContextContext.Provider value={value}>{children}</PageContextContext.Provider>;
}

export function usePageContext() {
  const ctx = useContext(PageContextContext);
  if (!ctx) throw new Error('usePageContext must be used inside PageContextProvider');
  return ctx;
}
