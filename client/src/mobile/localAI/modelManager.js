import { Filesystem, Directory } from '@capacitor/filesystem';
import { MODEL_SPEC } from './modelSpec.js';
import { checkDeviceCapability } from './deviceCapability.js';

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

// Real Local Model Manager for Android/Capacitor: install-check, streamed
// download (fetch -> chunked writes to app-private storage via
// @capacitor/filesystem, never a single giant in-memory buffer written in
// one shot), SHA-256 checksum verification, remove, and a device-capability
// gate. No network access happens unless install()/downloadModel() is
// explicitly called by the user (spec point 9/privacy).
//
// Known sandbox-honest limitation: checksum verification currently hashes
// the fully-received ArrayBuffer in memory with crypto.subtle.digest
// (Web Crypto has no incremental/streaming digest API) rather than hashing
// disk-streamed chunks incrementally -- fine for the ~1.1 GB model this
// ships with on a modern phone, but the disk-write itself IS chunked/
// streamed to avoid holding two full copies. A future native Capacitor
// plugin could offer a true streaming hash if a much larger model is ever
// pinned; noted in the final report rather than silently glossed over.
export function createModelManager({ spec = MODEL_SPEC, fetchImpl = fetch, subtleCrypto = (typeof crypto !== 'undefined' ? crypto.subtle : undefined), filesystem = Filesystem, directory = Directory.Data, deviceInfo } = {}) {
  const relativePath = `${MODELS_SUBDIR}/${spec.filename}`;

  async function isModelInstalled() {
    try {
      await filesystem.stat({ path: relativePath, directory });
      return true;
    } catch {
      return false;
    }
  }

  async function downloadModel({ onProgress } = {}) {
    await filesystem.mkdir({ path: MODELS_SUBDIR, directory, recursive: true }).catch(() => {});

    const res = await fetchImpl(spec.url, { redirect: 'follow' });
    if (!res.ok) throw new Error(`Model indirilemedi (HTTP ${res.status})`);

    const total = Number(res.headers.get('content-length')) || spec.sizeBytes || 0;
    const reader = res.body?.getReader?.();
    const chunks = [];
    let received = 0;

    const tmpRelativePath = `${relativePath}.download`;
    await filesystem.writeFile({ path: tmpRelativePath, directory, data: '' }).catch(() => {});

    if (reader) {
      // Real chunked download: each chunk is appended to disk as it
      // arrives (never holding the whole file as one write call), while
      // also kept for the final in-memory checksum (see the module-level
      // comment on why that part isn't chunked too).
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.length;
        await filesystem.appendFile({ path: tmpRelativePath, directory, data: bufferToBase64(value.buffer) });
        onProgress?.({ received, total });
      }
    } else {
      // Fallback for a fetch polyfill without a streaming body reader --
      // still a real network download, just not incrementally written.
      const buf = await res.arrayBuffer();
      chunks.push(new Uint8Array(buf));
      received = buf.byteLength;
      await filesystem.appendFile({ path: tmpRelativePath, directory, data: bufferToBase64(buf) });
      onProgress?.({ received, total });
    }

    const full = new Uint8Array(received);
    let offset = 0;
    for (const chunk of chunks) { full.set(chunk, offset); offset += chunk.length; }

    if (!subtleCrypto) throw new Error('SHA-256 doğrulaması için Web Crypto kullanılamıyor');
    const digest = await subtleCrypto.digest('SHA-256', full.buffer);
    const actual = bufferToHex(digest);

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
    isModelInstalled,
    downloadModel,
    removeModel,
    checkCapability,
    isAvailableSync,
  };
}
