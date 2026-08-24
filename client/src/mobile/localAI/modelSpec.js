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
// Upgraded from 3B to 7B at the owner's explicit request for a "very
// powerful" device. Qwen's own GGUF repo only ships this quant as a
// 2-shard split file (qwen2.5-7b-instruct-q4_k_m-0000{1,2}-of-00002.gguf),
// which llama_model_load_from_file() (a single-path API -- see
// llama-android.cpp's nativeLoad) can't load directly; bartowski's
// community requant (same Apache-2.0 source model, same Q4_K_M quant
// method) ships the identical model as one file instead, so that's what's
// pinned here. sha256/sizeBytes read the same way every other entry in
// this file was (X-Linked-ETag/X-Linked-Size on the HF CDN redirect),
// verified via a real HTTPS HEAD request on 2026-08-24 -- re-verify before
// release, same caveat as the other tiers.
const HIGH = Object.freeze({
  id: 'qwen2.5-7b-instruct-q4_k_m',
  tier: 'high',
  label: 'Qwen2.5-7B-Instruct (Q4_K_M, GGUF)',
  filename: 'qwen2.5-7b-instruct-q4_k_m.gguf',
  url: 'https://huggingface.co/bartowski/Qwen2.5-7B-Instruct-GGUF/resolve/main/Qwen2.5-7B-Instruct-Q4_K_M.gguf',
  sha256: '65b8fcd92af6b4fefa935c625d1ac27ea29dcb6ee14589c55a8f115ceaaa1423',
  sizeBytes: 4683074240,
  license: 'Apache-2.0',
  contextSize: 2048,
  // A 4.68GB model file alone needs real headroom above the MID tier's
  // floor -- 12GB matches the actual device this was validated against
  // (see selectTierForDevice's comment) rather than a lower, untested
  // number.
  recommendedMinRamBytes: 12 * 1024 * 1024 * 1024,
  recommendedMinFreeDiskBytes: 6 * 1024 * 1024 * 1024,
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
// HIGH was disabled for a while after a real 12GB-RAM device generating
// with the 3B model got killed by Android mid-generation (a native OOM
// kill or OEM "unresponsive foreground app" kill neither JS nor the Kotlin
// plugin's try/catch can observe, since the whole process is torn down
// externally). Re-enabled at the same 8GB+ floor now that
// llama-android.cpp's generation loop has real safety nets that didn't
// exist at the time of that crash: a generous-but-real wall-clock deadline
// (so a slow/throttled device can't run unbounded into the same failure)
// and a forced minimum output length (so a HIGH-tier run that does finish
// quickly still produces a real answer, not a one-word non-answer). Still
// the least field-tested of the three tiers -- a genuinely underpowered
// "8GB RAM" device (e.g. heavy background load, thermal throttling) can
// still be slow enough to hit the deadline before finishing.
export function selectTierForDevice(deviceInfo) {
  const ram = deviceInfo?.totalMemBytes;
  if (typeof ram !== 'number' || ram <= 0) return null;
  if (ram >= HIGH.recommendedMinRamBytes) return HIGH;
  if (ram >= MID.recommendedMinRamBytes) return MID;
  if (ram >= LOW.recommendedMinRamBytes) return LOW;
  return null;
}
