import { describe, expect, it } from 'vitest';
import { isBrowserWorkflowCommand } from '../workbenchBridge';

describe('workbenchBridge command guard', () => {
  it('accepts valid workflow commands', () => {
    expect(isBrowserWorkflowCommand({ action: 'observe', source: 'chat' })).toBe(true);
    expect(isBrowserWorkflowCommand({ action: 'annotate', source: 'system', hrefPattern: '/comments/' })).toBe(true);
    expect(isBrowserWorkflowCommand({ action: 'validate', source: 'sidebar', preferFullscreen: true })).toBe(true);
  });

  it('rejects malformed workflow commands', () => {
    expect(isBrowserWorkflowCommand({ action: 'unknown', source: 'chat' })).toBe(false);
    expect(isBrowserWorkflowCommand({ action: 'observe', source: 'invalid' })).toBe(false);
    expect(isBrowserWorkflowCommand({ action: 'synthesize', source: 'chat', preferFullscreen: 'yes' })).toBe(false);
    expect(isBrowserWorkflowCommand(null)).toBe(false);
  });
});
