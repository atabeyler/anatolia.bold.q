import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createSecureStore } from './secureStore.js';

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'aq-secure-'));
}

// A tiny fake mirroring Electron's safeStorage contract (XOR "encryption"
// is obviously not real security -- it only proves the store round-trips
// through whatever backend it's given rather than doing its own crypto).
function fakeSafeStorage(available = true) {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (str) => Buffer.from(str.split('').map((c) => c.charCodeAt(0) ^ 0x5a)),
    decryptString: (buf) => Buffer.from([...buf].map((b) => b ^ 0x5a)).toString('utf8'),
  };
}

describe('createSecureStore', () => {
  it('round-trips a value through the OS-backed encryption', () => {
    const store = createSecureStore(tmpDir(), fakeSafeStorage(true));
    store.save({ jwt: 'secret-token', userCode: 'BOLD-001' });
    expect(store.load()).toEqual({ jwt: 'secret-token', userCode: 'BOLD-001' });
  });

  it('never writes the raw JWT to disk when encryption is available', () => {
    const dir = tmpDir();
    const store = createSecureStore(dir, fakeSafeStorage(true));
    store.save({ jwt: 'super-secret-token' });
    const onDisk = fs.readFileSync(path.join(dir, 'session.enc'), 'utf8');
    expect(onDisk).not.toContain('super-secret-token');
  });

  it('degrades to a flagged plaintext fallback instead of crashing when encryption is unavailable', () => {
    const store = createSecureStore(tmpDir(), fakeSafeStorage(false));
    store.save({ jwt: 'token' });
    const loaded = store.load();
    expect(loaded.jwt).toBe('token');
    expect(loaded.__unencrypted).toBe(true);
  });

  it('returns null when nothing has been saved yet', () => {
    const store = createSecureStore(tmpDir(), fakeSafeStorage(true));
    expect(store.load()).toBeNull();
  });

  it('clear() removes the persisted session', () => {
    const store = createSecureStore(tmpDir(), fakeSafeStorage(true));
    store.save({ jwt: 'x' });
    store.clear();
    expect(store.load()).toBeNull();
  });
});
