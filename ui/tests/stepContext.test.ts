import { describe, expect, test } from 'vitest';

import { buildStepMessage, type StepContextEntry } from '../src/chat/chatEngine/stepContext';

describe('stepContext dependency binding', () => {
  test('includes strict dependency guard and entity hints for dependent steps', () => {
    const structured: StepContextEntry[] = [
      {
        stepId: 's1',
        stepIntent: 'Find companies',
        toolResults: [
          {
            name: 'hybrid_search',
            ok: true,
            result: {
              results: [
                { entity_id: '1', title: 'Schneider Electric' },
                { entity_id: '2', title: 'Legrand' },
              ],
            },
          },
        ],
      },
    ];

    const message = buildStepMessage(
      {
        id: 's2',
        intent: 'Find head of marketing for each company from s1',
        dependsOn: ['s1'],
      },
      structured
    );

    expect(message).toContain('STRICT: This step depends on s1');
    expect(message).toContain('Entity hints from prior steps: Schneider Electric | Legrand');
    expect(message).toContain('IMPORTANT - Results from previous steps');
  });
});
