import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// Manages the local analyses database's at-rest encryption key (AQ-002),
// protected by Electron's safeStorage (DPAPI on Windows, Keychain on
// macOS, libsecret on Linux) exactly the way auth/secureStore.js protects
// the offline login session -- the key is generated once (32 random
// bytes) and never written to disk except encrypted. safeStorage is
// injected rather than imported directly so this logic is unit-testable
// outside a running Electron process.
export function createDbKeyStore(userDataDir, safeStorage) {
  const file = path.join(userDataDir, 'db.key.enc');

  function encryptionAvailable() {
    return !!safeStorage?.isEncryptionAvailable?.();
  }

  // Returns a 64-char hex string (a raw 32-byte key, for SQLCipher's
  // PRAGMA key = "x'<hex>'" form) to encrypt the local database with, or
  // null when safeStorage isn't available on this platform/config.
  //
  // A null return must NOT be treated by callers as "encrypt with some
  // fallback key anyway" -- storing the key in plaintext (env var, disk
  // file, hardcoded) would be worse than no encryption at all, since it
  // creates a false sense of protection. db/index.js's openDatabase()
  // opens the database unencrypted when key is null, matching this
  // module's pre-AQ-002 behavior on such platforms.
  function getOrCreateKey() {
    if (!encryptionAvailable()) return null;

    if (fs.existsSync(file)) {
      try {
        const key = safeStorage.decryptString(fs.readFileSync(file));
        if (/^[0-9a-f]{64}$/i.test(key)) return key;
      } catch {
        // Falls through to treating this as "no key file" below. This can
        // happen after an OS keychain reset/migration -- if a database was
        // already encrypted under the now-undecryptable key, the caller's
        // migration path (db/index.js) will itself fail loudly on that
        // mismatch rather than silently losing data.
      }
    }

    const key = crypto.randomBytes(32).toString('hex');
    fs.mkdirSync(userDataDir, { recursive: true });
    fs.writeFileSync(file, safeStorage.encryptString(key));
    return key;
  }

  return { getOrCreateKey, encryptionAvailable };
}
