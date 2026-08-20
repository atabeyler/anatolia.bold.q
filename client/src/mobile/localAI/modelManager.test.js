import { describe, it, expect, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { createModelManager } from './modelManager.js';

const FAKE_CONTENT = 'hello world model bytes';
const FAKE_SHA256 = 'bd34889eb70d40a47fca48338042bb1c90a181fea0082e87b6f47a7fd3e0b449';

const TEST_SPEC = {
  filename: 'fake-model.gguf',
  url: 'https://example.test/fake-model.gguf',
  sha256: FAKE_SHA256,
  sizeBytes: FAKE_CONTENT.length,
  recommendedMinRamBytes: 1,
  recommendedMinFreeDiskBytes: 1,
  contextSize: 512,
};

// In-memory fake of the @capacitor/filesystem surface this module uses --
// real Capacitor plugins aren't runnable in this Node/vitest environment,
// but the module's actual read/write/rename/stat logic is exercised
// exactly as it would run on-device.
function fakeFilesystem() {
  const files = new Map();
  return {
    files,
    async mkdir() {},
    async stat({ path }) {
      if (!files.has(path)) throw new Error('ENOENT');
      return { size: files.get(path).length };
    },
    async writeFile({ path, data }) { files.set(path, data ? atob(data) : ''); },
    async appendFile({ path, data }) {
      const prev = files.get(path) || '';
      files.set(path, prev + atob(data));
    },
    async deleteFile({ path }) { files.delete(path); },
    async rename({ from, to }) {
      if (!files.has(from)) throw new Error('ENOENT');
      files.set(to, files.get(from));
      files.delete(from);
    },
  };
}

function fakeFetchOk() {
  // Plain ASCII test content -- charCodeAt is enough, no TextEncoder needed
  // (kept out of this file's globals since the client eslint config's
  // browser-globals allowlist doesn't include it).
  const bytes = Uint8Array.from(FAKE_CONTENT, (c) => c.charCodeAt(0));
  return vi.fn(async () => ({
    ok: true,
    status: 200,
    headers: { get: (k) => (k === 'content-length' ? String(bytes.length) : null) },
    body: { getReader: () => { let sent = false; return { async read() { if (sent) return { done: true }; sent = true; return { done: false, value: bytes }; } }; } },
    async arrayBuffer() { return bytes.buffer; },
  }));
}

describe('mobile modelManager', () => {
  it('reports not installed when the file is absent', async () => {
    const mm = createModelManager({ spec: TEST_SPEC, filesystem: fakeFilesystem() });
    expect(await mm.isModelInstalled()).toBe(false);
  });

  it('downloads, verifies checksum, and installs the model', async () => {
    const fs = fakeFilesystem();
    const mm = createModelManager({ spec: TEST_SPEC, filesystem: fs, fetchImpl: fakeFetchOk(), subtleCrypto: webcrypto.subtle });

    const progressEvents = [];
    const result = await mm.downloadModel({ onProgress: (p) => progressEvents.push(p) });

    expect(result.ok).toBe(true);
    expect(result.sha256).toBe(FAKE_SHA256);
    expect(await mm.isModelInstalled()).toBe(true);
    expect(progressEvents.length).toBeGreaterThan(0);
  });

  it('rejects and cleans up on checksum mismatch', async () => {
    const badSpec = { ...TEST_SPEC, sha256: '0'.repeat(64) };
    const fs = fakeFilesystem();
    const mm = createModelManager({ spec: badSpec, filesystem: fs, fetchImpl: fakeFetchOk(), subtleCrypto: webcrypto.subtle });

    await expect(mm.downloadModel()).rejects.toThrow(/bütünlük/);
    expect(await mm.isModelInstalled()).toBe(false);
  });

  it('rejects on a non-ok HTTP response', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 404 }));
    const mm = createModelManager({ spec: TEST_SPEC, filesystem: fakeFilesystem(), fetchImpl });
    await expect(mm.downloadModel()).rejects.toThrow(/404/);
  });

  it('removeModel deletes an installed model', async () => {
    const fs = fakeFilesystem();
    const mm = createModelManager({ spec: TEST_SPEC, filesystem: fs, fetchImpl: fakeFetchOk(), subtleCrypto: webcrypto.subtle });
    await mm.downloadModel();
    expect(await mm.isModelInstalled()).toBe(true);
    await mm.removeModel();
    expect(await mm.isModelInstalled()).toBe(false);
  });

  it('isAvailableSync gates on both "installed" and the device-capability check', () => {
    const strictSpec = { ...TEST_SPEC, recommendedMinRamBytes: Number.MAX_SAFE_INTEGER };
    const mm = createModelManager({ spec: strictSpec, filesystem: fakeFilesystem(), deviceInfo: { nativeDeviceInfo: { totalMemBytes: 16 * 1024 ** 3, freeDiskBytes: 8 * 1024 ** 3 } } });
    expect(mm.isAvailableSync(true)).toBe(false); // installed=true but device gate fails
    expect(mm.isAvailableSync(false)).toBe(false); // not installed
  });
});
