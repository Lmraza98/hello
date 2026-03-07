export function normalizeChatSessionId(sessionId?: string): string {
  return (sessionId || 'session-1').trim() || 'session-1';
}

export function shouldPersistHydratedMessages(
  hydratedSessionId: string | null | undefined,
  currentSessionId: string
): boolean {
  return Boolean(hydratedSessionId) && hydratedSessionId === currentSessionId;
}
