import { selectProvider, PROVIDERS } from './registry.js';

// The local AI "provider" tries the registry's providers in preference
// order (see registry.js's PROVIDERS list) and falls through automatically
// from local-llm to offline-extractive when the model turns out unusable
// for THIS request -- llmProvider.js throws the sentinel message
// 'local_llm_unavailable' specifically for that case (a device/model state
// that changed between selectProvider()'s cheap sync check and the actual
// call, e.g. the model file was removed mid-session). Any other error is
// NOT swallowed into a silent fallback -- it's surfaced as ok:false so a
// real bug in one engine never masquerades as "answered by another engine"
// (spec point 9: never silently pretend success).
//
// `.capability` on the returned object is the provider selectProvider()
// would pick right now (informational / for logging); the response from
// query() always carries its own `capability`, which is the engine that
// ACTUALLY produced that specific answer -- callers (the Analysis Router,
// the UI indicator) must read the per-response field, not this one, since
// they can differ when a fallback happened.
export function createLocalAIProvider({ db, userId, diagnostics }) {
  const provider = selectProvider();
  return {
    capability: provider.capability,
    async query(request) {
      const startIndex = PROVIDERS.findIndex((p) => p.capability === provider.capability);
      const candidates = PROVIDERS.slice(Math.max(startIndex, 0)).filter((p) => p.isAvailable());
      // selectProvider() itself is always in the candidate list (its own
      // isAvailable() just returned true), so candidates is never empty.

      for (let i = 0; i < candidates.length; i++) {
        const current = candidates[i];
        const isLast = i === candidates.length - 1;
        try {
          const runQuery = current.createQuery({ db, userId });
          const result = await runQuery(request);
          return { ok: true, capability: current.capability, ...result };
        } catch (err) {
          const isRecoverableLLMFailure = current.capability === 'local-llm' && err.message === 'local_llm_unavailable';
          if (isRecoverableLLMFailure && !isLast) {
            diagnostics?.warn?.('local_llm_fallback', { message: err.message });
            continue; // try the next provider (offline-extractive)
          }
          // Never throws past this boundary (spec: a missing/broken local
          // AI backend must not crash the app) — reported as a capability
          // flag instead, so the renderer can show "yerel AI şu anda
          // kullanılamıyor" rather than an unhandled error. err.message
          // only, never the request/response content itself (may contain
          // report text).
          diagnostics?.error('local_ai_failure', { message: err.message, capability: current.capability });
          return { ok: false, error: 'Yerel AI kullanılamıyor', detail: err.message, capability: current.capability };
        }
      }
      return { ok: false, error: 'Yerel AI kullanılamıyor', detail: 'no_provider_available' };
    },
  };
}
