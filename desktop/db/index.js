import path from 'node:path';
import fs from 'node:fs';
import Database from 'better-sqlite3';
import { runMigrations } from './migrate.js';

let db = null;

// Opens (creating if needed) the local SQLite database at dbPath, applies
// any pending migrations, and configures it for a desktop app that may be
// killed mid-write at any time (WAL journaling + a busy timeout instead of
// immediate "database is locked" failures).
export function openDatabase(dbPath, { onMigrations } = {}) {
  if (db) return db;

  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  db = new Database(dbPath);
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
