import { useCallback, useMemo } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

type SetEmailOptions = {
  replace?: boolean;
};

function parseEmailId(value: string | null): number | null {
  if (!value) return null;
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return null;
  return Math.trunc(num);
}

export function useEmailDetailsRouteState() {
  const pathname = usePathname() ?? '/email';
  const router = useRouter();
  const searchParams = useSearchParams();

  const emailId = useMemo(() => {
    const params = new URLSearchParams(searchParams?.toString() ?? '');
    return parseEmailId(params.get('selectedEmailId'));
  }, [searchParams]);

  const setEmailId = useCallback(
    (id: number | null, options?: SetEmailOptions) => {
      const params = new URLSearchParams(searchParams?.toString() ?? '');
      if (id === null) params.delete('selectedEmailId');
      else params.set('selectedEmailId', String(id));
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

  const openEmail = useCallback(
    (id: number) => {
      const alreadyOpen = emailId !== null;
      setEmailId(id, { replace: alreadyOpen });
    },
    [emailId, setEmailId]
  );

  const closeEmail = useCallback(() => setEmailId(null), [setEmailId]);

  return {
    emailId,
    setEmailId,
    openEmail,
    closeEmail,
  };
}
