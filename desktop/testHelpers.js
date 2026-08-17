import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runMigrations } from './db/migrate.js';

function normalizeBindings(sql, values) {
  if (values == null) return null;
  if (Array.isArray(values)) return values;
  if (typeof values !== 'object') return [values];
  const names = [...sql.matchAll(/[@:$]([A-Za-z_][A-Za-z0-9_]*)/g)].map((match) => match[1]);
  if (!names.length) return values;
  const named = {};
  for (const name of names) {
    const value = name in values ? values[name] : values[`@${name}`] ?? values[`:${name}`] ?? values[`$${name}`];
    named[`@${name}`] = value;
    named[`:${name}`] = value;
    named[`$${name}`] = value;
  }
  return named;
}

function bindStatement(stmt, sql, values) {
  const bindings = normalizeBindings(sql, values);
  if (!bindings || (Array.isArray(bindings) && !bindings.length)) return stmt;
  return stmt.bind(bindings);
}

function createSqlJsDatabase(SQL) {
  return class SqlJsDatabase {
    constructor(filename = ':memory:') {
      void filename;
      this.db = new SQL.Database();
    }

    pragma(statement) {
      this.db.exec(`PRAGMA ${statement}`);
    }

    exec(sql) {
      this.db.exec(sql);
    }

    transaction(fn) {
      return (...args) => {
        this.db.exec('BEGIN');
        try {
          const result = fn(...args);
          this.db.exec('COMMIT');
          return result;
        } catch (error) {
          this.db.exec('ROLLBACK');
          throw error;
        }
      };
    }

    prepare(sql) {
      const db = this.db;
      return {
        run: (...args) => {
          const stmt = db.prepare(sql);
          try {
            bindStatement(stmt, sql, args.length === 1 ? args[0] : args);
            while (stmt.step()) {}
            return { changes: db.getRowsModified(), lastInsertRowid: Number(db.exec('SELECT last_insert_rowid() AS id')[0]?.values?.[0]?.[0] ?? 0) };
          } finally {
            stmt.free();
          }
        },
        get: (...args) => {
          const rows = this.prepare(sql).all(...args);
          return rows[0];
        },
        all: (...args) => {
          const stmt = db.prepare(sql);
          try {
            bindStatement(stmt, sql, args.length === 1 ? args[0] : args);
            const rows = [];
            while (stmt.step()) rows.push(stmt.getAsObject());
            return rows;
          } finally {
            stmt.free();
          }
        },
      };
    }

    close() {
      this.db.close();
    }
  };
}

let DatabaseCtor;
try {
  ({ default: DatabaseCtor } = await import('better-sqlite3'));
  const probe = new DatabaseCtor(':memory:');
  probe.close();
} catch {
  const initSqlJs = (await import('sql.js')).default;
  const wasmPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'node_modules', 'sql.js', 'dist');
  const SQL = await initSqlJs({ locateFile: (file) => path.join(wasmPath, file) });
  DatabaseCtor = createSqlJsDatabase(SQL);
}

// Fresh in-memory SQLite database with the real migrations applied — used
// by every desktop/**/*.test.js file so tests exercise the actual schema
// instead of a hand-rolled stand-in.
export function createTestDb() {
  const db = new DatabaseCtor(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}
