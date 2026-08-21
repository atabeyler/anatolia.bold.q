import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import Database from 'better-sqlite3-multiple-ciphers';
import { openDatabase, closeDatabase } from './index.js';

function tmpDbPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aq-db-'));
  return path.join(dir, 'anatolia-q.db');
}

function hexKey() {
  return crypto.randomBytes(32).toString('hex');
}

afterEach(() => {
  closeDatabase();
});

describe('openDatabase without a key (AQ-002: safeStorage unavailable)', () => {
  it('opens a plain, unencrypted database exactly as before -- backward compatible', () => {
    const dbPath = tmpDbPath();
    const db = openDatabase(dbPath);
    db.exec("CREATE TABLE IF NOT EXISTS probe (v TEXT)");
    db.prepare('INSERT INTO probe VALUES (?)').run('plain-value');
    closeDatabase();

    const raw = fs.readFileSync(dbPath);
    expect(raw.includes('plain-value')).toBe(true);
  });
});

describe('openDatabase with a key (AQ-002: at-rest encryption)', () => {
  it('creates a new database that is not readable without the key', () => {
    const dbPath = tmpDbPath();
    const key = hexKey();
    const db = openDatabase(dbPath, { key });
    db.exec('CREATE TABLE IF NOT EXISTS probe (v TEXT)');
    db.prepare('INSERT INTO probe VALUES (?)').run('secret-value');
    closeDatabase();

    const raw = fs.readFileSync(dbPath);
    expect(raw.includes('secret-value')).toBe(false);

    // Opening it directly without the key pragma must not yield readable data.
    const noKey = new Database(dbPath);
    expect(() => noKey.prepare('SELECT * FROM probe').get()).toThrow();
    noKey.close();
  });

  it('reopens the same encrypted database with the same key and reads the data back', () => {
    const dbPath = tmpDbPath();
    const key = hexKey();
    let db = openDatabase(dbPath, { key });
    db.exec('CREATE TABLE IF NOT EXISTS probe (v TEXT)');
    db.prepare('INSERT INTO probe VALUES (?)').run('round-trip');
    closeDatabase();

    db = openDatabase(dbPath, { key });
    expect(db.prepare('SELECT v FROM probe').get().v).toBe('round-trip');
  });

  it('migrates an existing plaintext database (pre-AQ-002 install) to encrypted in place, preserving data', () => {
    const dbPath = tmpDbPath();

    // Simulate a database that predates AQ-002: created with no key at all.
    // Uses a table name distinct from the real schema (see db/migrate.js) so
    // this test's fixture data can't collide with the post-migration schema.
    const plain = new Database(dbPath);
    plain.exec('CREATE TABLE legacy_probe (id INTEGER PRIMARY KEY, title TEXT)');
    plain.exec('CREATE INDEX idx_title ON legacy_probe(title)');
    plain.prepare('INSERT INTO legacy_probe (title) VALUES (?)').run('kritik değerlendirme');
    plain.close();
    const plaintextBytes = fs.readFileSync(dbPath);
    expect(plaintextBytes.includes('kritik değerlendirme')).toBe(true);

    const key = hexKey();
    const db = openDatabase(dbPath, { key });

    // The now-encrypted file at dbPath must no longer contain the plaintext title.
    const encryptedBytes = fs.readFileSync(dbPath);
    expect(encryptedBytes.includes('kritik değerlendirme')).toBe(false);

    // The data itself survived the migration.
    expect(db.prepare('SELECT title FROM legacy_probe WHERE id = 1').get().title).toBe('kritik değerlendirme');
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_title'").get()).toBeTruthy();
    // And the real schema migrations still applied on top of the migrated data.
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='analyses'").get()).toBeTruthy();

    // The original plaintext file was preserved as a backup, not deleted.
    expect(fs.existsSync(`${dbPath}.pre-encryption.bak`)).toBe(true);
    const backupBytes = fs.readFileSync(`${dbPath}.pre-encryption.bak`);
    expect(backupBytes.includes('kritik değerlendirme')).toBe(true);
  });

  it('still applies pending migrations after opening/migrating an encrypted database', () => {
    const dbPath = tmpDbPath();
    const key = hexKey();
    const db = openDatabase(dbPath, { key });
    // The real schema migrations (see db/migrate.js) create an `analyses` table.
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='analyses'").get()).toBeTruthy();
  });
});
