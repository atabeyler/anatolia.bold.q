// Android local-LLM runtime seam. Unlike desktop (node-llama-cpp runs
// directly in the Electron main process), a Capacitor WebView has no
// access to a native llama.cpp binding from plain JS -- real on-device
// inference here requires a custom native Capacitor plugin (Kotlin,
// wrapping llama.cpp compiled for Android via the NDK/JNI, following the
// approach llama.cpp's own Android sample app uses). That plugin does NOT
// exist in this repo yet -- building and testing it needs a real Android
// toolchain/device this sandbox doesn't have (no emulator, no GPU/NNAPI
// hardware to validate against). See the final report's Android follow-up
// for exactly what the owner needs to add.
//
// What's real here: the plugin-call seam itself, matching the exact same
// { generate, dispose } shape desktop/localAI/llmRuntime.js exposes, so
// llmProvider.js (identical file on both platforms in spirit) never
// branches on platform -- once a real `LocalLLM` Capacitor plugin is
// registered, this factory picks it up with zero changes to
// llmProvider.js or above.
export function getCapacitorPlugin(pluginName, capacitorGlobal) {
  const cap = capacitorGlobal || (typeof window !== 'undefined' ? window.Capacitor : undefined);
  return cap?.Plugins?.[pluginName];
}

export function isRuntimeInstallable({ capacitorGlobal } = {}) {
  return !!getCapacitorPlugin('LocalLLM', capacitorGlobal);
}

// Real device-RAM/disk reading from the native plugin (ActivityManager.
// MemoryInfo + StatFs on the Kotlin side -- see LocalLLMPlugin.kt's
// getDeviceInfo()), used by modelSpec.js's selectTierForDevice() to pick
// the right model tier and by deviceCapability.js's checkDeviceCapability()
// as `nativeDeviceInfo`. Returns null (never throws) when the plugin isn't
// registered or the call fails -- callers already treat a missing RAM
// signal as "not capable" (deviceCapability.js's fail-safe), so a null
// here correctly routes the app to offline-extractive instead of guessing.
export async function getNativeDeviceInfo({ capacitorGlobal } = {}) {
  const plugin = getCapacitorPlugin('LocalLLM', capacitorGlobal);
  if (!plugin?.getDeviceInfo) return null;
  try {
    const info = await plugin.getDeviceInfo();
    return (info && typeof info.totalMemBytes === 'number') ? info : null;
  } catch {
    return null;
  }
}

// Real factory, shaped exactly like desktop's createLlamaRuntime(). Throws
// a clear error (never silently no-ops) if the native plugin isn't
// registered -- llmProvider.js's caller (provider.js) already treats any
// thrown error from the local-llm provider as "fall through to
// offline-extractive", so an app shipped without the native plugin still
// degrades safely rather than crashing.
export async function createLlamaRuntime({ modelPath, contextSize = 2048, systemPrompt, capacitorGlobal } = {}) {
  const plugin = getCapacitorPlugin('LocalLLM', capacitorGlobal);
  if (!plugin) {
    throw new Error('android_native_llm_plugin_missing');
  }
  await plugin.load({ modelPath, contextSize, systemPrompt });
  return {
    async generate(prompt, { maxTokens = 400, temperature = 0.3 } = {}) {
      const { text } = await plugin.generate({ prompt, maxTokens, temperature });
      return text;
    },
    async dispose() {
      await plugin.unload?.();
    },
  };
}
