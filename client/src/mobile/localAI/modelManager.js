import { Filesystem, Directory } from '@capacitor/filesystem';
import { MODEL_SPEC } from './modelSpec.js';
import { checkDeviceCapability } from './deviceCapability.js';
import { getCapacitorPlugin } from './llmRuntime.js';

const MODELS_SUBDIR = 'anatolia-q-models';

function bufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const CHUNK_SIZE = 0x8000; // avoid blowing the call-stack limit, same fix as mobileBridge.js's arrayBufferToBase64
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK_SIZE));
  }
  return btoa(binary);
}

function bufferToHex(buffer) {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function chunkToBase64(value) {
  const view = value.byteOffset === 0 && value.byteLength === value.buffer.byteLength
    ? value
    : value.slice();
  return bufferToBase64(view.buffer);
}

// Real Local Model Manager for Android/Capacitor: install-check, streamed
// download (fetch -> chunked writes to app-private storage via
// @capacitor/filesystem, never a single giant in-memory buffer written in
// one shot), SHA-256 checksum verification, remove, and a device-capability
// gate. No network access happens unless install()/downloadModel() is
// explicitly called by the user (spec point 9/privacy).
//
// Checksum verification prefers the native LocalLLM.sha256File method, so
// resumed downloads can be verified from disk without reloading the whole
// model into the WebView. Tests/non-native shells still use WebCrypto as a
// fallback for small fixtures.
export function createModelManager({ spec = MODEL_SPEC, fetchImpl = fetch, subtleCrypto = (typeof crypto !== 'undefined' ? crypto.subtle : undefined), filesystem = Filesystem, directory = Directory.Data, deviceInfo, nativeFileHash } = {}) {
  const relativePath = `${MODELS_SUBDIR}/${spec.filename}`;
  const tmpRelativePath = `${relativePath}.download`;

  async function isModelInstalled() {
    try {
      await filesystem.stat({ path: relativePath, directory });
      return true;
    } catch {
      return false;
    }
  }

  async function getPartialBytes() {
    try {
      const stat = await filesystem.stat({ path: tmpRelativePath, directory });
      return Number(stat.size) || 0;
    } catch {
      return 0;
    }
  }

  function getNativeFileHasher() {
    return nativeFileHash || getCapacitorPlugin('LocalLLM')?.sha256File;
  }

  async function hashInstalledFile(path) {
    const hasher = getNativeFileHasher();
    if (hasher) {
      const result = await hasher({ modelPath: path });
      if (result?.sha256) return result.sha256;
    }
    return null;
  }

  async function downloadModel({ onProgress } = {}) {
    await filesystem.mkdir({ path: MODELS_SUBDIR, directory, recursive: true }).catch(() => {});

    const hasNativeHasher = !!getNativeFileHasher();
    const existingBytes = hasNativeHasher ? await getPartialBytes() : 0;
    const headers = existingBytes ? { Range: `bytes=${existingBytes}-` } : undefined;
    const res = await fetchImpl(spec.url, { redirect: 'follow', ...(headers ? { headers } : {}) });
    if (!res.ok) throw new Error(`Model indirilemedi (HTTP ${res.status})`);

    const resumeAccepted = existingBytes > 0 && res.status === 206;
    const offset = resumeAccepted ? existingBytes : 0;
    const total = offset + (Number(res.headers.get('content-length')) || (spec.sizeBytes - offset) || 0);
    const reader = res.body?.getReader?.();
    const chunks = [];
    let received = offset;

    if (!resumeAccepted) await filesystem.writeFile({ path: tmpRelativePath, directory, data: '' }).catch(() => {});
    onProgress?.({ received, total });

    if (reader) {
      // Real chunked download: each chunk is appended to disk as it
      // arrives (never holding the whole file as one write call), while
      // also kept for the final in-memory checksum (see the module-level
      // comment on why that part isn't chunked too).
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!hasNativeHasher) chunks.push(value);
        received += value.length;
        await filesystem.appendFile({ path: tmpRelativePath, directory, data: chunkToBase64(value) });
        onProgress?.({ received, total });
      }
    } else {
      // Fallback for a fetch polyfill without a streaming body reader --
      // still a real network download, just not incrementally written.
      const buf = await res.arrayBuffer();
      if (!hasNativeHasher) chunks.push(new Uint8Array(buf));
      received = offset + buf.byteLength;
      await filesystem.appendFile({ path: tmpRelativePath, directory, data: bufferToBase64(buf) });
      onProgress?.({ received, total });
    }

    let actual = await hashInstalledFile(tmpRelativePath);
    if (!actual) {
      if (resumeAccepted) {
        await filesystem.deleteFile({ path: tmpRelativePath, directory }).catch(() => {});
        throw new Error('native_file_hash_unavailable_after_resume');
      }
      const full = new Uint8Array(received);
      let writeOffset = resumeAccepted ? existingBytes : 0;
      for (const chunk of chunks) { full.set(chunk, writeOffset); writeOffset += chunk.length; }
      if (!subtleCrypto) throw new Error('web_crypto_unavailable');
      const digest = await subtleCrypto.digest('SHA-256', full.buffer);
      actual = bufferToHex(digest);
    }

    if (actual !== spec.sha256) {
      await filesystem.deleteFile({ path: tmpRelativePath, directory }).catch(() => {});
      throw new Error(`Model bütünlük kontrolü başarısız: beklenen ${spec.sha256}, alınan ${actual}`);
    }

    await filesystem.rename({ from: tmpRelativePath, to: relativePath, directory, toDirectory: directory });
    return { ok: true, sha256: actual };
  }

  async function removeModel() {
    await filesystem.deleteFile({ path: relativePath, directory }).catch(() => {});
    return { ok: true };
  }

  function checkCapability() {
    return checkDeviceCapability(spec, deviceInfo);
  }

  // Synchronous where it can be (matches every provider's isAvailable()
  // contract in registry.js) -- relies on `installed` being tracked by the
  // caller (registry.js refreshes it) since Filesystem.stat() is async and
  // there is no sync file-existence check available in a WebView.
  function isAvailableSync(installed) {
    return !!installed && checkCapability().capable;
  }

  return {
    spec,
    // Exposed so llmProvider.js can hand the native LocalLLM plugin a real,
    // resolvable-on-disk path (this module's own MODELS_SUBDIR + filename)
    // instead of just spec.filename -- a bare filename has no directory
    // component and the native side would otherwise have to duplicate
    // MODELS_SUBDIR as a second source of truth. The native plugin resolves
    // this relative path against the app's private files dir (Android's
    // equivalent of @capacitor/filesystem's Directory.Data -- see
    // LocalLLMPlugin.kt's comment on that mapping).
    relativePath,
    isModelInstalled,
    getPartialBytes,
    downloadModel,
    removeModel,
    checkCapability,
    isAvailableSync,
  };
}
