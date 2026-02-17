import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/chat/fallbackPipeline', () => ({
  runWithFallback: vi.fn().mockResolvedValue({
    response: 'fallback response',
    messages: [],
    modelUsed: 'openai',
    toolsUsed: [],
    fallbackUsed: false,
    success: true,
    switches: [],
  }),
}));

vi.mock('../src/chat/models/toolPlanner', () => ({
  runToolPlan: vi.fn().mockResolvedValue({
    success: false,
    plannedCalls: [],
    selectedTools: [],
    rawContent: null,
    planRationale: [],
    constraintWarnings: [],
    failureReason: 'test_no_model_fast_path',
  }),
}));

vi.mock('../src/chat/chatSynthesis', () => ({
  synthesizeAnswer: vi.fn(async (input: { fallbackResponse: string }) => ({
    response: input.fallbackResponse,
    modelUsed: 'qwen3',
    promptChars: 120,
    synthesized: true,
  })),
}));

import { processMessage } from '../src/chat/chatEngine';
import * as toolExecutorModule from '../src/chat/toolExecutor';
import * as reactLoopModule from '../src/chat/reactLoop';
import * as toolPlannerModule from '../src/chat/models/toolPlanner';

describe('chat scenario smoke tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('scenario 1: grounded retrieval result is accepted for email lookup intent', async () => {
    vi.spyOn(toolExecutorModule, 'dispatchToolCalls').mockResolvedValue({
      success: true,
      toolsUsed: ['hybrid_search'],
      executed: [
        {
          name: 'hybrid_search',
          args: { query: 'Lucas Raza' },
          ok: true,
          result: {
            items: [
              {
                entityType: 'contact',
                entityId: '2954',
                title: 'Lucas Raza',
                snippet: 'Business Development Representative - Zco Corporation',
                sourceRefs: [{ kind: 'entity', entity_id: '2954' }],
              },
            ],
          },
        },
      ],
      summary: 'Executed hybrid_search.',
    });

    const result = await processMessage('Send an email to Lucas Raza using Salesforce', {
      confirmedToolCalls: [{ name: 'hybrid_search', args: { query: 'Lucas Raza', entity_types: ['contact'], k: 10 } }],
      phase: 'executing',
      forceModel: 'qwen3',
    });

    expect(result.response).toContain('Executed hybrid_search');
    expect(result.response.toLowerCase()).not.toContain('cannot verify');
  });

  it('scenario 4: zero-evidence retrieval is blocked by grounding', async () => {
    vi.spyOn(toolExecutorModule, 'dispatchToolCalls').mockResolvedValue({
      success: true,
      toolsUsed: ['hybrid_search'],
      executed: [
        {
          name: 'hybrid_search',
          args: { query: 'Keven Fuertes' },
          ok: true,
          result: { results: [] },
        },
      ],
      summary: 'Executed hybrid_search.',
    });

    const result = await processMessage('Who is Keven Fuertes and where else did he work?', {
      confirmedToolCalls: [{ name: 'hybrid_search', args: { query: 'Keven Fuertes', entity_types: ['contact'], k: 10 } }],
      phase: 'executing',
      forceModel: 'qwen3',
    });

    expect(result.response.toLowerCase()).toContain('cannot verify');
  });

  it('scenario 8: write calls require confirmation', async () => {
    vi.spyOn(toolPlannerModule, 'runToolPlan').mockResolvedValue({
      success: true,
      plannedCalls: [
        { name: 'hybrid_search', args: { query: 'Lucas Raza', entity_types: ['contact'], k: 10 } },
        { name: 'send_email_now', args: { to: 'lucas.raza@zco.com', subject: 'Hello', body: 'Hi' } },
      ],
      selectedTools: ['hybrid_search', 'send_email_now'],
      rawContent: null,
      planRationale: [],
      constraintWarnings: [],
    });

    const result = await processMessage('Create an outreach action for Lucas Raza using Salesforce', {
      requireToolConfirmation: true,
      phase: 'planning',
      forceModel: 'qwen3',
    });

    expect(result.confirmation?.required).toBe(true);
    expect(result.confirmation?.calls.length).toBe(2);
  });

  it('scenario: email lookup with multiple contacts remains grounded in generic flow', async () => {
    vi.spyOn(toolExecutorModule, 'dispatchToolCalls').mockResolvedValue({
      success: true,
      toolsUsed: ['hybrid_search'],
      executed: [
        {
          name: 'hybrid_search',
          args: { query: 'Lucas Raza' },
          ok: true,
          result: {
            results: [
              { entity_type: 'contact', entity_id: '2954', title: 'Lucas Raza', source_refs: [{ kind: 'entity' }] },
              { entity_type: 'contact', entity_id: '2936', title: 'Lucas Raza', source_refs: [{ kind: 'entity' }] },
            ],
          },
        },
      ],
      summary: 'Executed hybrid_search.',
    });

    const result = await processMessage('Send an email to Lucas Raza using Salesforce', {
      confirmedToolCalls: [{ name: 'hybrid_search', args: { query: 'Lucas Raza', entity_types: ['contact'], k: 10 } }],
      phase: 'executing',
      forceModel: 'qwen3',
    });

    expect(result.response).toContain('Executed hybrid_search');
    expect(result.messages.some((m) => m.type === 'retrieval_results')).toBe(true);
  });

  it('scenario: email lookup avoids unrelated-name blending in generic flow', async () => {
    vi.spyOn(toolExecutorModule, 'dispatchToolCalls').mockResolvedValue({
      success: true,
      toolsUsed: ['hybrid_search'],
      executed: [
        {
          name: 'hybrid_search',
          args: { query: 'Randy Peterson' },
          ok: true,
          result: {
            results: [
              { entity_type: 'contact', entity_id: '3001', title: 'Randy Peterson', source_refs: [{ kind: 'entity' }] },
              { entity_type: 'contact', entity_id: '3010', title: 'Jena Peters', source_refs: [{ kind: 'entity' }] },
            ],
          },
        },
      ],
      summary: 'Executed hybrid_search.',
    });

    const result = await processMessage('Send an email to Randy Peterson using Salesforce', {
      confirmedToolCalls: [{ name: 'hybrid_search', args: { query: 'Randy Peterson', entity_types: ['contact'], k: 10 } }],
      phase: 'executing',
      forceModel: 'qwen3',
    });

    expect(result.response).toContain('Executed hybrid_search');
    expect(result.messages.some((m) => m.type === 'retrieval_results')).toBe(true);
  });

  it('scenario: deterministic email lookup returns disambiguation buttons', async () => {
    const dispatchSpy = vi.spyOn(toolExecutorModule, 'dispatchToolCalls').mockResolvedValue({
      success: true,
      toolsUsed: ['hybrid_search'],
      executed: [
        {
          name: 'hybrid_search',
          args: { query: 'Lucas Raza', entity_types: ['contact'], k: 10 },
          ok: true,
          result: {
            results: [
              { entity_type: 'contact', entity_id: '2954', title: 'Lucas Raza', source_refs: [{ kind: 'entity' }] },
              { entity_type: 'contact', entity_id: '2936', title: 'Lucas Raza', source_refs: [{ kind: 'entity' }] },
            ],
          },
        },
      ],
      summary: 'Executed hybrid_search.',
    });

    const result = await processMessage('send an email to Lucas Raza', {
      phase: 'planning',
      forceModel: 'qwen3',
    });

    expect(dispatchSpy).toHaveBeenCalled();
    const calls = dispatchSpy.mock.calls[0]?.[0] || [];
    expect(calls.map((c) => c.name)).toEqual(['hybrid_search']);
    expect(calls.some((c) => c.name === 'get_contact')).toBe(false);
    expect(result.response).not.toContain('422');
    expect(result.messages.some((m) => m.type === 'action_buttons')).toBe(true);
    const buttons = result.messages.find((m) => m.type === 'action_buttons');
    expect(buttons?.type).toBe('action_buttons');
    if (buttons?.type === 'action_buttons') {
      expect(buttons.buttons.some((b) => b.value.startsWith('pick_contact_for_email:'))).toBe(true);
    }
  });

  it('scenario: complex read query executes without confirmation', async () => {
    vi.spyOn(toolExecutorModule, 'dispatchToolCalls').mockResolvedValue({
      success: true,
      toolsUsed: ['hybrid_search'],
      executed: [
        {
          name: 'hybrid_search',
          args: { query: 'OAuth errors last 90 days grouped by owner', k: 10 },
          ok: true,
          result: {
            results: [
              {
                entity_type: 'conversation',
                entity_id: '42',
                title: 'OAuth permission escalation',
                snippet: 'owner=alex blocker=tenant consent pending',
                source_refs: [{ row_id: 42, table: 'email_replies' }],
              },
            ],
          },
        },
      ],
      summary: 'Executed hybrid_search.',
    });

    const result = await processMessage(
      'Show all conversation threads mentioning OAuth errors from the last 90 days and group by owner',
      {
        requireToolConfirmation: true,
        confirmedToolCalls: [{ name: 'hybrid_search', args: { query: 'OAuth errors last 90 days grouped by owner', k: 10 } }],
        phase: 'executing',
        forceModel: 'qwen3',
      }
    );

    expect(result.confirmation).toBeUndefined();
    expect(result.response).toContain('Executed hybrid_search');
  });

  it('scenario: complex write query still requires confirmation', async () => {
    vi.spyOn(toolPlannerModule, 'runToolPlan').mockResolvedValue({
      success: true,
      plannedCalls: [
        { name: 'hybrid_search', args: { query: 'Lucas Raza at Zco', entity_types: ['contact'], k: 10 } },
        { name: 'send_email_now', args: { contact_id: 2936, platform: 'salesforce' } },
      ],
      selectedTools: ['hybrid_search', 'send_email_now'],
      rawContent: null,
      planRationale: [],
      constraintWarnings: [],
    });

    const result = await processMessage(
      'Find Lucas Raza at Zco and send him a follow-up email using Salesforce',
      {
        requireToolConfirmation: true,
        phase: 'planning',
        forceModel: 'qwen3',
      }
    );

    expect(result.confirmation?.required).toBe(true);
    expect(result.confirmation?.calls.map((c) => c.name)).toEqual(['hybrid_search', 'send_email_now']);
  });

  it('scenario: hybrid 422 error is surfaced for complex query', async () => {
    vi.spyOn(toolExecutorModule, 'dispatchToolCalls').mockResolvedValue({
      success: false,
      toolsUsed: ['hybrid_search'],
      executed: [
        {
          name: 'hybrid_search',
          args: { query: 'Who owns OAuth blockers?', k: 10 },
          ok: false,
          result: { error: true, status: 422, message: 'bad payload' },
        },
      ],
      summary: 'Tool hybrid_search failed (422): bad payload',
    });

    const result = await processMessage('Who owns OAuth blockers?', {
      confirmedToolCalls: [{ name: 'hybrid_search', args: { query: 'Who owns OAuth blockers?', k: 10 } }],
      phase: 'executing',
      forceModel: 'qwen3',
    });

    expect(result.response).toContain('Tool hybrid_search failed (422): bad payload');
    expect(result.response.toLowerCase()).not.toContain('cannot verify');
  });
});
