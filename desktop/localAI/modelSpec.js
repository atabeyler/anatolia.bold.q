// Pinned local-LLM models, tiered by device RAM. Mirrors
// client/src/mobile/localAI/modelSpec.js's tiering shape (duplicated, same
// as the rest of the desktop/* vs client/src/mobile/* split in this
// codebase, so each platform can vary its pinned quants independently).
//
// MID is the original single pinned model this file exported before
// tiering existed -- same id/filename/sha256/contextSize, unchanged, so an
// already-downloaded model on an existing desktop install still matches.
//
//   - License: Apache-2.0 (verified on the model card at
//     https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF on 2026-08-20)
//     -- permissive, no separate commercial license needed, unlike the
//     Qwen license that applies to the 3B/7B+ Qwen2.5 checkpoints.
//   - Turkish: Qwen2.5's tokenizer/training corpus is explicitly
//     multilingual (29+ languages including Turkish per the Qwen2.5
//     technical report); not benchmarked in this sandbox (no GPU-less
//     Turkish eval harness run here -- see the final report).
//   - Size: ~1.07 GB (Q4_K_M), comfortably inside a 4-8 GB RAM desktop
//     budget alongside the rest of the Electron app.
//   - Runtime: node-llama-cpp (MIT), which ships prebuilt llama.cpp
//     bindings for Windows/macOS/Linux -- see llmRuntime.js.
const LOW = Object.freeze({
  id: 'qwen2.5-0.5b-instruct-q4_k_m',
  tier: 'low',
  label: 'Qwen2.5-0.5B-Instruct (Q4_K_M, GGUF)',
  displayLabel: 'Q LOCAL Hafif Model',
  filename: 'qwen2.5-0.5b-instruct-q4_k_m.gguf',
  url: 'https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/qwen2.5-0.5b-instruct-q4_k_m.gguf',
  sha256: '74a4da8c9fdbcd15bd1f6d01d621410d31c6fc00986f5eb687824e7b93d7a9db',
  sizeBytes: 491400032,
  license: 'Apache-2.0',
  contextSize: 1536,
  recommendedMinRamBytes: 3 * 1024 * 1024 * 1024,
  recommendedMinFreeDiskBytes: 1 * 1024 * 1024 * 1024,
});

const MID = Object.freeze({
  id: 'qwen2.5-1.5b-instruct-q4_k_m',
  tier: 'mid',
  label: 'Qwen2.5-1.5B-Instruct (Q4_K_M, GGUF)',
  displayLabel: 'Q LOCAL Standart Model',
  filename: 'qwen2.5-1.5b-instruct-q4_k_m.gguf',
  // Hugging Face resolve URL for the pinned file/revision. Points at
  // `main` (not a pinned commit) intentionally -- Qwen's GGUF repo does
  // not retag revisions for this file, and the checksum below is what
  // actually guards integrity, not the URL.
  url: 'https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/qwen2.5-1.5b-instruct-q4_k_m.gguf',
  // SHA-256 read from the file's HF LFS ETag (X-Linked-ETag header on the
  // resolve redirect) on 2026-08-20 -- HF serves SHA-256-tracked LFS
  // objects with their content hash as the ETag, so this is the real
  // published checksum, not a placeholder.
  sha256: '6a1a2eb6d15622bf3c96857206351ba97e1af16c30d7a74ee38970e434e9407e',
  sizeBytes: 1117320736,
  license: 'Apache-2.0',
  contextSize: 4096,
  // Conservative device gate: llama.cpp needs roughly (model size) +
  // (KV cache for contextSize) + OS/app headroom resident. ~2x the file
  // size is a common rule of thumb for Q4 GGUF at a few-thousand-token
  // context; desktop and mobile apply this to different minimums (see
  // desktop/localAI/deviceCapability.js and
  // client/src/mobile/localAI/deviceCapability.js).
  recommendedMinRamBytes: 4 * 1024 * 1024 * 1024,
  recommendedMinFreeDiskBytes: 3 * 1024 * 1024 * 1024, // model + temp download + headroom
});

// Optional high-end tier for a genuinely capable desktop/laptop -- added
// at the owner's request, mirroring client/src/mobile/localAI/modelSpec.js's
// own HIGH tier (same 7B model, same reasoning for why it's bartowski's
// single-file requant rather than Qwen's own 2-shard split GGUF -- see
// that file's comment). Desktop's own risk profile is milder than a
// phone's (no OS foreground-app watchdog to kill the whole process, no
// battery/thermal constraint on the same scale), but a real download-size
// and RAM floor still apply.
const HIGH = Object.freeze({
  id: 'qwen2.5-7b-instruct-q4_k_m',
  tier: 'high',
  label: 'Qwen2.5-7B-Instruct (Q4_K_M, GGUF)',
  displayLabel: 'Q LOCAL Güçlü Model',
  filename: 'qwen2.5-7b-instruct-q4_k_m.gguf',
  url: 'https://huggingface.co/bartowski/Qwen2.5-7B-Instruct-GGUF/resolve/main/Qwen2.5-7B-Instruct-Q4_K_M.gguf',
  sha256: '65b8fcd92af6b4fefa935c625d1ac27ea29dcb6ee14589c55a8f115ceaaa1423',
  sizeBytes: 4683074240,
  license: 'Apache-2.0',
  contextSize: 4096,
  recommendedMinRamBytes: 12 * 1024 * 1024 * 1024,
  recommendedMinFreeDiskBytes: 6 * 1024 * 1024 * 1024,
});

export const MODEL_TIERS = Object.freeze({ low: LOW, mid: MID, high: HIGH });

// Backward-compatible single-spec export -- the MID tier, i.e. exactly what
// this file exported before tiering existed. Any caller that hasn't opted
// into tiering (createModelManager's default `spec` param) keeps working
// unchanged.
export const MODEL_SPEC = MID;

// `totalMemBytes` and `cpuCount` are plain numbers from os.totalmem()/os.cpus(),
// unlike Android's `{ totalMemBytes }` native-plugin object -- registry.js
// unwraps it before calling this) since desktop reads it synchronously
// with no native round-trip involved. Falls back to MID (never null) --
// unlike mobile's fail-safe-to-null-if-underpowered gate, a real
// desktop/laptop's realistic floor is already MID's own 4 GB minimum, so
// there's no meaningfully weaker tier to offer below it.
// `cpuCount` is accepted for backward compatibility with existing callers
// (registry.js passes os.cpus().length) but no longer gates tier
// selection: RAM is the only capacity signal used below. The 7B/1.5B
// quants both fit their tier's RAM floor regardless of core count; a
// low-core machine just generates more slowly within whichever tier it
// qualifies for on RAM alone. Core count used to hard-gate both HIGH
// (require >=8) and MID (require >=8, else force the weak LOW/0.5B tier)
// -- the latter was strict enough to force a real 2-core/16 GB machine
// onto a model too weak to reliably write a report at all (it echoed its
// own instruction prompt back instead -- see llmProvider.js's
// isPromptEcho guard, added after exactly that failure).
export function selectTierForDevice(totalMemBytes, cpuCount = Number.POSITIVE_INFINITY) {
  void cpuCount;
  if (typeof totalMemBytes !== 'number') return MID; // no RAM signal -> safe default
  if (totalMemBytes >= HIGH.recommendedMinRamBytes) return HIGH;
  if (totalMemBytes >= MID.recommendedMinRamBytes) return MID;
  return LOW;
}
