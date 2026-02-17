import { describe, expect, it } from 'vitest';

import { checkPlanDestructive } from '../planDestructiveCheck';

describe('checkPlanDestructive', () => {
  it('returns false for navigation-only plan', () => {
    const result = checkPlanDestructive([{ action: 'contacts.navigate' } as any], []);
    expect(result.requiresConfirmation).toBe(false);
  });

  it('returns false for read-only tool plan', () => {
    const result = checkPlanDestructive([], [{ name: 'hybrid_search', args: {} }]);
    expect(result.requiresConfirmation).toBe(false);
  });

  it('returns true for destructive capability action', () => {
    const result = checkPlanDestructive(
      [{ action: 'contacts.bulk_delete', contact_ids: [1, 2] } as any],
      []
    );
    expect(result.requiresConfirmation).toBe(true);
    expect(result.reasons.some((reason) => reason.includes('contacts.bulk_delete'))).toBe(true);
  });

  it('returns true for destructive tool call', () => {
    const result = checkPlanDestructive([], [{ name: 'delete_contact', args: { contact_id: 1 } }]);
    expect(result.requiresConfirmation).toBe(true);
  });

  it('returns true for mixed plan containing one destructive call', () => {
    const result = checkPlanDestructive(
      [{ action: 'contacts.navigate' } as any],
      [
        { name: 'hybrid_search', args: { query: 'Lucas Raza' } },
        { name: 'delete_contact', args: { contact_id: 2 } },
      ]
    );
    expect(result.requiresConfirmation).toBe(true);
  });

  it('returns true for compound workflow launch', () => {
    const result = checkPlanDestructive([], [
      { name: 'compound_workflow_run', args: { spec: { name: 'Complex workflow' } } },
    ]);
    expect(result.requiresConfirmation).toBe(true);
    expect(result.reasons.some((reason) => reason.includes('compound_workflow_run'))).toBe(true);
  });
});
