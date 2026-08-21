import pkg from 'pg';
import { randomUUID } from 'crypto';
import { logger } from '../lib/logger.js';
import { recordRequestMetric } from '../lib/requestMetrics.js';
const { Pool } = pkg;

let pool;

function buildSslConfig() {
  if (process.env.NODE_ENV !== 'production') return false;
  const caCert = process.env.DATABASE_CA_CERT;
  if (caCert) {
    return { rejectUnauthorized: true, ca: caCert };
  }
  logger.warn('DATABASE_CA_CERT not set — Postgres TLS connections are encrypted but unverified (MITM risk); set DATABASE_CA_CERT to enable certificate verification.');
  return { rejectUnauthorized: false };
}

export function getPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      // Render's managed Postgres (and most managed Postgres providers)
      // present a certificate that isn't in Node's default trust store, so
      // rejectUnauthorized: true here made every connection attempt hang
      // indefinitely instead of failing -- which in turn blocked
      // initDatabase() from ever settling, and index.js never reached
      // server.listen() (see the 2026-07-21 outage). DATABASE_CA_CERT (PEM,
      // e.g. Render's CA bundle) lets an operator opt back into verified TLS
      // once it's confirmed stable for this deployment; without it, this
      // stays the documented tradeoff (encrypted but unverified) rather than
      // silently upgrading and risking the same outage again.
      ssl: buildSslConfig(),
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

  // analyses may already exist from before the fraud-trend columns were
  // added -- populated only for BDDK/BTK reports that ran the quantum
  // kernel fraud detector (see routes/analysis.js), NULL otherwise.
  await p.query(`ALTER TABLE analyses ADD COLUMN IF NOT EXISTS fraud_transaction_count INTEGER;`);
  await p.query(`ALTER TABLE analyses ADD COLUMN IF NOT EXISTS fraud_flagged_count INTEGER;`);

  // Desktop/multi-device sync metadata (see routes/sync.js). client_id is a
  // stable identifier the *client* generates at create time (so an offline
  // desktop write already has a durable id before it ever reaches the
  // server); version + sync_revision drive optimistic-concurrency conflict
  // detection and the pull cursor respectively. Generated with
  // crypto.randomUUID() in application code below rather than a DB-side
  // gen_random_uuid() default, since that requires either Postgres 13+ or
  // the pgcrypto extension and managed Postgres providers don't always grant
  // CREATE EXTENSION -- this way no DB-side assumption is needed at all.
  await p.query(`ALTER TABLE analyses ADD COLUMN IF NOT EXISTS client_id UUID;`);
  await p.query(`ALTER TABLE analyses ADD COLUMN IF NOT EXISTS device_id VARCHAR(64) DEFAULT 'web';`);
  await p.query(`ALTER TABLE analyses ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;`);
  await p.query(`ALTER TABLE analyses ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();`);
  await p.query(`ALTER TABLE analyses ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;`);
  await p.query(`CREATE SEQUENCE IF NOT EXISTS analyses_sync_revision_seq;`);
  await p.query(`ALTER TABLE analyses ADD COLUMN IF NOT EXISTS sync_revision BIGINT;`);
  await p.query(`ALTER TABLE analyses ALTER COLUMN sync_revision SET DEFAULT nextval('analyses_sync_revision_seq');`);
  await p.query(`ALTER SEQUENCE analyses_sync_revision_seq OWNED BY analyses.sync_revision;`);
  await backfillAnalysesSyncMetadata(p);
  await p.query(`ALTER TABLE analyses ALTER COLUMN sync_revision SET NOT NULL;`);
  await p.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_analyses_client_id ON analyses(client_id);`);
  await p.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_analyses_sync_revision ON analyses(sync_revision);`);

  // priority: a user-set urgency label on the request (see routes/analysis.js's
  // /generate) -- surfaced in history/feed so a "kritik" request stands out
  // from routine ones; does not change how the analysis itself runs.
  // depth: unlike priority, this DOES change generation -- 'hizli' skips the
  // web-research pass and caps AI output shorter, 'derin' forces web research
  // on and raises the output cap; 'standart' is today's existing behavior
  // (see routes/analysis.js's /generate, resolveDepthSettings()).
  await p.query(`ALTER TABLE analyses ADD COLUMN IF NOT EXISTS priority VARCHAR(20) NOT NULL DEFAULT 'normal';`);
  await p.query(`ALTER TABLE analyses ADD COLUMN IF NOT EXISTS depth VARCHAR(20) NOT NULL DEFAULT 'standart';`);

  await p.query(`
    CREATE TABLE IF NOT EXISTS devices (
      id SERIAL PRIMARY KEY,
      device_id VARCHAR(64) UNIQUE NOT NULL,
      user_code VARCHAR(50) NOT NULL,
      device_name VARCHAR(200),
      platform VARCHAR(50),
      app_version VARCHAR(20),
      authorized_at TIMESTAMP DEFAULT NOW(),
      last_seen_at TIMESTAMP DEFAULT NOW(),
      revoked_at TIMESTAMP
    );
  `);

  // Idempotency ledger for /api/sync/push -- a push retried after a dropped
  // response (client never saw the result) replays the same operation_id and
  // gets the originally-recorded result back instead of double-applying.
  await p.query(`
    CREATE TABLE IF NOT EXISTS sync_operations (
      operation_id UUID PRIMARY KEY,
      user_code VARCHAR(50) NOT NULL,
      device_id VARCHAR(64) NOT NULL,
      entity_type VARCHAR(50) NOT NULL,
      entity_client_id UUID,
      op VARCHAR(20) NOT NULL,
      status VARCHAR(20) NOT NULL,
      server_version INTEGER,
      server_payload JSONB,
      error TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await p.query(`
    CREATE INDEX IF NOT EXISTS idx_devices_user ON devices(user_code);
    CREATE INDEX IF NOT EXISTS idx_sync_operations_user ON sync_operations(user_code);
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
  // Abstract RBAC role (admin/analyst/viewer, see lib/rbac.js) -- distinct
  // from is_admin, which stays the source of truth for the 'admin' role so
  // existing admin accounts and login logic are unaffected. Non-admin
  // accounts default to 'analyst' (the same access level they already had).
  await p.query(`ALTER TABLE auth_users ADD COLUMN IF NOT EXISTS role VARCHAR(20) DEFAULT 'analyst';`);

  // Registered WebAuthn/passkey authenticators (see routes/webauthn.js).
  // Only public data ever lands here: credential_id + public_key are what
  // the authenticator itself hands back during registration, counter is a
  // signature-replay guard, transports is a UI hint. No private key and no
  // biometric data ever exists server-side -- the platform authenticator
  // (Face ID/Touch ID/Windows Hello/Android biometrics) verifies the user
  // locally and never sends that result to this API; only the signed
  // challenge response does, which is verified purely cryptographically.
  await p.query(`
    CREATE TABLE IF NOT EXISTS webauthn_credentials (
      id SERIAL PRIMARY KEY,
      user_code VARCHAR(50) NOT NULL,
      credential_id TEXT UNIQUE NOT NULL,
      public_key TEXT NOT NULL,
      counter BIGINT NOT NULL DEFAULT 0,
      device_name VARCHAR(200),
      device_type VARCHAR(20),
      backed_up BOOLEAN DEFAULT FALSE,
      transports VARCHAR(200),
      created_at TIMESTAMP DEFAULT NOW(),
      last_used_at TIMESTAMP
    );
  `);

  await p.query(`
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id SERIAL PRIMARY KEY,
      user_code VARCHAR(50) NOT NULL,
      endpoint TEXT UNIQUE NOT NULL,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

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
    CREATE INDEX IF NOT EXISTS idx_analyses_user_sync_revision ON analyses(user_code, sync_revision);
    CREATE INDEX IF NOT EXISTS idx_messages_users ON messages(from_user, to_user);
    CREATE INDEX IF NOT EXISTS idx_tokens_token ON approval_tokens(token);
    CREATE INDEX IF NOT EXISTS idx_audit_log_created ON admin_audit_log(created_at);
    CREATE INDEX IF NOT EXISTS idx_audit_log_actor ON admin_audit_log(actor_user_code);
    CREATE INDEX IF NOT EXISTS idx_audit_log_target ON admin_audit_log(target_user_code);
    CREATE INDEX IF NOT EXISTS idx_auth_users_code ON auth_users(user_code);
    CREATE INDEX IF NOT EXISTS idx_webauthn_credentials_user ON webauthn_credentials(user_code);
  `);

  logger.info('Database tables ready');
}

// Fills client_id/sync_revision for rows that predate the sync columns
// above. Only ever touches rows still missing that metadata, so after the
// first successful run on a given database this is a no-op query on every
// later boot.
async function backfillAnalysesSyncMetadata(p) {
  const { rows } = await p.query(
    `SELECT id FROM analyses WHERE client_id IS NULL OR sync_revision IS NULL`
  );
  for (const row of rows) {
    await p.query(
      `UPDATE analyses
       SET client_id = COALESCE(client_id, $2),
           sync_revision = COALESCE(sync_revision, nextval('analyses_sync_revision_seq'))
       WHERE id = $1`,
      [row.id, randomUUID()]
    );
  }
  if (rows.length) {
    logger.info({ count: rows.length }, '[Database] Backfilled analyses sync metadata');
  }
}

export async function query(text, params) {
  const p = getPool();
  const startedAt = Date.now();
  try {
    const result = await p.query(text, params);
    recordRequestMetric('db.query', Date.now() - startedAt, 200);
    return result;
  } catch (err) {
    recordRequestMetric('db.query', Date.now() - startedAt, 500);
    throw err;
  }
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
