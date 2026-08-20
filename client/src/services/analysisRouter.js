import { ENGINE, normalizeCloudAnalysis, normalizeLocalLLMAnalysis, normalizeLocalDataAnalysis, normalizeLocalChat } from './aiContract.js';

// The single place implementing the priority chain from the task spec:
//   1. Cloud reachable        -> Q CLOUD (existing behavior, unchanged)
//   2. Cloud unreachable      -> Q LOCAL LLM (new)
//   3. Local LLM unavailable  -> existing extractive Q LOCAL DATA
//   4. Nothing available      -> a clear, honest error (never silently
//                                pretend success)
//
// AnalysisView.jsx and ConsultChat.jsx both call this instead of talking
// to api.js or nativeAI directly, so there is exactly one fallback
// implementation instead of one per UI caller (task spec point 4).
//
// `isOffline` is the same boolean both callers already compute today
// (isNativeApp && connectivity === 'local') -- passed in rather than
// recomputed here so this module has no React/nativeBridge dependency of
// its own and stays trivially unit-testable.
export class AllEnginesUnavailableError extends Error {
  constructor(message = 'Hiçbir AI motoru şu anda kullanılamıyor.') {
    super(message);
    this.code = 'ALL_ENGINES_UNAVAILABLE';
  }
}

// request must be able to route into nativeAI.query({ mode: 'generate', ... }):
// see desktop/localAI/llmProvider.js and client/src/mobile/localAI/llmProvider.js
// for what that request shape supports.
export async function routeAnalysisGeneration({ isOffline, cloudCall, nativeAIQuery, generateRequest }) {
  if (!isOffline) {
    // Cloud is the default path and unchanged -- any cloud failure here
    // (network blip, server error) is surfaced as-is to preserve today's
    // error messages/behavior for the by-far-most-common path, rather than
    // silently retrying against local engines the user didn't ask for.
    const cloudResult = await cloudCall();
    return normalizeCloudAnalysis(cloudResult);
  }

  if (!nativeAIQuery) throw new AllEnginesUnavailableError();

  const response = await nativeAIQuery({ mode: 'generate', ...generateRequest });
  if (!response?.ok) throw new AllEnginesUnavailableError(response?.error || undefined);

  if (response.capability === 'local-llm') return normalizeLocalLLMAnalysis(response);
  if (response.capability === 'offline-extractive') return normalizeLocalDataAnalysis(response);
  throw new AllEnginesUnavailableError();
}

// Chat/consult variant: cloud path is the caller's existing streaming
// chatConsult() call (kept exactly as-is, including streaming callbacks);
// the offline path goes through the same local provider chain.
export async function routeConsultChat({ isOffline, cloudCall, nativeAIQuery, chatText }) {
  if (!isOffline) {
    const r = await cloudCall();
    return { engine: ENGINE.CLOUD, ok: true, content: r.content, providerLabel: r.provider, raw: r };
  }
  if (!nativeAIQuery) throw new AllEnginesUnavailableError();
  const response = await nativeAIQuery({ mode: 'chat', text: chatText });
  const normalized = normalizeLocalChat(response);
  if (!normalized.ok) throw new AllEnginesUnavailableError(normalized.error);
  return normalized;
}

export { ENGINE };
