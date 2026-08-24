// Pinned local-LLM models for Android, tiered by device RAM. The MID tier
// is the exact same model desktop/localAI/modelSpec.js pins (Qwen2.5-1.5B-
// Instruct, Q4_K_M) -- Android does not contradict the desktop model
// choice, it brackets it with a smaller LOW tier for weaker phones and a
// larger HIGH tier for phones that can comfortably afford it, per the task
// spec's "low-end -> 0.5-1.5B, mid/good -> 1.5-3B, high-end -> larger,
// optional" tiering.
//
// All three sha256/sizeBytes values below were read the same way the
// existing MID entry was (each file's HTTP redirect chain to Hugging
// Face's CDN exposes X-Linked-ETag, which for an LFS/Xet-backed file is
// its SHA-256; X-Linked-Size is the exact byte count) -- verified in this
// sandbox via a real HTTPS HEAD-style request on 2026-08-20, not invented.
// Still: re-verify against the actual shipped file before release (a
// repo's default `main` file can move) -- see the final report.
const LOW = Object.freeze({
  id: 'qwen2.5-0.5b-instruct-q4_k_m',
  tier: 'low',
  label: 'Qwen2.5-0.5B-Instruct (Q4_K_M, GGUF)',
  filename: 'qwen2.5-0.5b-instruct-q4_k_m.gguf',
  url: 'https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/qwen2.5-0.5b-instruct-q4_k_m.gguf',
  sha256: '74a4da8c9fdbcd15bd1f6d01d621410d31c6fc00986f5eb687824e7b93d7a9db',
  sizeBytes: 491400032,
  license: 'Apache-2.0',
  contextSize: 1536,
  // Floor of the "capable" range for this tier -- below this, no tier is
  // offered at all (see selectTierForDevice) and the app fails safe into
  // offline-extractive rather than risking an OOM kill.
  recommendedMinRamBytes: 3 * 1024 * 1024 * 1024,
  recommendedMinFreeDiskBytes: 1 * 1024 * 1024 * 1024,
});

// Unchanged from the original single-tier pin -- same id/filename/url/
// checksum/context size as before this task, and the same model desktop
// uses. Mid-range/good Android phones (6-8 GB RAM) land here.
const MID = Object.freeze({
  id: 'qwen2.5-1.5b-instruct-q4_k_m',
  tier: 'mid',
  label: 'Qwen2.5-1.5B-Instruct (Q4_K_M, GGUF)',
  filename: 'qwen2.5-1.5b-instruct-q4_k_m.gguf',
  url: 'https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/qwen2.5-1.5b-instruct-q4_k_m.gguf',
  sha256: '6a1a2eb6d15622bf3c96857206351ba97e1af16c30d7a74ee38970e434e9407e',
  sizeBytes: 1117320736,
  license: 'Apache-2.0',
  contextSize: 2048,
  recommendedMinRamBytes: 6 * 1024 * 1024 * 1024,
  recommendedMinFreeDiskBytes: 2.5 * 1024 * 1024 * 1024,
});

// High-end tier -- optional per the task spec ("a larger model, optional").
// Still a 4-bit quant, still realistic to run (slowly) on an 8 GB+ phone's
// CPU via llama.cpp's Android NEON kernels, but this is the tier most
// likely to feel sluggish on real hardware -- flagged honestly in the
// final report as the least field-tested choice of the three.
const HIGH = Object.freeze({
  id: 'qwen2.5-3b-instruct-q4_k_m',
  tier: 'high',
  label: 'Qwen2.5-3B-Instruct (Q4_K_M, GGUF)',
  filename: 'qwen2.5-3b-instruct-q4_k_m.gguf',
  url: 'https://huggingface.co/Qwen/Qwen2.5-3B-Instruct-GGUF/resolve/main/qwen2.5-3b-instruct-q4_k_m.gguf',
  sha256: '626b4a6678b86442240e33df819e00132d3ba7dddfe1cdc4fbb18e0a9615c62d',
  sizeBytes: 2104932768,
  license: 'Apache-2.0',
  contextSize: 2048,
  recommendedMinRamBytes: 8 * 1024 * 1024 * 1024,
  recommendedMinFreeDiskBytes: 4 * 1024 * 1024 * 1024,
});

export const MODEL_TIERS = Object.freeze({ low: LOW, mid: MID, high: HIGH });

// Backward-compatible single-spec export -- the MID tier, i.e. exactly what
// this file exported before tiering existed. modelManager.js's default
// `spec` param and any caller that hasn't opted into tiering yet keeps
// working unchanged.
export const MODEL_SPEC = MID;

// Picks the richest tier a device can realistically run, or null if the
// device doesn't clear even the LOW floor -- callers must treat null as
// "no local-llm tier available on this device" and fail safe into
// offline-extractive, same as deviceCapability.js's own no-RAM-signal
// fail-safe. `deviceInfo` is `{ totalMemBytes, freeDiskBytes }` (or
// undefined/null) -- the same native-device-info shape llmRuntime.js's
// getNativeDeviceInfo() returns from the Capacitor plugin.
//
// HIGH is intentionally never returned here for now: a real 12GB-RAM
// device (a flagship, comfortably above HIGH.recommendedMinRamBytes)
// generating with the 3B model got killed by Android mid-generation with
// the app in the foreground the whole time -- a native OOM kill (or an
// OEM-level "unresponsive foreground app" kill during the long CPU-bound
// generate() call) neither JS nor the Kotlin plugin's try/catch can
// observe or recover from, since the whole process is torn down
// externally. HIGH was already flagged as "the least field-tested choice
// of the three" when it was added; capping every device at MID -- the
// exact model desktop's already-validated path uses -- until HIGH has
// actually been proven stable on real hardware is the safer default.
// Re-enable by restoring `if (ram >= HIGH.recommendedMinRamBytes) return
// HIGH;` once that validation has happened.
export function selectTierForDevice(deviceInfo) {
  const ram = deviceInfo?.totalMemBytes;
  if (typeof ram !== 'number' || ram <= 0) return null;
  if (ram >= MID.recommendedMinRamBytes) return MID;
  if (ram >= LOW.recommendedMinRamBytes) return LOW;
  return null;
}
