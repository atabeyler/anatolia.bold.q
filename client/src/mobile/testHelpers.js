import { createTestDb } from '../../../desktop/testHelpers.js';
import { openDatabase } from './db/index.js';

function wrapSyncDb(raw) {
  return {
    async open() {},
    async close() { raw.close(); },
    async execute(statements) {
      raw.exec(statements);
      return { changes: { changes: 0 } };
    },
    async query(statement, values = []) {
      const rows = raw.prepare(statement).all(...values);
      return { values: rows };
    },
    async run(statement, values = []) {
      const info = raw.prepare(statement).run(...values);
      return { changes: { changes: info.changes, lastId: info.lastInsertRowid } };
    },
    async executeSet(set) {
      const tx = raw.transaction((statements) => {
        for (const { statement, values } of statements) {
          raw.prepare(statement).run(...(values || []));
        }
      });
      tx(set);
      return { changes: { changes: 0 } };
    },
  };
}

export function createFakeSqliteConnection() {
  const connections = new Map();
  return {
    async isConnection(name) {
      return { result: connections.has(name) };
    },
    async createConnection(name) {
      const wrapped = wrapSyncDb(createTestDb());
      connections.set(name, wrapped);
      return wrapped;
    },
    async retrieveConnection(name) {
      return connections.get(name);
    },
    async closeConnection(name) {
      connections.delete(name);
    },
  };
}

// Fresh, migrated database for a single test -- mirrors
// desktop/testHelpers.js's createTestDb().
export async function createTestMobileDb() {
  return openDatabase(createFakeSqliteConnection());
}
