import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import type { PageContextSnapshot } from '../types/pageContext';

interface PageContextApi {
  pageContext: PageContextSnapshot;
  setPageContext: (partial: Partial<PageContextSnapshot>) => void;
}

const PageContextContext = createContext<PageContextApi | undefined>(undefined);

export function PageContextProvider({ children }: { children: ReactNode }) {
  const pageContextWritesEnabled = String(process.env.NEXT_PUBLIC_PAGE_CONTEXT_WRITES_ENABLED ?? '0') === '1';
  const pathname = usePathname() ?? '/';
  const searchParams = useSearchParams();
  const [extra, setExtra] = useState<Partial<PageContextSnapshot>>({});
  const setPageContext = useCallback((partial: Partial<PageContextSnapshot>) => {
    if (!pageContextWritesEnabled) return;
    setExtra((prev) => {
      const next = { ...prev, ...partial };
      const prevJson = JSON.stringify(prev);
      const nextJson = JSON.stringify(next);
      if (prevJson === nextJson) return prev;
      return next;
    });
  }, [pageContextWritesEnabled]);

  const pageContext = useMemo<PageContextSnapshot>(() => {
    const params = new URLSearchParams(searchParams?.toString() ?? '');
    const filters: Record<string, string | number | boolean | null> = {};
    for (const [k, v] of params.entries()) {
      filters[k] = v;
    }
    return {
      route: pathname,
      filters,
      listContext: extra.listContext,
      selected: extra.selected,
      loadedIds: extra.loadedIds,
    };
  }, [pathname, searchParams, extra]);

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


