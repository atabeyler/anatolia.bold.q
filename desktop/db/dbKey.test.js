import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createDbKeyStore } from './dbKey.js';

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'aq-dbkey-'));
}

// Same fake-safeStorage pattern as auth/secureStore.test.js.
function fakeSafeStorage(available = true) {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (str) => Buffer.from(str.split('').map((c) => c.charCodeAt(0) ^ 0x5a)),
    decryptString: (buf) => Buffer.from([...buf].map((b) => b ^ 0x5a)).toString('utf8'),
  };
}

describe('createDbKeyStore', () => {
  it('generates a 64-char hex key on first use', () => {
    const store = createDbKeyStore(tmpDir(), fakeSafeStorage(true));
    const key = store.getOrCreateKey();
    expect(key).toMatch(/^[0-9a-f]{64}$/);
  });

  it('returns the same key across calls (persisted, not regenerated each time)', () => {
    const dir = tmpDir();
    const store = createDbKeyStore(dir, fakeSafeStorage(true));
    const first = store.getOrCreateKey();
    const second = store.getOrCreateKey();
    expect(second).toBe(first);
  });

  it('a fresh store instance (simulating app restart) recovers the same key', () => {
    const dir = tmpDir();
    const key1 = createDbKeyStore(dir, fakeSafeStorage(true)).getOrCreateKey();
    const key2 = createDbKeyStore(dir, fakeSafeStorage(true)).getOrCreateKey();
    expect(key2).toBe(key1);
  });

  it('never writes the raw key to disk in plaintext', () => {
    const dir = tmpDir();
    const store = createDbKeyStore(dir, fakeSafeStorage(true));
    const key = store.getOrCreateKey();
    const onDisk = fs.readFileSync(path.join(dir, 'db.key.enc'));
    expect(onDisk.toString('utf8')).not.toContain(key);
  });

  it('returns null (never a plaintext-fallback key) when encryption is unavailable', () => {
    const dir = tmpDir();
    const store = createDbKeyStore(dir, fakeSafeStorage(false));
    expect(store.getOrCreateKey()).toBeNull();
    expect(fs.existsSync(path.join(dir, 'db.key.enc'))).toBe(false);
  });

  it('regenerates a key rather than crashing when the key file cannot be decrypted (e.g. keychain reset)', () => {
    const dir = tmpDir();
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'db.key.enc'), 'garbage-not-decryptable');
    const store = createDbKeyStore(dir, fakeSafeStorage(true));
    expect(store.getOrCreateKey()).toMatch(/^[0-9a-f]{64}$/);
  });

  it('encryptionAvailable() reflects the underlying safeStorage state', () => {
    expect(createDbKeyStore(tmpDir(), fakeSafeStorage(true)).encryptionAvailable()).toBe(true);
    expect(createDbKeyStore(tmpDir(), fakeSafeStorage(false)).encryptionAvailable()).toBe(false);
  });
});
