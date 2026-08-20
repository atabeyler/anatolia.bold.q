// Pinned local-LLM model. Shared (via duplication, same as the rest of the
// desktop/*  vs client/src/mobile/* split in this codebase) with
// client/src/mobile/localAI/modelSpec.js so each platform can vary the
// pinned quant independently later without a cross-platform dependency.
//
// Chosen model: Qwen2.5-1.5B-Instruct, GGUF, Q4_K_M quantization.
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
export const MODEL_SPEC = Object.freeze({
  id: 'qwen2.5-1.5b-instruct-q4_k_m',
  label: 'Qwen2.5-1.5B-Instruct (Q4_K_M, GGUF)',
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
