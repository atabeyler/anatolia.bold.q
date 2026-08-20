import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { EventEmitter } from 'node:events';
import { createModelManager } from './modelManager.js';

const FAKE_CONTENT = 'hello world model bytes';
// sha256('hello world model bytes')
const FAKE_SHA256 = 'bd34889eb70d40a47fca48338042bb1c90a181fea0082e87b6f47a7fd3e0b449';

const TEST_SPEC = {
  filename: 'fake-model.gguf',
  url: 'https://example.test/fake-model.gguf',
  sha256: FAKE_SHA256,
  sizeBytes: FAKE_CONTENT.length,
  recommendedMinRamBytes: 1, // effectively disables the RAM gate for these tests
  recommendedMinFreeDiskBytes: 1,
  contextSize: 512,
};

// Minimal fake `https.get`-shaped fetchImpl: takes (url, callback) and
// hands the callback a Node Readable that also carries `statusCode`/
// `headers`, matching what modelManager.js's httpGetFollowingRedirects
// expects from the real https module -- lets downloadModel() be tested
// without any real network access.
function fakeFetchImpl({ statusCode = 200, body = FAKE_CONTENT, redirectTo } = {}) {
  return (url, onResponse) => {
    const emitter = new EventEmitter();
    if (redirectTo) {
      const res = Readable.from([]);
      res.statusCode = 302;
      res.headers = { location: redirectTo };
      queueMicrotask(() => onResponse(res));
      return emitter;
    }
    const res = Readable.from([Buffer.from(body)]);
    res.statusCode = statusCode;
    res.headers = { 'content-length': String(body.length) };
    queueMicrotask(() => onResponse(res));
    return emitter;
  };
}

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'anatolia-model-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('modelManager', () => {
  it('reports not installed when the file is absent', () => {
    const mm = createModelManager({ modelsDir: tmpDir, spec: TEST_SPEC });
    expect(mm.isModelInstalled()).toBe(false);
    expect(mm.isAvailable()).toBe(false);
  });

  it('downloads, verifies checksum, and installs the model', async () => {
    const mm = createModelManager({ modelsDir: tmpDir, spec: TEST_SPEC, fetchImpl: fakeFetchImpl() });
    const progressEvents = [];
    const result = await mm.downloadModel({ onProgress: (p) => progressEvents.push(p) });

    expect(result.ok).toBe(true);
    expect(result.sha256).toBe(FAKE_SHA256);
    expect(mm.isModelInstalled()).toBe(true);
    expect(progressEvents.length).toBeGreaterThan(0);
    expect(fs.readFileSync(mm.modelPath, 'utf8')).toBe(FAKE_CONTENT);
  });

  it('follows an HTTP redirect before downloading', async () => {
    const fetchImpl = (url, cb) => {
      if (url === 'https://example.test/fake-model.gguf') {
        return fakeFetchImpl({ redirectTo: 'https://cdn.example.test/real-file' })(url, cb);
      }
      return fakeFetchImpl()(url, cb);
    };
    const mm = createModelManager({ modelsDir: tmpDir, spec: TEST_SPEC, fetchImpl });
    const result = await mm.downloadModel();
    expect(result.ok).toBe(true);
  });

  it('rejects and cleans up on checksum mismatch, never installing a corrupt file', async () => {
    const badSpec = { ...TEST_SPEC, sha256: '0'.repeat(64) };
    const mm = createModelManager({ modelsDir: tmpDir, spec: badSpec, fetchImpl: fakeFetchImpl() });

    await expect(mm.downloadModel()).rejects.toThrow(/bütünlük/);
    expect(mm.isModelInstalled()).toBe(false);
    expect(fs.existsSync(`${mm.modelPath}.download`)).toBe(false);
  });

  it('rejects on a non-200 HTTP response', async () => {
    const mm = createModelManager({ modelsDir: tmpDir, spec: TEST_SPEC, fetchImpl: fakeFetchImpl({ statusCode: 404 }) });
    await expect(mm.downloadModel()).rejects.toThrow(/404/);
  });

  it('removeModel deletes an installed model', async () => {
    const mm = createModelManager({ modelsDir: tmpDir, spec: TEST_SPEC, fetchImpl: fakeFetchImpl() });
    await mm.downloadModel();
    expect(mm.isModelInstalled()).toBe(true);
    await mm.removeModel();
    expect(mm.isModelInstalled()).toBe(false);
  });

  it('isAvailable is false when the model is installed but the device fails the capability gate', async () => {
    const strictSpec = { ...TEST_SPEC, recommendedMinRamBytes: Number.MAX_SAFE_INTEGER };
    const mm = createModelManager({ modelsDir: tmpDir, spec: strictSpec, fetchImpl: fakeFetchImpl() });
    await mm.downloadModel();
    expect(mm.isModelInstalled()).toBe(true);
    expect(mm.isAvailable()).toBe(false); // installed, but device gate fails -> fall through to extractive
  });

  it('verifyChecksum reports missing for a nonexistent path', async () => {
    const mm = createModelManager({ modelsDir: tmpDir, spec: TEST_SPEC });
    const result = await mm.verifyChecksum();
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('missing');
  });
});
