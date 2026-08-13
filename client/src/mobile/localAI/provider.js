import { queryOffline } from './offlineExtractive.js';

// The local AI "provider" is intentionally just this one built-in offline
// engine today — swapping in a real local model later only means
// implementing the same query(db, userId, request) shape and wiring it in
// here; nothing above this module needs to change. Mirrors
// desktop/localAI/provider.js.
//
// Report *generation* stays cloud-only via the existing /api/analysis
// endpoints; this module only ever answers read-only questions about
// reports already sitting in the local database.
export function createLocalAIProvider({ db, userId }) {
  return {
    capability: 'offline-extractive',
    async query(request) {
      try {
        return { ok: true, ...(await queryOffline(db, userId, request)) };
      } catch (err) {
        // Never throws past this boundary (spec: a missing/broken local AI
        // backend must not crash the app) — reported as a capability flag
        // instead, so the UI can show "yerel AI şu anda kullanılamıyor"
        // rather than an unhandled error.
        return { ok: false, error: 'Yerel AI kullanılamıyor', detail: err.message };
      }
    },
  };
}
