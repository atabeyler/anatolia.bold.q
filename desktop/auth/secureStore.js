import fs from 'node:fs';
import path from 'node:path';

// Wraps Electron's safeStorage (DPAPI on Windows, Keychain on macOS,
// libsecret on Linux) so the JWT never sits in a renderer-reachable
// localStorage. safeStorage is injected rather than imported directly so
// this module (and its logic) can be unit tested outside a running
// Electron process.
export function createSecureStore(userDataDir, safeStorage) {
  const file = path.join(userDataDir, 'session.enc');

  function save(value) {
    fs.mkdirSync(userDataDir, { recursive: true });
    if (safeStorage?.isEncryptionAvailable?.()) {
      fs.writeFileSync(file, safeStorage.encryptString(JSON.stringify(value)));
    } else {
      // No OS keychain/secret-service available (rare off the Windows
      // target, e.g. some headless Linux setups) -- degrade to plaintext
      // rather than crash or silently refuse to persist the session. The
      // flag lets callers warn the user their session isn't encrypted at
      // rest instead of claiming a security property that isn't there.
      fs.writeFileSync(file, JSON.stringify({ ...value, __unencrypted: true }));
    }
  }

  function load() {
    if (!fs.existsSync(file)) return null;
    const raw = fs.readFileSync(file);
    try {
      if (safeStorage?.isEncryptionAvailable?.()) {
        return JSON.parse(safeStorage.decryptString(raw));
      }
      return JSON.parse(raw.toString('utf8'));
    } catch {
      return null;
    }
  }

  function clear() {
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }

  return { save, load, clear };
}
