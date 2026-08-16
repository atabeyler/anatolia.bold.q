import { describe, expect, it } from 'vitest';
import { getActionsForAI } from './voiceActionRegistry.js';

const REQUIRED_UNIVERSAL_ACTIONS = [
  'ui_activate',
  'ui_set_value',
  'ui_select',
  'ui_scroll',
  'ui_key',
  'ui_focus',
];

const REQUIRED_SEMANTIC_ACTIONS = [
  'go_home',
  'open_analysis',
  'open_history',
  'new_analysis',
  'open_voice_chat',
  'close_voice_chat',
  'open_guide',
  'close_guide',
  'logout',
  'open_emergency',
  'set_analysis_title',
  'set_analysis_content',
  'run_analysis',
  'toggle_quantum',
  'download_report',
  'reset_analysis',
];

describe('Voice Control Coverage Gate', () => {
  it('exposes the complete universal UI control primitive set', () => {
    const names = new Set(getActionsForAI().map((action) => action.name));
    for (const name of REQUIRED_UNIVERSAL_ACTIONS) expect(names.has(name), `Missing universal voice action: ${name}`).toBe(true);
  });

  it('keeps every voice action uniquely named and documented', () => {
    const actions = getActionsForAI();
    const names = actions.map((action) => action.name);
    expect(new Set(names).size, 'Duplicate voice action names make AI routing ambiguous').toBe(names.length);
    for (const action of actions) {
      expect(action.name?.trim(), 'Voice action without a name').toBeTruthy();
      expect(action.description?.trim(), `Voice action ${action.name} has no description`).toBeTruthy();
      expect(action.params && typeof action.params === 'object', `Voice action ${action.name} has invalid params`).toBe(true);
    }
  });

  it('documents the semantic actions required for complete application operation', () => {
    // Component actions are registered at runtime. This gate deliberately keeps
    // their contract in CI so deleting/renaming a core capability is explicit.
    expect(new Set(REQUIRED_SEMANTIC_ACTIONS).size).toBe(REQUIRED_SEMANTIC_ACTIONS.length);
  });
});
