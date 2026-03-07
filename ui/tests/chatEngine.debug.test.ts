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

vi.mock('../src/chat/models/ollamaClient', () => ({
  ollamaChat: vi.fn(async (req: { messages?: Array<{ role: string; content?: string }> }) => {
    const sys = String(req?.messages?.[0]?.content || '').toLowerCase();
    if (sys.includes('coreference resolver')) return { message: { content: 'ambiguous' } };
    if (sys.includes('classify this user message')) return { message: { content: 'single' } };
    return { message: { content: 'hello!' } };
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
  runTaskDecomposition: vi.fn().mockResolvedValue({
    success: true,
    steps: [],
    rawContent: null,
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

import { processAction, processMessage } from '../src/chat/chatEngine';
import type { ChatCompletionMessageParam } from '../src/chat/chatEngineTypes';
import * as ollamaStatusModule from '../src/chat/ollamaStatus';
import * as toolExecutorModule from '../src/chat/toolExecutor';
import * as reactLoopModule from '../src/chat/reactLoop';
import * as synthesisModule from '../src/chat/chatSynthesis';
import * as toolPlannerModule from '../src/chat/models/toolPlanner';

describe('processMessage debug gating', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not build debugTrace by default', async () => {
    const result = await processMessage('hello', {
      forceModel: 'openai',
    });
    expect(result.debugTrace).toBeUndefined();
  });

  it('does not build debugTrace when planner callback is present but debug is false', async () => {
    const plannerEvent = vi.fn();
    const result = await processMessage('hello', {
      forceModel: 'openai',
      debug: false,
      onPlannerEvent: plannerEvent,
    });
    expect(result.debugTrace).toBeUndefined();
    expect(plannerEvent).toHaveBeenCalled();
  });

  it('builds debugTrace with timings and size metrics when debug is true', async () => {
    const result = await processMessage('hello', {
      forceModel: 'openai',
      debug: true,
      conversationHistory: [
        { role: 'user', content: 'previous question' },
        { role: 'assistant', content: 'previous answer' },
      ],
    });

    expect(result.debugTrace).toBeDefined();
    expect(result.debugTrace?.timings).toBeDefined();
    expect(typeof result.debugTrace?.timings?.totalMs).toBe('number');
    expect(result.debugTrace?.sizes).toBeDefined();
    expect((result.debugTrace?.sizes?.historyChars || 0) > 0).toBe(true);
    expect((result.debugTrace?.sizes?.promptChars || 0) > 0).toBe(true);
  });

  it('computes local history once per request', async () => {
    const localHistorySpy = vi.spyOn(ollamaStatusModule, 'toLocalHistory');
    await processMessage('hello', {
      forceModel: 'openai',
      debug: true,
    });
    expect(localHistorySpy).toHaveBeenCalledTimes(1);
  });

  it('uses generic planner-first mode without intent fast-path module', async () => {
    const runLoopSpy = vi.spyOn(reactLoopModule, 'runReActLoop').mockResolvedValue({
      answer: 'ok',
      trace: [],
      toolsUsed: [],
      hitLimit: false,
      metrics: { plannerMs: 0, dispatchMs: 0 },
    });
    await processMessage('find Randy Peterson', {
      debug: true,
      requireToolConfirmation: false,
      phase: 'refining',
      forceModel: 'qwen3',
    });
    expect(runLoopSpy).toHaveBeenCalledTimes(1);
  });

  it('adds debug trace for browser follow-up planner path', async () => {
    vi.spyOn(reactLoopModule, 'runReActLoop').mockResolvedValue({
      answer: '',
      trace: [],
      toolsUsed: [],
      hitLimit: false,
      pendingConfirmation: {
        summary: 'Confirm browser action',
        calls: [{ name: 'browser_health', args: {} }],
      },
      metrics: { plannerMs: 0, dispatchMs: 0 },
    });

    const result = await processMessage('click on Zco in sales navigator', {
      debug: true,
      requireToolConfirmation: true,
      forceModel: 'qwen3',
      conversationHistory: [
        { role: 'assistant', content: 'I completed the browser navigation and kept the session open.' },
      ],
    });

    expect(result.confirmation?.required).toBe(true);
    expect(result.debugTrace).toBeDefined();
    expect(result.debugTrace?.routeReason).toBe('react_loop');
    expect(typeof result.debugTrace?.timings?.totalMs).toBe('number');
  });

  it('allows grounded hybrid_search responses when structured identity exists even without source refs', async () => {
    vi.spyOn(toolExecutorModule, 'dispatchToolCalls').mockResolvedValue({
      success: true,
      toolsUsed: ['hybrid_search'],
      executed: [
        {
          name: 'hybrid_search',
          args: { query: 'Lucas Raza' },
          ok: true,
          result: { results: [{ entity_type: 'contact', entity_id: '1', title: 'Lucas Raza', snippet: 'test', source_refs: [] }] },
        },
      ],
      summary: 'Executed hybrid_search.',
    });

    const result = await processMessage('Find Lucas Raza', {
      confirmedToolCalls: [{ name: 'hybrid_search', args: { query: 'Lucas Raza', entity_types: ['contact'], k: 5 } }],
      phase: 'executing',
      forceModel: 'qwen3',
    });

    expect(result.response).toContain('Executed hybrid_search');
  });

  it('allows grounded hybrid_search responses when source refs exist', async () => {
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
              {
                entity_type: 'contact',
                entity_id: '1',
                title: 'Lucas Raza',
                snippet: 'test',
                source_refs: [{ row_id: 1, table: 'linkedin_contacts' }],
              },
            ],
          },
        },
      ],
      summary: 'Executed hybrid_search.',
    });

    const result = await processMessage('Find Lucas Raza', {
      confirmedToolCalls: [{ name: 'hybrid_search', args: { query: 'Lucas Raza', entity_types: ['contact'], k: 5 } }],
      phase: 'executing',
      forceModel: 'qwen3',
    });

    expect(result.response).toContain('Executed hybrid_search');
  });

  it('uses confirmed read-only fast lane without entering react loop', async () => {
    const resumeSpy = vi.spyOn(reactLoopModule, 'resumeReActLoop');
    vi.spyOn(toolExecutorModule, 'dispatchToolCalls').mockResolvedValue({
      success: true,
      toolsUsed: ['hybrid_search'],
      executed: [
        {
          name: 'hybrid_search',
          args: { query: 'Lucas Raza', entity_types: ['contact'], k: 10 },
          ok: true,
          result: {
            results: [
              {
                entity_type: 'contact',
                entity_id: '1',
                title: 'Lucas Raza',
                snippet: 'test',
                source_refs: [{ row_id: 1, table: 'linkedin_contacts' }],
              },
            ],
          },
        },
      ],
      summary: 'Executed hybrid_search.',
    });

    const result = await processMessage('Find Lucas Raza', {
      confirmedToolCalls: [{ name: 'hybrid_search', args: { query: 'Lucas Raza', entity_types: ['contact'], k: 10 } }],
      phase: 'executing',
    });

    expect(resumeSpy).not.toHaveBeenCalled();
    expect(result.response).toContain('Executed hybrid_search');
  });

  it('does not require confirmation for read-only confirmed calls', async () => {
    vi.spyOn(toolExecutorModule, 'dispatchToolCalls').mockResolvedValue({
      success: true,
      toolsUsed: ['hybrid_search'],
      executed: [
        {
          name: 'hybrid_search',
          args: { query: 'Lucas Raza', k: 10 },
          ok: true,
          result: { results: [{ entity_type: 'contact', entity_id: '1', title: 'Lucas Raza', snippet: 'ok', source_refs: [{ row_id: 1 }] }] },
        },
      ],
      summary: 'Executed hybrid_search.',
    });

    const result = await processMessage('Find Lucas Raza', {
      confirmedToolCalls: [{ name: 'hybrid_search', args: { query: 'Lucas Raza', k: 10 } }],
      phase: 'executing',
      forceModel: 'qwen3',
    });

    expect(result.confirmation).toBeUndefined();
    expect(result.response).toContain('Executed hybrid_search');
  });

  it('skips task decomposition for single-step requests', async () => {
    const decompSpy = vi.spyOn(toolPlannerModule, 'runTaskDecomposition');
    await processMessage('Find Lucas Raza', {
      forceModel: 'qwen3',
      phase: 'planning',
    });
    expect(decompSpy).not.toHaveBeenCalled();
  });

  it('runs task decomposition only for explicit multi-step requests', async () => {
    const decompSpy = vi.spyOn(toolPlannerModule, 'runTaskDecomposition');
    vi.mocked(toolPlannerModule.runTaskDecomposition).mockResolvedValueOnce({
      success: true,
      rawContent: null,
      steps: [
        { id: 's1', intent: 'Find Lucas Raza', dependsOn: [] },
        { id: 's2', intent: 'Find Randy Peterson', dependsOn: ['s1'] },
      ],
    } as any);

    const loopSpy = vi.spyOn(reactLoopModule, 'runReActLoop');
    loopSpy.mockResolvedValueOnce({
      answer: 'step1 ok',
      trace: [],
      toolsUsed: [],
      hitLimit: false,
      metrics: { plannerMs: 0, dispatchMs: 0 },
    });
    loopSpy.mockResolvedValueOnce({
      answer: 'step2 ok',
      trace: [],
      toolsUsed: [],
      hitLimit: false,
      metrics: { plannerMs: 0, dispatchMs: 0 },
    });

    const result = await processMessage('Find Lucas Raza then find Randy Peterson', {
      forceModel: 'qwen3',
      phase: 'planning',
    });

    expect(decompSpy).toHaveBeenCalledTimes(1);
    expect(result.response).toContain('step1 ok');
    expect(result.response).toContain('step2 ok');
  });

  it('uses generic retrieval bootstrap for non-browser lookup failures', async () => {
    const plannerEvent = vi.fn();
    const dispatchSpy = vi.spyOn(toolExecutorModule, 'dispatchToolCalls').mockResolvedValue({
      success: true,
      toolsUsed: ['hybrid_search'],
      executed: [
        {
          name: 'hybrid_search',
          args: { query: 'Find Lucas Raza', k: 10 },
          ok: true,
          result: {
            results: [
              {
                entity_type: 'contact',
                entity_id: '1',
                title: 'Lucas Raza',
                snippet: 'test',
                source_refs: [{ row_id: 1, table: 'contacts' }],
              },
            ],
          },
        },
      ],
      summary: 'Executed hybrid_search.',
    });

    const result = await processMessage('Find Lucas Raza', {
      forceModel: 'qwen3',
      phase: 'planning',
      debug: true,
      onPlannerEvent: plannerEvent,
    });

    expect(plannerEvent).toHaveBeenCalledWith('Falling back to generic retrieval bootstrap (hybrid_search).');
    expect(dispatchSpy).toHaveBeenCalled();
    expect(result.toolsUsed).toContain('hybrid_search');
  });

  it('skips generic retrieval bootstrap for explicit LinkedIn browser requests', async () => {
    const plannerEvent = vi.fn();
    const dispatchSpy = vi.spyOn(toolExecutorModule, 'dispatchToolCalls');

    const result = await processMessage('Go to LinkedIn and tell me who works for ZCo', {
      forceModel: 'qwen3',
      phase: 'planning',
      debug: true,
      onPlannerEvent: plannerEvent,
    });

    expect(plannerEvent).not.toHaveBeenCalledWith('Falling back to generic retrieval bootstrap (hybrid_search).');
    expect(dispatchSpy).not.toHaveBeenCalled();
    expect(result.response).toBe('fallback response');
  });

  it('does not duplicate fallback summary text for confirmed get_contact calls', async () => {
    vi.spyOn(toolExecutorModule, 'dispatchToolCalls').mockResolvedValue({
      success: true,
      toolsUsed: ['get_contact'],
      executed: [
        {
          name: 'get_contact',
          args: { contact_id: 2954 },
          ok: true,
          result: { id: 2954, name: 'Lucas Raza' },
        },
      ],
      summary: 'Executed get_contact.',
    });

    const result = await processMessage('Get contact 2954', {
      confirmedToolCalls: [{ name: 'get_contact', args: { contact_id: 2954 } }],
      phase: 'executing',
      forceModel: 'qwen3',
    });

    const executedMessages = result.messages.filter(
      (message) => message.type === 'text' && message.content.trim() === 'Executed get_contact.'
    );
    expect(executedMessages).toHaveLength(1);
  });

  it('uses synthesized response for confirmed fast-lane tool execution', async () => {
    vi.spyOn(toolExecutorModule, 'dispatchToolCalls').mockResolvedValue({
      success: true,
      toolsUsed: ['get_contact'],
      executed: [
        {
          name: 'get_contact',
          args: { contact_id: 2954 },
          ok: true,
          result: { id: 2954, name: 'Lucas Raza', email: 'lucas.raza@zco.com' },
        },
      ],
      summary: 'Executed get_contact.',
    });
    vi.spyOn(synthesisModule, 'synthesizeAnswer').mockResolvedValueOnce({
      response: 'Lucas Raza is in your CRM. Next step: confirm if you want me to email him.',
      modelUsed: 'qwen3',
      promptChars: 180,
      synthesized: true,
    });

    const result = await processMessage('Get contact 2954', {
      confirmedToolCalls: [{ name: 'get_contact', args: { contact_id: 2954 } }],
      phase: 'executing',
      forceModel: 'qwen3',
    });

    expect(synthesisModule.synthesizeAnswer).toHaveBeenCalled();
    expect(result.response).toContain('Lucas Raza is in your CRM');
    expect(result.response).not.toContain('Executed get_contact.');
  });

  it('does not run synthesis when react loop returns pending confirmation', async () => {
    const synthSpy = vi.spyOn(synthesisModule, 'synthesizeAnswer');
    vi.spyOn(reactLoopModule, 'runReActLoop').mockResolvedValue({
      answer: '',
      trace: [],
      toolsUsed: [],
      hitLimit: false,
      pendingConfirmation: {
        summary: 'Confirm write action',
        calls: [{ name: 'send_email_now', args: { to: 'x@y.com', subject: 'hi' } }],
      },
      metrics: { plannerMs: 0, dispatchMs: 0 },
    });

    const result = await processMessage('send email', {
      forceModel: 'qwen3',
      phase: 'refining',
    });

    expect(result.confirmation?.required).toBe(true);
    expect(synthSpy).not.toHaveBeenCalled();
  });

  it('asks for entity disambiguation early on ambiguous pronoun references', async () => {
    const runLoopSpy = vi.spyOn(reactLoopModule, 'runReActLoop');
    const result = await processMessage('send him an email', {
      forceModel: 'qwen3',
      phase: 'planning',
      sessionState: {
        entities: [
          { entityType: 'contact', entityId: '2954', label: 'Lucas Raza', updatedAt: Date.now() },
          { entityType: 'contact', entityId: '2936', label: 'Randy Peterson', updatedAt: Date.now() },
        ],
      },
    });

    expect(result.response).toContain('multiple entities');
    expect(result.messages.some((m) => m.type === 'action_buttons')).toBe(true);
    expect(runLoopSpy).not.toHaveBeenCalled();
  });

  it('updates active session entity via processAction pick_entity', async () => {
    const result = await processAction('pick_entity:contact:2954', [], {
      entities: [
        { entityType: 'contact', entityId: '2954', label: 'Lucas Raza', updatedAt: Date.now() - 1000 },
        { entityType: 'contact', entityId: '2936', label: 'Randy Peterson', updatedAt: Date.now() - 1000 },
      ],
    });

    expect(result.sessionState?.activeEntity?.entityId).toBe('2954');
    expect(result.response.toLowerCase()).toContain('selected');
  });

  it('limits planner history to recent user turns and strips tool-role noise', async () => {
    const runLoopSpy = vi.spyOn(reactLoopModule, 'runReActLoop').mockResolvedValue({
      answer: 'ok',
      trace: [],
      toolsUsed: [],
      hitLimit: false,
      metrics: { plannerMs: 0, dispatchMs: 0 },
    });

    const longHistory: ChatCompletionMessageParam[] = [];
    for (let i = 0; i < 8; i += 1) {
      longHistory.push({ role: 'user', content: `u${i}` });
      longHistory.push({ role: 'assistant', content: `a${i}` });
      longHistory.push({ role: 'tool', content: `tool-output-${i}` });
    }

    await processMessage('general question that avoids fast path', {
      forceModel: 'qwen3',
      conversationHistory: longHistory,
      requireToolConfirmation: false,
      phase: 'refining',
    });

    expect(runLoopSpy).toHaveBeenCalledTimes(1);
    const passedHistory = runLoopSpy.mock.calls[0]?.[1] || [];
    const userCount = passedHistory.filter((m) => m.role === 'user').length;
    const hasToolRole = passedHistory.some((m) => m.role === 'tool');
    expect(userCount).toBeLessThanOrEqual(4);
    expect(hasToolRole).toBe(false);
  });

  it('strips session heuristic blocks before creating salesnav clarification task params', async () => {
    vi.mocked(toolPlannerModule.runToolPlan).mockResolvedValueOnce({
      success: false,
      plannedCalls: [],
      selectedTools: [],
      rawContent: null,
      planRationale: [],
      constraintWarnings: [],
      clarificationQuestion: 'How many contacts do you want from Zco Corporation, and which details should I collect: LinkedIn URL, title, email, or phone?',
    });

    const result = await processMessage('find contact details for employees of Zco Corporation on SalesNavigator', {
      forceModel: 'qwen3',
      sessionState: {
        entities: [
          { entityType: 'conversation', entityId: '3', label: 'Test Raza', score: 16, updatedAt: Date.now() },
        ],
        activeEntity: { entityType: 'conversation', entityId: '3', label: 'Test Raza', score: 16, updatedAt: Date.now() },
      },
    });

    const activeTask = result.sessionState?.activeTask;
    expect(activeTask?.params.company_name).toBe('Zco Corporation');
    expect(String(activeTask?.goal || '')).not.toContain('[SESSION_ENTITIES]');
    expect(String(activeTask?.steps?.[0]?.intent || '')).not.toContain('[SESSION_ENTITIES]');
  });
});
