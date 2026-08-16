import { afterEach, describe, expect, it, vi } from 'vitest';
import { executeAction, getActionsForAI, registerActions, unregisterActions } from './voiceActionRegistry.js';
import { buildDashboardVoiceActions } from './dashboardVoiceActions.js';

const REQUIRED_UNIVERSAL_ACTIONS = ['ui_activate', 'ui_set_value', 'ui_select', 'ui_scroll', 'ui_key', 'ui_focus'];
const REQUIRED_SEMANTIC_ACTIONS = [
  'navigate_home', 'navigate_analysis', 'navigate_history', 'new_analysis',
  'open_voice_chat', 'close_voice_chat', 'open_guide', 'close_guide',
  'logout', 'open_emergency', 'set_analysis_title', 'set_analysis_prompt',
  'generate_analysis', 'toggle_quantum', 'download_analysis', 'reset_analysis',
];

const scope = '__voice_coverage_gate__';
afterEach(() => unregisterActions(scope));

// Builds the actual DashboardPage actions with mock deps, so this file tests
// what the app really registers — not a hand-copied list that can drift.
function registerRealDashboardActions() {
  const deps = {
    setView: vi.fn(),
    setActiveCategory: vi.fn(),
    setHistoryOpen: vi.fn(),
    setVoiceChatOpen: vi.fn(),
    setGuideOpen: vi.fn(),
    setJWT: vi.fn(),
    disconnectSocket: vi.fn(),
    onLogout: vi.fn(),
    dispatch: vi.fn(),
  };
  const actions = buildDashboardVoiceActions(deps);
  registerActions(scope, actions);
  return deps;
}

describe('Voice Control Coverage Gate', () => {
  it('exposes the complete universal UI control primitive set', () => {
    const names = new Set(getActionsForAI().map((action) => action.name));
    for (const name of REQUIRED_UNIVERSAL_ACTIONS) expect(names.has(name), `Missing universal voice action: ${name}`).toBe(true);
  });

  it('registers and advertises every required semantic action DashboardPage actually exposes', () => {
    registerRealDashboardActions();
    const advertised = new Set(getActionsForAI().map((action) => action.name));
    for (const name of REQUIRED_SEMANTIC_ACTIONS) {
      expect(advertised.has(name), `Semantic voice action is not advertised: ${name}`).toBe(true);
    }
    // Catches names removed/renamed in DashboardPage that this gate doesn't know about yet.
    for (const action of buildDashboardVoiceActions({
      setView: vi.fn(), setActiveCategory: vi.fn(), setHistoryOpen: vi.fn(), setVoiceChatOpen: vi.fn(),
      setGuideOpen: vi.fn(), setJWT: vi.fn(), disconnectSocket: vi.fn(), onLogout: vi.fn(), dispatch: vi.fn(),
    })) {
      expect(REQUIRED_SEMANTIC_ACTIONS.includes(action.name), `Undocumented semantic voice action: ${action.name}`).toBe(true);
    }
  });

  it('actually invokes the real DashboardPage handler for each required action', () => {
    const deps = registerRealDashboardActions();

    expect(executeAction('navigate_home', {})).toBe(true);
    expect(deps.setView).toHaveBeenCalledWith('home');

    expect(executeAction('navigate_analysis', { category: 'enerji' })).toBe(true);
    expect(deps.setActiveCategory).toHaveBeenCalledWith('enerji');
    expect(deps.setView).toHaveBeenCalledWith('analysis');

    expect(executeAction('navigate_history', {})).toBe(true);
    expect(deps.setHistoryOpen).toHaveBeenCalledWith(true);

    expect(executeAction('new_analysis', {})).toBe(true);
    expect(deps.setActiveCategory).toHaveBeenCalledWith(null);

    expect(executeAction('open_voice_chat', {})).toBe(true);
    expect(deps.setVoiceChatOpen).toHaveBeenCalledWith(true);

    expect(executeAction('close_voice_chat', {})).toBe(true);
    expect(deps.setVoiceChatOpen).toHaveBeenCalledWith(false);

    expect(executeAction('open_guide', {})).toBe(true);
    expect(deps.setGuideOpen).toHaveBeenCalledWith(true);

    expect(executeAction('close_guide', {})).toBe(true);
    expect(deps.setGuideOpen).toHaveBeenCalledWith(false);

    expect(executeAction('logout', {})).toBe(true);
    expect(deps.setJWT).toHaveBeenCalledWith(null);
    expect(deps.disconnectSocket).toHaveBeenCalled();
    expect(deps.onLogout).toHaveBeenCalled();

    expect(executeAction('open_emergency', {})).toBe(true);
    expect(deps.dispatch).toHaveBeenCalledWith('aq:emergency:open', {});

    expect(executeAction('set_analysis_title', { value: 'Rapor' })).toBe(true);
    expect(deps.dispatch).toHaveBeenCalledWith('aq:analysis:set', { field: 'title', value: 'Rapor' });

    expect(executeAction('set_analysis_prompt', { value: 'Brief' })).toBe(true);
    expect(deps.dispatch).toHaveBeenCalledWith('aq:analysis:set', { field: 'prompt', value: 'Brief' });

    expect(executeAction('generate_analysis', {})).toBe(true);
    expect(deps.dispatch).toHaveBeenCalledWith('aq:analysis:generate', {});

    expect(executeAction('toggle_quantum', { mode: 'off' })).toBe(true);
    expect(deps.dispatch).toHaveBeenCalledWith('aq:analysis:quantum', { mode: 'off' });

    expect(executeAction('download_analysis', {})).toBe(true);
    expect(deps.dispatch).toHaveBeenCalledWith('aq:analysis:download', {});

    expect(executeAction('reset_analysis', {})).toBe(true);
    expect(deps.dispatch).toHaveBeenCalledWith('aq:analysis:reset', {});
  });

  it('keeps the complete advertised action surface uniquely named and documented', () => {
    registerRealDashboardActions();
    const actions = getActionsForAI();
    const names = actions.map((action) => action.name);
    expect(new Set(names).size, 'Duplicate voice action names make AI routing ambiguous').toBe(names.length);
    for (const action of actions) {
      expect(action.name?.trim(), 'Voice action without a name').toBeTruthy();
      expect(action.description?.trim(), `Voice action ${action.name} has no description`).toBeTruthy();
      expect(action.params && typeof action.params === 'object', `Voice action ${action.name} has invalid params`).toBe(true);
    }
  });
});
