/**
 * Shared HTTP client for the API layer.
 *
 * All domain modules import `fetchJson` from here so there is a single
 * place to configure base URL, default headers, auth tokens, retries, etc.
 */

export const API_BASE = '/api';

export async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(API_BASE + url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options?.headers },
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}
