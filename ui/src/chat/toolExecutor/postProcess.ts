function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function toLowerString(value: unknown): string {
  if (value == null) return '';
  return String(value).toLowerCase();
}

export function postFilterSearchCompanies(args: Record<string, unknown>, result: unknown): unknown {
  if (!Array.isArray(result)) return result;
  const q = typeof args.q === 'string' ? args.q.trim().toLowerCase() : '';
  const companyName = typeof args.company_name === 'string' ? args.company_name.trim().toLowerCase() : '';
  const vertical = typeof args.vertical === 'string' ? args.vertical.trim().toLowerCase() : '';
  const tier = typeof args.tier === 'string' ? args.tier.trim().toLowerCase() : '';

  if (!q && !companyName && !vertical && !tier) return result;

  const qTokens = q
    .split(/\s+/)
    .map((x) => x.trim())
    .filter((x) => x.length >= 3);

  return result.filter((item) => {
    const row = asObject(item);
    if (!row) return false;
    const nameText = toLowerString(row.company_name || row.name);
    const verticalText = toLowerString(row.vertical || row.industry);
    const tierText = toLowerString(row.tier);
    const searchable = [
      toLowerString(row.company_name),
      toLowerString(row.name),
      toLowerString(row.domain),
      toLowerString(row.vertical),
      toLowerString(row.industry),
      toLowerString(row.target_reason),
      toLowerString(row.wedge),
    ].join(' ');

    if (companyName && !nameText.includes(companyName)) return false;
    if (vertical && !verticalText.includes(vertical)) return false;
    if (tier && tier !== 'all' && tier !== 'any' && tierText !== tier) return false;
    if (qTokens.length > 0 && !qTokens.some((token) => searchable.includes(token))) return false;

    return true;
  });
}

export function postProcessResult(
  toolName: string,
  args: Record<string, unknown>,
  result: unknown
): unknown {
  if (toolName === 'search_companies') {
    return postFilterSearchCompanies(args, result);
  }
  return result;
}
