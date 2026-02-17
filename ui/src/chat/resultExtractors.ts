export type ContactLike = {
  id?: number;
  name?: string;
  title?: string | null;
  company_name?: string | null;
  email?: string | null;
  phone?: string | null;
  linkedin_url?: string | null;
  salesforce_url?: string | null;
};

export type CompanyLike = {
  company_name?: string;
  name?: string;
  industry?: string | null;
  vertical?: string | null;
  location?: string | null;
  domain?: string | null;
  linkedin_url?: string | null;
};

export type SalesNavProfileLike = {
  name?: string;
  title?: string | null;
  company?: string | null;
  linkedin_url?: string | null;
  location?: string | null;
};

export function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function removeEmptyArgs(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args || {})) {
    if (v === undefined || v === null) continue;
    if (typeof v === 'string' && !v.trim()) continue;
    out[k] = v;
  }
  return out;
}

function extractFromArray<T>(
  rows: unknown[],
  predicate: (row: Record<string, unknown>) => boolean,
  map?: (row: Record<string, unknown>) => T
): T[] {
  const out: T[] = [];
  for (const item of rows) {
    const row = asObject(item);
    if (!row || !predicate(row)) continue;
    out.push((map ? map(row) : (row as unknown as T)));
  }
  return out;
}

export function extractContactsFromResult(result: unknown): ContactLike[] {
  if (Array.isArray(result)) {
    return extractFromArray<ContactLike>(result, (row) => typeof row.name === 'string');
  }
  const obj = asObject(result);
  if (!obj) return [];
  if (Array.isArray(obj.items)) {
    return extractFromArray<ContactLike>(obj.items, (row) => typeof row.name === 'string');
  }
  return [];
}

export function extractCompaniesFromResult(result: unknown): CompanyLike[] {
  if (Array.isArray(result)) {
    return extractFromArray<CompanyLike>(result, (row) => typeof row.company_name === 'string');
  }

  const obj = asObject(result);
  if (!obj) return [];

  if (Array.isArray(obj.companies)) {
    return extractFromArray<CompanyLike>(
      obj.companies,
      (row) => typeof row.company_name === 'string' || typeof row.name === 'string',
      (row) => ({
        ...row,
        company_name: (row.company_name as string | undefined) || (typeof row.name === 'string' ? row.name : undefined),
      })
    );
  }

  if (Array.isArray(obj.items)) {
    return extractFromArray<CompanyLike>(obj.items, (row) => typeof row.company_name === 'string');
  }

  return [];
}

export function extractSalesNavProfilesFromResult(result: unknown): SalesNavProfileLike[] {
  if (Array.isArray(result)) {
    return extractFromArray<SalesNavProfileLike>(result, (row) => typeof row.name === 'string');
  }

  const obj = asObject(result);
  if (!obj) return [];

  if (Array.isArray(obj.profiles)) {
    return extractFromArray<SalesNavProfileLike>(obj.profiles, (row) => typeof row.name === 'string');
  }

  if (Array.isArray(obj.items)) {
    return extractFromArray<SalesNavProfileLike>(obj.items, (row) => typeof row.name === 'string');
  }

  return [];
}
