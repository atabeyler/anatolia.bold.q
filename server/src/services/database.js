import pkg from 'pg';
import { logger } from '../lib/logger.js';
const { Pool } = pkg;

let pool;

export function getPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      // Render's managed Postgres (and most managed Postgres providers)
      // present a certificate that isn't in Node's default trust store, so
      // rejectUnauthorized: true here made every connection attempt hang
      // indefinitely instead of failing -- which in turn blocked
      // initDatabase() from ever settling, and index.js never reached
      // server.listen() (see the 2026-07-21 outage). Back to false, which
      // still gets an encrypted connection, just without CA verification.
      // TRACKED TECH DEBT: pin Render's actual CA bundle instead of disabling
      // verification outright once it's confirmed stable, rather than leaving
      // this as the permanent state.
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
      max: 10,
      idleTimeoutMillis: 30000,
      // A bounded connection attempt, so any future DB connectivity problem
      // fails fast into index.js's initDatabase().catch() fallback (which
      // still calls server.listen()) instead of hanging the process and
      // preventing the port from ever binding.
      connectionTimeoutMillis: 10000,
    });
  }
  return pool;
}

export async function initDatabase() {
  if (!process.env.DATABASE_URL) {
    logger.warn('DATABASE_URL not set — DB disabled');
    return;
  }

  const p = getPool();

  await p.query(`
    CREATE TABLE IF NOT EXISTS approval_tokens (
      id SERIAL PRIMARY KEY,
      token VARCHAR(255) UNIQUE NOT NULL,
      user_code VARCHAR(50) NOT NULL,
      approved BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT NOW(),
      expires_at TIMESTAMP NOT NULL
    );
  `);

  await p.query(`
    CREATE TABLE IF NOT EXISTS analyses (
      id SERIAL PRIMARY KEY,
      user_code VARCHAR(50) NOT NULL,
      category VARCHAR(50) NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      ai_provider VARCHAR(20),
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);


  await p.query(`
    CREATE TABLE IF NOT EXISTS messages (
      id SERIAL PRIMARY KEY,
      from_user VARCHAR(50) NOT NULL,
      to_user VARCHAR(50),
      message TEXT NOT NULL,
      message_type VARCHAR(20) DEFAULT 'chat',
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await p.query(`
    CREATE TABLE IF NOT EXISTS emergency_logs (
      id SERIAL PRIMARY KEY,
      user_code VARCHAR(50),
      message TEXT NOT NULL,
      target VARCHAR(50) NOT NULL,
      region VARCHAR(50),
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await p.query(`
    CREATE TABLE IF NOT EXISTS auth_users (
      id SERIAL PRIMARY KEY,
      user_code VARCHAR(50) UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      nickname VARCHAR(100),
      is_admin BOOLEAN DEFAULT FALSE,
      blocked BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  // auth_users may already exist from before the "blocked"/"email" columns were added.
  await p.query(`ALTER TABLE auth_users ADD COLUMN IF NOT EXISTS blocked BOOLEAN DEFAULT FALSE;`);
  await p.query(`ALTER TABLE auth_users ADD COLUMN IF NOT EXISTS email VARCHAR(255);`);

  await p.query(`
    CREATE TABLE IF NOT EXISTS admin_audit_log (
      id SERIAL PRIMARY KEY,
      actor_user_code VARCHAR(50) NOT NULL,
      actor_nickname VARCHAR(100),
      action VARCHAR(50) NOT NULL,
      target_user_code VARCHAR(50),
      details JSONB,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await p.query(`
    CREATE INDEX IF NOT EXISTS idx_analyses_user ON analyses(user_code);
    CREATE INDEX IF NOT EXISTS idx_messages_users ON messages(from_user, to_user);
    CREATE INDEX IF NOT EXISTS idx_tokens_token ON approval_tokens(token);
    CREATE INDEX IF NOT EXISTS idx_audit_log_created ON admin_audit_log(created_at);
    CREATE INDEX IF NOT EXISTS idx_audit_log_actor ON admin_audit_log(actor_user_code);
    CREATE INDEX IF NOT EXISTS idx_audit_log_target ON admin_audit_log(target_user_code);
    CREATE INDEX IF NOT EXISTS idx_auth_users_code ON auth_users(user_code);
  `);

  logger.info('Database tables ready');
}

export async function query(text, params) {
  const p = getPool();
  return p.query(text, params);
}

// Email notification recipients -- users who are offline/inactive still need
// a way to see emergency broadcasts, direct messages, and meeting-start
// alerts, so these back the "also email everyone, active or not" behavior
// in routes/emergency.js and services/socket.js.
export async function getUserEmailRecipients() {
  if (!process.env.DATABASE_URL) return [];
  try {
    const { rows } = await query("SELECT user_code, nickname, email FROM auth_users WHERE email IS NOT NULL AND email <> ''");
    return rows;
  } catch (err) {
    logger.warn({ err }, '[Database] Failed to load user email recipients');
    return [];
  }
}

export async function getUserEmailByNickname(nickname) {
  if (!process.env.DATABASE_URL || !nickname) return null;
  try {
    const { rows } = await query(
      "SELECT email FROM auth_users WHERE nickname = $1 AND email IS NOT NULL AND email <> '' LIMIT 1",
      [nickname]
    );
    return rows[0]?.email || null;
  } catch (err) {
    logger.warn({ err }, '[Database] Failed to load user email by nickname');
    return null;
  }
}

// Best-effort admin action trail -- never blocks the action it's logging on failure.
export async function logAuditEvent(actor, action, targetUserCode = null, details = null) {
  if (!process.env.DATABASE_URL) return;
  try {
    await query(
      'INSERT INTO admin_audit_log (actor_user_code, actor_nickname, action, target_user_code, details) VALUES ($1, $2, $3, $4, $5::jsonb)',
      [actor.userCode, actor.nickname || null, action, targetUserCode, details ? JSON.stringify(details) : null]
    );
  } catch (err) {
    logger.warn({ err, action }, '[AuditLog] write failed');
  }
}

// Memory tables — for subsequent sessions
export async function initMemoryTables() {
  if (!process.env.DATABASE_URL) return;
  const p = getPool();

  await p.query(`
    CREATE TABLE IF NOT EXISTS user_profiles (
      id SERIAL PRIMARY KEY,
      user_code VARCHAR(50) UNIQUE NOT NULL,
      display_name VARCHAR(100),
      rank VARCHAR(100),
      unit VARCHAR(200),
      preferred_persona VARCHAR(50) DEFAULT 'general',
      preferred_lang VARCHAR(5) DEFAULT 'tr',
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await p.query(`
    CREATE TABLE IF NOT EXISTS conversation_memory (
      id SERIAL PRIMARY KEY,
      user_code VARCHAR(50) NOT NULL,
      session_title VARCHAR(300),
      persona_id VARCHAR(50),
      summary TEXT,
      key_facts TEXT,
      full_history JSONB,
      archived BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await p.query(`
    CREATE INDEX IF NOT EXISTS idx_memory_user ON conversation_memory(user_code);
    CREATE INDEX IF NOT EXISTS idx_profiles_user ON user_profiles(user_code);
  `);

  logger.info('Memory tables ready');
}
