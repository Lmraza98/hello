import { describe, expect, it } from 'vitest';

import { detectFastPathPlan } from '../src/chat/intentFastPath';

describe('intent fast path hybrid defaults', () => {
  it('routes find person to hybrid_search', () => {
    const plan = detectFastPathPlan('Find Lucas Raza');
    expect(plan).toBeTruthy();
    expect(plan?.calls[0]?.name).toBe('hybrid_search');
  });

  it('routes recall/thread intent to hybrid_search', () => {
    const plan = detectFastPathPlan('What did we say previously about Outlook permissions thread');
    expect(plan).toBeTruthy();
    expect(plan?.calls[0]?.name).toBe('hybrid_search');
  });

  it('keeps explicit contact list filters on search_contacts', () => {
    const plan = detectFastPathPlan('show contacts added today');
    expect(plan).toBeTruthy();
    expect(plan?.calls[0]?.name).toBe('search_contacts');
    expect(plan?.calls[0]?.args).toMatchObject({ today_only: true });
  });

  it('keeps explicit company filter list on search_companies', () => {
    const plan = detectFastPathPlan('list companies tier A');
    expect(plan).toBeTruthy();
    expect(plan?.calls[0]?.name).toBe('search_companies');
  });
});
