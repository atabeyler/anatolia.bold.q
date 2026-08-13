import { selectProvider } from './registry.js';

// The local AI "provider" is intentionally just the one built-in offline
// engine today (see registry.js's PROVIDERS list) — swapping in or adding
// a real local LLM (e.g. node-llama-cpp) later only means registering it
// there; nothing above this module (the IPC handler, the renderer) needs
// to change, since this factory always exposes the same query() shape
// regardless of which registered provider ends up selected.
//
// Report *generation* (a brand new AI-written analysis, optionally with the
// quantum kernel) is deliberately not part of this provider — that already
// exists as the cloud-only /api/analysis endpoints and stays that way; this
// module only ever answers read-only questions about reports already sitting
// in the local database.
export function createLocalAIProvider({ db, userId, diagnostics }) {
  const provider = selectProvider();
  const runQuery = provider.createQuery({ db, userId });
  return {
    capability: provider.capability,
    async query(request) {
      try {
        return { ok: true, ...(await runQuery(request)) };
      } catch (err) {
        // Never throws past this boundary (spec: a missing/broken local AI
        // backend must not crash the app) — reported as a capability flag
        // instead, so the renderer can show "yerel AI şu anda kullanılamıyor"
        // rather than an unhandled error. err.message only, never the
        // request/response content itself (may contain report text).
        diagnostics?.error('local_ai_failure', { message: err.message, capability: provider.capability });
        return { ok: false, error: 'Yerel AI kullanılamıyor', detail: err.message };
      }
    },
  };
}
