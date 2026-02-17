function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function distinctValues(values: unknown[]): string[] {
  const out = new Set<string>();
  for (const value of values) {
    if (value == null) continue;
    const text = String(value).trim();
    if (!text) continue;
    out.add(text);
  }
  return [...out];
}

export async function listFilterValues(
  api: (method: string, path: string, body?: unknown) => Promise<unknown>,
  args: Record<string, unknown>
): Promise<unknown> {
  const toolName = typeof args.tool_name === 'string' ? args.tool_name.trim() : '';
  const argName = typeof args.arg_name === 'string' ? args.arg_name.trim() : '';
  const startsWith = typeof args.starts_with === 'string' ? args.starts_with.trim().toLowerCase() : '';
  const limitRaw = Number(args.limit);
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(Math.floor(limitRaw), 200) : 25;

  if (!argName) return { error: true, message: 'arg_name is required' };

  const lowerArg = argName.toLowerCase();
  let values: string[] = [];
  let source = 'unknown';

  if (lowerArg === 'has_email' || lowerArg === 'today_only' || lowerArg === 'with_email_only') {
    values = ['true', 'false'];
    source = 'synthetic';
  } else if (
    ['vertical', 'tier', 'status', 'company_name', 'q', 'domain'].includes(lowerArg) ||
    toolName === 'search_companies'
  ) {
    const companies = await api('GET', '/api/companies');
    const rows = Array.isArray(companies) ? companies : [];
    source = 'companies';
    if (lowerArg === 'q') {
      values = distinctValues(
        rows.flatMap((row) => {
          const obj = asObject(row);
          if (!obj) return [];
          return [obj.vertical, obj.company_name, obj.domain];
        })
      );
    } else {
      values = distinctValues(
        rows.map((row) => {
          const obj = asObject(row);
          if (!obj) return '';
          return obj[lowerArg] ?? '';
        })
      );
    }
  } else if (
    ['company', 'name', 'title', 'salesforce_status', 'vertical'].includes(lowerArg) ||
    toolName === 'search_contacts'
  ) {
    const contacts = await api('GET', '/api/contacts');
    const rows = Array.isArray(contacts) ? contacts : [];
    source = 'contacts';
    const fieldMap: Record<string, string> = {
      company: 'company_name',
      name: 'name',
      title: 'title',
      salesforce_status: 'salesforce_status',
      vertical: 'vertical',
    };
    const field = fieldMap[lowerArg] || lowerArg;
    values = distinctValues(
      rows.map((row) => {
        const obj = asObject(row);
        if (!obj) return '';
        return obj[field] ?? '';
      })
    );
  } else if (toolName.includes('campaign') || ['campaign_name'].includes(lowerArg)) {
    const campaigns = await api('GET', '/api/emails/campaigns');
    const rows = Array.isArray(campaigns) ? campaigns : [];
    source = 'campaigns';
    values = distinctValues(
      rows.map((row) => {
        const obj = asObject(row);
        if (!obj) return '';
        return obj.name ?? '';
      })
    );
  }

  if (startsWith) {
    values = values.filter((v) => v.toLowerCase().startsWith(startsWith));
  }

  values.sort((a, b) => a.localeCompare(b));
  const limited = values.slice(0, limit);
  return {
    tool_name: toolName || null,
    arg_name: argName,
    source,
    starts_with: startsWith || null,
    total_values: values.length,
    values: limited,
  };
}
