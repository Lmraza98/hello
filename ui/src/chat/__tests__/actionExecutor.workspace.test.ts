import { describe, expect, it } from 'vitest';
import { shouldPreferFullscreenForBrowserAction } from '../actionExecutor';

describe('actionExecutor workspace/browser helpers', () => {
  it('marks browser workflow actions as fullscreen-preferred', () => {
    expect(shouldPreferFullscreenForBrowserAction('browser.observe')).toBe(true);
    expect(shouldPreferFullscreenForBrowserAction('browser.annotate')).toBe(true);
    expect(shouldPreferFullscreenForBrowserAction('browser.validate')).toBe(true);
    expect(shouldPreferFullscreenForBrowserAction('browser.synthesize')).toBe(true);
  });

  it('keeps non-browser actions as non-fullscreen', () => {
    expect(shouldPreferFullscreenForBrowserAction('browser.navigate')).toBe(false);
    expect(shouldPreferFullscreenForBrowserAction('companies.navigate')).toBe(false);
  });
});
