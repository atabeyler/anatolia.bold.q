import { selectProvider, _internal } from './registry.js';

// Mirrors desktop/localAI/provider.js's fallback behavior exactly (see
// that module's comment for the full rationale): tries the selected
// provider, and if it's local-llm failing with the 'local_llm_unavailable'
// sentinel, falls through to offline-extractive within the same call
// instead of surfacing a broken "local LLM" answer to the UI. Any other
// error is surfaced as ok:false, never masked by a silent fallback.
export function createLocalAIProvider({ db, userId, diagnostics }) {
  const provider = selectProvider();
  return {
    capability: provider.capability,
    async query(request) {
      const { PROVIDERS } = _internal;
      const startIndex = PROVIDERS.findIndex((p) => p.capability === provider.capability);
      const candidates = PROVIDERS.slice(Math.max(startIndex, 0)).filter((p) => p.isAvailable());

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
            continue;
          }
          diagnostics?.error('local_ai_failure', { message: err.message, capability: current.capability });
          return { ok: false, error: 'Yerel AI kullanılamıyor', detail: err.message, capability: current.capability };
        }
      }
      return { ok: false, error: 'Yerel AI kullanılamıyor', detail: 'no_provider_available' };
    },
  };
}
