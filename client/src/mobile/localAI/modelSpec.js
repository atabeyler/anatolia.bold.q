// Pinned local-LLM model for Android. Mirrors desktop/localAI/modelSpec.js
// -- same model family/quant is used on both platforms today (a single
// Q4_K_M GGUF is already at the edge of what's realistic on phone-class
// RAM; see the capability thresholds in deviceCapability.js and the final
// report's honesty note about Android feasibility). Duplicated rather than
// imported across the client/desktop boundary, same as every other
// desktop/localAI vs client/src/mobile/localAI pair in this codebase.
export const MODEL_SPEC = Object.freeze({
  id: 'qwen2.5-1.5b-instruct-q4_k_m',
  label: 'Qwen2.5-1.5B-Instruct (Q4_K_M, GGUF)',
  filename: 'qwen2.5-1.5b-instruct-q4_k_m.gguf',
  url: 'https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/qwen2.5-1.5b-instruct-q4_k_m.gguf',
  // Read from the file's HF LFS ETag (X-Linked-ETag) on 2026-08-20 -- see
  // desktop/localAI/modelSpec.js for how this was obtained.
  sha256: '6a1a2eb6d15622bf3c96857206351ba97e1af16c30d7a74ee38970e434e9407e',
  sizeBytes: 1117320736,
  license: 'Apache-2.0',
  contextSize: 2048, // smaller than desktop's 4096 -- phone RAM/CPU budget
  // Android is a much harder RAM budget than desktop -- a mid/high-end
  // phone with 8 GB total RAM realistically has 3-4 GB free for one app
  // after the OS/other apps, and a 1.1 GB GGUF plus KV cache plus the rest
  // of this Capacitor WebView app pushes that. This threshold is
  // deliberately higher relative to model size than desktop's, and honest
  // that it will exclude mid-range/budget devices -- see
  // deviceCapability.js and the final report.
  recommendedMinRamBytes: 6 * 1024 * 1024 * 1024,
  recommendedMinFreeDiskBytes: 2.5 * 1024 * 1024 * 1024,
});
