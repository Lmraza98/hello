import { useCallback, useMemo } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

type SetContactOptions = {
  replace?: boolean;
};

function parseContactId(value: string | null): number | null {
  if (!value) return null;
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return null;
  return Math.trunc(num);
}

export function useContactDetailsRouteState() {
  const pathname = usePathname() ?? '/';
  const router = useRouter();
  const searchParams = useSearchParams();

  const contactId = useMemo(() => {
    const params = new URLSearchParams(searchParams?.toString() ?? '');
    return parseContactId(params.get('contactId'));
  }, [searchParams]);

  const setContactId = useCallback(
    (id: number | null, options?: SetContactOptions) => {
      const params = new URLSearchParams(searchParams?.toString() ?? '');
      if (id === null) params.delete('contactId');
      else params.set('contactId', String(id));
      const search = params.toString();
      const nextUrl = `${pathname}${search ? `?${search}` : ''}`;
      if (options?.replace ?? false) {
        router.replace(nextUrl, { scroll: false });
      } else {
        router.push(nextUrl, { scroll: false });
      }
    },
    [pathname, searchParams, router]
  );

  const openContact = useCallback(
    (id: number) => {
      const alreadyOpen = contactId !== null;
      setContactId(id, { replace: alreadyOpen });
    },
    [contactId, setContactId]
  );

  const closeContact = useCallback(() => setContactId(null), [setContactId]);

  return {
    contactId,
    openContact,
    closeContact,
    setContactId,
  };
}
