import { describe, expect, it } from 'vitest';
import { normalizeChatSessionId, shouldPersistHydratedMessages } from '../chatSessionPersistence';

describe('chatSessionPersistence', () => {
  it('normalizes blank session ids to the default session', () => {
    expect(normalizeChatSessionId()).toBe('session-1');
    expect(normalizeChatSessionId('')).toBe('session-1');
    expect(normalizeChatSessionId('   ')).toBe('session-1');
  });

  it('keeps the current session id stable when hydrated storage matches', () => {
    expect(shouldPersistHydratedMessages('session-2', 'session-2')).toBe(true);
  });

  it('blocks persistence before the destination session hydrates', () => {
    expect(shouldPersistHydratedMessages('session-1', 'session-2')).toBe(false);
    expect(shouldPersistHydratedMessages(null, 'session-2')).toBe(false);
  });
});
