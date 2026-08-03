// Global action registry — each component registers its own actions here.
// GlobalVoiceAssistant passes this list to the AI as context and executes them.

const registry = new Map(); // scope -> Action[]

/**
 * Register a component's voice-controllable actions.
 * Call inside useEffect, unregister on cleanup.
 *
 * @param {string} scope - Unique name (e.g. 'login-page', 'dashboard')
 * @param {Array<{name: string, description: string, params: object, handler: function}>} actions
 */
export function registerActions(scope, actions) {
  registry.set(scope, actions);
}

export function unregisterActions(scope) {
  registry.delete(scope);
}

/**
 * Action list to send to the AI (no handlers, schema only).
 */
export function getActionsForAI() {
  const result = [];
  for (const [, actions] of registry) {
    for (const action of actions) {
      result.push({
        name: action.name,
        description: action.description,
        params: action.params || {},
      });
    }
  }
  return result;
}

/**
 * Run an action by name.
 * @returns {boolean} - true if the action was found and executed
 */
export function executeAction(name, params = {}) {
  for (const [, actions] of registry) {
    const action = actions.find(a => a.name === name);
    if (action?.handler) {
      try {
        action.handler(params);
      } catch (e) {
        console.error('[VoiceRegistry] Action error:', name, e);
      }
      return true;
    }
  }
  console.warn('[VoiceRegistry] Action not found:', name);
  return false;
}
