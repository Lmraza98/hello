import { useCallback, useMemo } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

type SetTemplateOptions = {
  replace?: boolean;
};

function parseTemplateId(value: string | null): number | null {
  if (!value) return null;
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return null;
  return Math.trunc(num);
}

export function useTemplateDetailsRouteState() {
  const pathname = usePathname() ?? '/';
  const router = useRouter();
  const searchParams = useSearchParams();

  const templateId = useMemo(() => {
    const params = new URLSearchParams(searchParams?.toString() ?? '');
    return parseTemplateId(params.get('selectedTemplateId'));
  }, [searchParams]);

  const setTemplateId = useCallback(
    (id: number | null, options?: SetTemplateOptions) => {
      const params = new URLSearchParams(searchParams?.toString() ?? '');
      if (id === null) params.delete('selectedTemplateId');
      else params.set('selectedTemplateId', String(id));
      const search = params.toString();
      const nextUrl = `${pathname}${search ? `?${search}` : ''}`;
      if (options?.replace ?? false) {
        router.replace(nextUrl, { scroll: false });
      } else {
        router.push(nextUrl, { scroll: false });
      }
    },
    [pathname, router, searchParams]
  );

  const openTemplate = useCallback(
    (id: number) => {
      const alreadyOpen = templateId !== null;
      setTemplateId(id, { replace: alreadyOpen });
    },
    [setTemplateId, templateId]
  );

  const closeTemplate = useCallback(() => setTemplateId(null), [setTemplateId]);

  return {
    templateId,
    setTemplateId,
    openTemplate,
    closeTemplate,
  };
}
