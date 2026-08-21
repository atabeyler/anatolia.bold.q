import path from 'node:path';
import fs from 'node:fs';
import Database from 'better-sqlite3-multiple-ciphers';
import { runMigrations } from './migrate.js';

let db = null;

function sqlQuote(str) {
  return str.replace(/'/g, "''");
}

function setKeyPragma(handle, hexKey) {
  // Raw hex-key form (PRAGMA key = "x'<hex>'") rather than a passphrase --
  // hexKey is always a 64-char hex string we generated ourselves (see
  // db/dbKey.js), so there's no passphrase-derivation ambiguity and no
  // untrusted input reaches this string.
  handle.pragma(`key="x'${hexKey}'"`);
}

// True if `handle` (already has the key pragma applied, if any) can
// actually read the database -- the only reliable way to tell "already
// encrypted with this key" apart from "wrong key" or "genuinely not a
// database", since better-sqlite3(-multiple-ciphers) doesn't throw until
// the first real read.
function canRead(handle) {
  try {
    handle.prepare('SELECT count(*) FROM sqlite_master').get();
    return true;
  } catch {
    return false;
  }
}

// One-time migration for an existing plaintext database file into an
// encrypted one (AQ-002): SQLCipher-style ATTACH+copy, not an in-place
// rewrite, so a crash mid-migration never corrupts the only copy of the
// user's data -- the original plaintext file is left in place (renamed
// to a .pre-encryption.bak, not deleted) until the encrypted copy is
// verified readable and swapped in.
function migratePlaintextToEncrypted(dbPath, hexKey) {
  const tmpPath = `${dbPath}.encrypting.tmp`;
  try { fs.unlinkSync(tmpPath); } catch { /* leftover from a previous crash, ignore */ }

  const plainDb = new Database(dbPath);
  try {
    plainDb.exec(`ATTACH DATABASE '${sqlQuote(tmpPath)}' AS encrypted KEY "x'${hexKey}'"`);
    const objects = plainDb.prepare(
      "SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY (type = 'table') DESC"
    ).all();
    for (const o of objects) {
      if (o.type !== 'table') continue;
      plainDb.exec(o.sql.replace(/^CREATE TABLE/i, 'CREATE TABLE encrypted.'));
      plainDb.exec(`INSERT INTO encrypted.${o.name} SELECT * FROM main.${o.name}`);
    }
    for (const o of objects) {
      if (o.type !== 'index') continue;
      plainDb.exec(o.sql.replace(/^CREATE (UNIQUE )?INDEX/i, 'CREATE $1INDEX encrypted.'));
    }
    plainDb.exec('DETACH DATABASE encrypted');
  } finally {
    plainDb.close();
  }

  // Verify the encrypted copy is actually readable with the key before
  // touching the original -- if this fails, the original plaintext file
  // is untouched and openDatabase() falls back to it (see below).
  const verify = new Database(tmpPath);
  setKeyPragma(verify, hexKey);
  const ok = canRead(verify);
  verify.close();
  if (!ok) {
    try { fs.unlinkSync(tmpPath); } catch { /* best-effort cleanup */ }
    throw new Error('Encrypted database copy failed verification after migration');
  }

  const backupPath = `${dbPath}.pre-encryption.bak`;
  if (!fs.existsSync(backupPath)) fs.renameSync(dbPath, backupPath);
  else fs.unlinkSync(dbPath); // an older backup already exists from a previous attempt
  fs.renameSync(tmpPath, dbPath);
}

// Opens (creating if needed) the local SQLite database at dbPath, applies
// any pending migrations, and configures it for a desktop app that may be
// killed mid-write at any time (WAL journaling + a busy timeout instead of
// immediate "database is locked" failures).
//
// `key` (a 64-char hex string from db/dbKey.js's getOrCreateKey(), or null)
// enables SQLCipher-compatible at-rest encryption (AQ-002). null means the
// OS-protected key store wasn't available on this platform/config -- the
// database is opened unencrypted in that case (the previous, pre-AQ-002
// behavior) rather than encrypting it with a key that can't be stored
// securely, which would be a false sense of protection, not real security.
export function openDatabase(dbPath, { onMigrations, key = null } = {}) {
  if (db) return db;

  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  if (key) {
    const existed = fs.existsSync(dbPath);
    db = new Database(dbPath);
    setKeyPragma(db, key);
    if (existed && !canRead(db)) {
      // Existing file doesn't open with this key -- the expected case is a
      // pre-AQ-002 plaintext database (never encrypted before). Migrate it
      // in place; a database encrypted under a different, now-lost key
      // (e.g. safeStorage was reset) is the only other realistic cause and
      // migratePlaintextToEncrypted() will itself fail loudly for that case
      // (ATTACH/copy from a handle that can't read its own sqlite_master),
      // rather than silently discarding data.
      db.close();
      migratePlaintextToEncrypted(dbPath, key);
      db = new Database(dbPath);
      setKeyPragma(db, key);
    }
  } else {
    db = new Database(dbPath);
  }

  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');

  const applied = runMigrations(db);
  onMigrations?.(applied);
  return db;
}

export function getDatabase() {
  if (!db) throw new Error('Database not opened — call openDatabase() first');
  return db;
}

// Test-only: allows each test file to start from a fresh in-memory database
// instead of sharing module-level state.
export function closeDatabase() {
  if (db) {
    db.close();
    db = null;
  }
}

export const _internal = { migratePlaintextToEncrypted, setKeyPragma, canRead };
