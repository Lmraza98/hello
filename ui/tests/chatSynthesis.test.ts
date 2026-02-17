import { describe, expect, it } from 'vitest';
import { compactExecutedCalls } from '../src/chat/chatSynthesis';

describe('chatSynthesis compaction', () => {
  it('truncates large tool results and limits payload size', () => {
    const hugeText = 'A'.repeat(4000);
    const hugeArray = new Array(40).fill(null).map((_, i) => ({ idx: i, text: hugeText }));
    const compacted = compactExecutedCalls([
      {
        name: 'hybrid_search',
        args: { query: hugeText },
        ok: true,
        result: {
          items: hugeArray,
          metadata: {
            longField: hugeText,
            alsoLong: hugeText,
            extra: hugeText,
            another: hugeText,
          },
        },
      },
    ]);

    const serialized = JSON.stringify(compacted);
    expect(compacted).toHaveLength(1);
    expect(serialized.length).toBeLessThan(6000);
    expect(serialized).toContain('[truncated');
    expect(serialized).toContain('[+');
  });
});

