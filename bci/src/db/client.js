import pg from 'pg';
import fs from 'node:fs';
import { config } from '../config.js';

const { Pool } = pg;

const ssl = config.databaseCaCert
  ? { ca: fs.readFileSync(config.databaseCaCert, 'utf8'), rejectUnauthorized: true }
  : undefined;

export const pool = new Pool({
  connectionString: config.databaseUrl,
  ssl,
});

pool.on('error', (err) => {
  // A broken idle client must not crash the process — log and let the pool
  // recycle the connection on next checkout.
  // eslint-disable-next-line no-console
  console.error('BCI database pool error on idle client', err);
});

export async function query(text, params) {
  return pool.query(text, params);
}

export async function checkDatabaseHealth() {
  try {
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}
