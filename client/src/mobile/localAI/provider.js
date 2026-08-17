import { selectProvider } from './registry.js';

// The local AI "provider" is intentionally just the one built-in offline
// engine today (see registry.js's PROVIDERS list) — swapping in or adding
// a real local model later only means registering it there; nothing above
// this module needs to change. Mirrors desktop/localAI/provider.js.
//
// Report *generation* stays cloud-only via the existing /api/analysis
// endpoints; this module only ever answers read-only questions about
// reports already sitting in the local database.
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
        // instead, so the UI can show "yerel AI şu anda kullanılamıyor"
        // rather than an unhandled error. err.message only, never the
        // request/response content itself (may contain report text).
        diagnostics?.error('local_ai_failure', { message: err.message, capability: provider.capability });
        return { ok: false, error: 'Yerel AI kullanılamıyor', detail: err.message };
      }
    },
  };
}
