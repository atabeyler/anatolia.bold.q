import { describe, it, expect } from 'vitest';
import { matchUiCatalogAction, SCREENS, UI_CATALOG } from './voiceUiCatalog.js';

describe('voiceUiCatalog', () => {
  it('matches a known navigation phrase to its catalog entry', () => {
    const entry = matchUiCatalogAction('ana ekrana dön', SCREENS.DASHBOARD_ANALYSIS);
    expect(entry?.action).toBe('navigate_home');
  });

  it('matches across languages for the same target', () => {
    expect(matchUiCatalogAction('go home', SCREENS.DASHBOARD_HOME)?.action).toBe('navigate_home');
    expect(matchUiCatalogAction('zur startseite', SCREENS.DASHBOARD_HOME)?.action).toBe('navigate_home');
  });

  it('returns null for unrecognized text', () => {
    expect(matchUiCatalogAction('bugün hava nasıl', SCREENS.DASHBOARD_HOME)).toBeNull();
  });

  it('flags logout as requiring confirmation', () => {
    const entry = matchUiCatalogAction('çıkış yap', SCREENS.DASHBOARD_HOME);
    expect(entry?.action).toBe('logout');
    expect(entry?.requiresConfirmation).toBe(true);
  });

  it('every catalog entry declares a non-empty validOn and synonym set', () => {
    for (const entry of UI_CATALOG) {
      expect(entry.action?.trim()).toBeTruthy();
      expect(Array.isArray(entry.validOn) && entry.validOn.length > 0).toBe(true);
      expect(Object.keys(entry.synonyms || {}).length).toBeGreaterThan(0);
    }
  });
});
