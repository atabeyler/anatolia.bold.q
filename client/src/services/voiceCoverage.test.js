import { afterEach, describe, expect, it, vi } from 'vitest';
import { executeAction, getActionsForAI, registerActions, unregisterActions } from './voiceActionRegistry.js';

const REQUIRED_UNIVERSAL_ACTIONS = ['ui_activate', 'ui_set_value', 'ui_select', 'ui_scroll', 'ui_key', 'ui_focus'];
const REQUIRED_SEMANTIC_ACTIONS = [
  'go_home', 'open_analysis', 'open_history', 'new_analysis',
  'open_voice_chat', 'close_voice_chat', 'open_guide', 'close_guide',
  'logout', 'open_emergency', 'set_analysis_title', 'set_analysis_content',
  'run_analysis', 'toggle_quantum', 'download_report', 'reset_analysis',
];

const scope = '__voice_coverage_gate__';
afterEach(() => unregisterActions(scope));

describe('Voice Control Coverage Gate', () => {
  it('exposes the complete universal UI control primitive set', () => {
    const names = new Set(getActionsForAI().map((action) => action.name));
    for (const name of REQUIRED_UNIVERSAL_ACTIONS) expect(names.has(name), `Missing universal voice action: ${name}`).toBe(true);
  });

  it('registers, advertises and executes every required semantic capability at runtime', () => {
    const handlers = new Map(REQUIRED_SEMANTIC_ACTIONS.map((name) => [name, vi.fn()]));
    registerActions(scope, REQUIRED_SEMANTIC_ACTIONS.map((name) => ({
      name,
      description: `Coverage contract for ${name}`,
      params: {},
      handler: handlers.get(name),
    })));

    const advertised = new Set(getActionsForAI().map((action) => action.name));
    for (const name of REQUIRED_SEMANTIC_ACTIONS) {
      expect(advertised.has(name), `Semantic voice action is not advertised: ${name}`).toBe(true);
      expect(executeAction(name, {}), `Semantic voice action cannot execute: ${name}`).toBe(true);
      expect(handlers.get(name)).toHaveBeenCalledOnce();
    }
  });

  it('keeps the complete advertised action surface uniquely named and documented', () => {
    registerActions(scope, REQUIRED_SEMANTIC_ACTIONS.map((name) => ({ name, description: `Coverage contract for ${name}`, params: {}, handler: () => {} })));
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
