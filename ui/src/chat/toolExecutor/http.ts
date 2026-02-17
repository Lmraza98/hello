/**
 * HTTP helpers for tool execution.
 *
 * Extracted verbatim from `ui/src/chat/toolExecutor.ts` (Phase 1A).
 */

export function qs(params: Record<string, unknown>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && !(typeof v === 'string' && !v.trim())) {
      p.set(k, String(v));
    }
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}

export function apiFactory(apiBase: string) {
  return async function api(method: string, path: string, body?: unknown) {
    let res: Response;
    try {
      res = await fetch(`${apiBase}${path}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Network request failed';
      return {
        error: true,
        status: 0,
        code: 'network_error',
        message,
      };
    }

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      return { error: true, status: res.status, ...err };
    }

    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      return res.json();
    }

    return { success: true, message: 'File download triggered' };
  };
}
