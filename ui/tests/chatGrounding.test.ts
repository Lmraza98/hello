import { describe, expect, it } from 'vitest';
import { enforceHybridGrounding } from '../src/chat/chatGrounding';
import { textMsg } from '../src/services/workflows/helpers';

describe('enforceHybridGrounding', () => {
  it('keeps response when hybrid_search returns sourceRefs alias', () => {
    const out = enforceHybridGrounding(
      'ok',
      [textMsg('ok')],
      [
        {
          name: 'hybrid_search',
          result: {
            items: [
              {
                entityType: 'contact',
                entityId: '1',
                title: 'Lucas Raza',
                sourceRefs: [{ kind: 'entity', entity_id: '1' }],
              },
            ],
          },
        },
      ]
    );

    expect(out.response).toBe('ok');
  });

  it('keeps response when hybrid_search result is a direct array', () => {
    const out = enforceHybridGrounding(
      'ok',
      [textMsg('ok')],
      [
        {
          name: 'hybrid_search',
          result: [
            {
              entity_type: 'contact',
              entity_id: '42',
              title: 'Lucas Raza',
            },
          ],
        },
      ]
    );

    expect(out.response).toBe('ok');
  });

  it('blocks response only when hybrid_search has no usable evidence', () => {
    const out = enforceHybridGrounding(
      'ok',
      [textMsg('ok')],
      [
        {
          name: 'hybrid_search',
          result: { results: [] },
        },
      ]
    );

    expect(out.response).toContain('cannot verify');
  });

  it('does not mask explicit hybrid_search tool errors', () => {
    const out = enforceHybridGrounding(
      'Tool hybrid_search failed (422): bad payload',
      [textMsg('Tool hybrid_search failed (422): bad payload')],
      [
        {
          name: 'hybrid_search',
          result: { error: true, status: 422, detail: 'entity_types must be list' },
        },
      ]
    );

    expect(out.response).toContain('failed (422)');
  });
});
