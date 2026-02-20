import { describe, expect, it } from 'vitest';
import { routeClassForPath } from '../workspaceLayout';

describe('workspaceLayout route classing', () => {
  it('classifies browser routes distinctly', () => {
    expect(routeClassForPath('/browser')).toBe('browser');
    expect(routeClassForPath('/browser/details')).toBe('browser');
  });

  it('classifies non-browser routes as default', () => {
    expect(routeClassForPath('/dashboard')).toBe('default');
    expect(routeClassForPath('/companies')).toBe('default');
  });
});
