import { beforeEach, describe, expect, it, vi } from 'vitest';
import { dispatchToolCalls } from '../src/chat/toolExecutor';

describe('dispatchToolCalls', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('executes valid tool call and reports success', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => 'application/json' },
      json: async () => ({ items: [{ id: 1, name: 'Randy Peterson' }] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await dispatchToolCalls([
      { name: 'search_contacts', args: { name: 'Randy Peterson' } },
    ]);

    expect(result.success).toBe(true);
    expect(result.toolsUsed).toEqual(['search_contacts']);
    expect(result.executed.length).toBe(1);
    expect(result.executed[0]?.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects invalid tool names without calling API', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const result = await dispatchToolCalls([
      { name: 'made_up_tool', args: { x: 1 } },
    ]);

    expect(result.success).toBe(false);
    expect(result.toolsUsed).toEqual([]);
    expect(result.executed[0]?.ok).toBe(false);
    expect(result.summary).toContain('failed');
    expect(fetchMock).toHaveBeenCalledTimes(0);
  });

  it('serializes concurrent dispatches through the shared tool lane', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const fetchMock = vi.fn().mockImplementation(async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 20));
      inFlight -= 1;
      return {
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ items: [] }),
      };
    });
    vi.stubGlobal('fetch', fetchMock);

    await Promise.all([
      dispatchToolCalls([{ name: 'search_contacts', args: { name: 'Lucas' } }]),
      dispatchToolCalls([{ name: 'search_contacts', args: { name: 'Raza' } }]),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(maxInFlight).toBe(1);
  });

  it('resolve_entity maps person to contact and falls back to hybrid on empty results', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ results: [] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ results: [{ entity_type: 'contact', entity_id: '1', title: 'Keven Raza' }] }),
      });
    vi.stubGlobal('fetch', fetchMock);

    const result = await dispatchToolCalls([
      { name: 'resolve_entity', args: { name_or_identifier: 'Keven', entity_types: ['person'] } },
    ]);

    expect(result.success).toBe(true);
    expect(result.executed[0]?.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0]?.[0] || '')).toContain('/api/search/resolve');
    expect(String(fetchMock.mock.calls[1]?.[0] || '')).toContain('/api/search/hybrid');
    const firstBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body || '{}'));
    expect(firstBody.entity_types).toEqual(['contact']);
  });

  it('falls back from hybrid_search to google_search_browser on explicit google intent and network error', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('Failed to fetch'))
      .mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ ok: true, citations: [], organic_results: [{ title: 'NH companies' }] }),
      });
    vi.stubGlobal('fetch', fetchMock);

    const result = await dispatchToolCalls([
      { name: 'hybrid_search', args: { query: 'google companies in new hampshire', k: 5 } },
    ]);

    expect(result.success).toBe(true);
    expect(result.executed[0]?.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0]?.[0] || '')).toContain('/api/search/hybrid');
    expect(String(fetchMock.mock.calls[1]?.[0] || '')).toContain('/api/google/search-browser');
    const secondBody = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body || '{}'));
    expect(secondBody.query).toBe('companies in new hampshire');
    expect(secondBody.max_results).toBe(5);
  });
});
