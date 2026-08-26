// Thin wrapper around node-llama-cpp (MIT license, prebuilt bindings for
// Windows/macOS/Linux). Isolated in its own module, behind a factory, so
// callers/tests can inject a fake runtime and machines without a usable
// native addon degrade without crashing at import time.
let cachedModule = null;
let cachedModuleError = null;

async function loadNodeLlamaCpp() {
  if (cachedModule) return cachedModule;
  if (cachedModuleError) throw cachedModuleError;
  try {
    // eslint-disable-next-line import/no-unresolved -- optional dependency
    cachedModule = await import('node-llama-cpp');
    return cachedModule;
  } catch (err) {
    cachedModuleError = err;
    throw err;
  }
}

export async function isRuntimeInstallable() {
  try {
    await loadNodeLlamaCpp();
    return true;
  } catch {
    return false;
  }
}

// Real factory: loads node-llama-cpp, the GGUF model and one reusable
// context sequence. The model/context stay warm, but every generate() call
// resets LlamaChatSession history to its initial system-prompt state. This
// matters for the prompt-echo retry in llmProvider.js and also prevents any
// future caller that reuses this runtime from accidentally carrying one
// analysis/chat turn into another independent request.
export async function createLlamaRuntime({ modelPath, contextSize = 4096, systemPrompt } = {}) {
  const { getLlama, LlamaChatSession } = await loadNodeLlamaCpp();
  const llama = await getLlama();
  const model = await llama.loadModel({ modelPath });
  const context = await model.createContext({ contextSize, threads: 0 });
  const session = new LlamaChatSession({ contextSequence: context.getSequence(), systemPrompt });

  return {
    async generate(prompt, { maxTokens = 512, temperature = 0.3, timeoutMs = 60_000 } = {}) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        // node-llama-cpp v3 exposes resetChatHistory() specifically to clear
        // previous user/assistant turns while retaining the initial system
        // state. Do this before every independent inference. In current
        // desktop IPC wiring a provider is usually recreated per request,
        // but this also makes same-request retries and future runtime reuse
        // deterministic instead of history-dependent.
        session.resetChatHistory?.();
        return await session.prompt(prompt, {
          maxTokens,
          temperature,
          signal: controller.signal,
          stopOnAbortSignal: true,
        });
      } catch (err) {
        if (controller.signal.aborted) {
          const timeoutError = new Error('local_llm_timeout');
          timeoutError.cause = err;
          throw timeoutError;
        }
        throw err;
      } finally {
        clearTimeout(timer);
      }
    },
    async dispose() {
      await session.dispose?.();
      await context.dispose?.();
      await model.dispose?.();
    },
  };
}
