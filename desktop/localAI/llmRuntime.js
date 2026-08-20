// Thin wrapper around node-llama-cpp (MIT license, prebuilt bindings for
// Windows/macOS/Linux -- see the model/runtime evaluation in the final
// report). Isolated in its own module, behind a factory, so:
//   1. llmProvider.js and its tests never import node-llama-cpp directly
//      -- they take a `runtime` object shaped exactly like what this
//      factory returns, and tests inject a fake one. This is the same
//      dependency-injection seam pattern already used by
//      registry.js/provider.js (see their comments).
//   2. A machine where node-llama-cpp isn't installed/buildable (e.g. this
//      sandbox has no GPU and may not have build tools for every target)
//      degrades to "runtime unavailable" instead of crashing at import
//      time -- the dynamic import below is wrapped in try/catch.
//
// node-llama-cpp is intentionally NOT a hard dependency in package.json's
// "dependencies" (it's a large native addon with per-platform prebuilds);
// see package.json's optionalDependencies and the final report for what
// was/wasn't verified in this sandbox.
let cachedModule = null;
let cachedModuleError = null;

async function loadNodeLlamaCpp() {
  if (cachedModule) return cachedModule;
  if (cachedModuleError) throw cachedModuleError;
  try {
    // eslint-disable-next-line import/no-unresolved -- optional dependency, see above
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

// Real factory: loads node-llama-cpp, loads the given GGUF file, and
// returns a small { generate, dispose } surface. Never called directly by
// llmProvider.js in tests -- only by the production wiring in
// desktop/main.js / registry.js's default provider construction.
export async function createLlamaRuntime({ modelPath, contextSize = 4096, systemPrompt } = {}) {
  const { getLlama, LlamaChatSession } = await loadNodeLlamaCpp();
  const llama = await getLlama();
  const model = await llama.loadModel({ modelPath });
  const context = await model.createContext({ contextSize });
  // Passing the instruction as the chat session's systemPrompt (rather
  // than concatenating it into the user-turn text) was verified in this
  // sandbox to matter a lot for a chat-tuned model like Qwen2.5-Instruct --
  // concatenating it into one big user message made the model narrate
  // about the prompt instead of answering it; a real systemPrompt gave a
  // direct, correctly-grounded answer in the same smoke test. See the
  // final report.
  const session = new LlamaChatSession({ contextSequence: context.getSequence(), systemPrompt });

  return {
    async generate(prompt, { maxTokens = 512, temperature = 0.3 } = {}) {
      return session.prompt(prompt, { maxTokens, temperature });
    },
    async dispose() {
      await context.dispose?.();
      await model.dispose?.();
    },
  };
}
