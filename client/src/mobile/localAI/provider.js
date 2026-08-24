import { selectProvider, _internal } from './registry.js';

// Mirrors desktop/localAI/provider.js's fallback behavior (see that
// module's comment for the full rationale): tries the selected provider,
// and if it's local-llm failing with a known-recoverable sentinel, falls
// through to offline-extractive within the same call instead of surfacing
// a broken "local LLM" answer to the UI. Any other (unexpected) error is
// surfaced as ok:false, never masked by a silent fallback, so a genuine
// bug in the local-llm path stays visible instead of being hidden behind
// a degraded archive answer.
//
// 'local_llm_unavailable' is llmProvider.js's own per-request capability
// check. 'android_native_llm_plugin_missing' is llmRuntime.js's -- it's
// what actually fires on a real device where the native LocalLLM
// Capacitor plugin isn't reachable from JS (observed firsthand: Settings
// > Local AI showed the RAM/disk capacity fields empty too, both reading
// through the same plugin call, on a device where "Yeni Analiz" then
// failed with no fallback at all). Both are expected, recoverable
// environment states, not bugs -- treating only the first one as
// recoverable, as before, silently broke the archive fallback whenever
// the plugin itself was the actual problem.
const RECOVERABLE_LOCAL_LLM_ERRORS = new Set(['local_llm_unavailable', 'android_native_llm_plugin_missing']);

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
          const isRecoverableLLMFailure = current.capability === 'local-llm' && RECOVERABLE_LOCAL_LLM_ERRORS.has(err.message);
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
