import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

// A minimal in-memory fake standing in for services/database.js's query()/
// logAuditEvent() -- pattern-matches the small, fixed set of SQL strings
// routes/auth.js actually issues, so we can integration-test the route
// logic (auth flow, admin guards, HTML confirm pages) with supertest
// without a real Postgres instance.
let authUsers;
let approvalTokens;
let auditLog;

function resetFakeDb() {
  authUsers = new Map();
  approvalTokens = new Map();
  auditLog = [];
}

function publicUserFields(row) {
  return { user_code: row.user_code, nickname: row.nickname, email: row.email ?? null, is_admin: row.is_admin, blocked: row.blocked, created_at: row.created_at };
}

const queryMock = vi.fn(async (sql, params = []) => {
  const s = sql.replace(/\s+/g, ' ').trim();

  if (s.startsWith('SELECT COUNT(*)::int AS count FROM auth_users WHERE is_admin')) {
    return { rows: [{ count: [...authUsers.values()].filter((u) => u.is_admin).length }], rowCount: 1 };
  }
  if (s.startsWith('SELECT COUNT(*)::int AS count FROM auth_users')) {
    return { rows: [{ count: authUsers.size }], rowCount: 1 };
  }
  // Checked before the shorter seed-insert pattern below, since both share
  // the same "INSERT INTO auth_users (...) VALUES (...) ON CONFLICT" prefix
  // and only differ in whether a RETURNING clause follows.
  if (s.startsWith('INSERT INTO auth_users (user_code, password_hash, nickname, is_admin, email)') && s.includes('RETURNING')) {
    const [userCode, password_hash, nickname, is_admin, email] = params;
    if (authUsers.has(userCode)) return { rows: [], rowCount: 0 };
    const row = { user_code: userCode, password_hash, nickname, is_admin, email: email ?? null, blocked: false, created_at: new Date() };
    authUsers.set(userCode, row);
    return { rows: [publicUserFields(row)], rowCount: 1 };
  }
  if (s.startsWith('INSERT INTO auth_users (user_code, password_hash, nickname, is_admin) VALUES ($1, $2, $3, $4) ON CONFLICT')) {
    const [userCode, password_hash, nickname, is_admin] = params;
    if (!authUsers.has(userCode)) {
      authUsers.set(userCode, { user_code: userCode, password_hash, nickname, is_admin, blocked: false, created_at: new Date() });
    }
    return { rows: [], rowCount: 0 };
  }
  if (s.startsWith('SELECT * FROM auth_users WHERE user_code = $1')) {
    const row = authUsers.get(params[0]);
    return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
  }
  if (s.startsWith('SELECT user_code, nickname, email, is_admin, blocked, created_at FROM auth_users ORDER BY')) {
    return { rows: [...authUsers.values()].map(publicUserFields), rowCount: authUsers.size };
  }
  if (s.startsWith('UPDATE auth_users SET')) {
    const userCode = params[params.length - 1];
    const row = authUsers.get(userCode);
    if (!row) return { rows: [], rowCount: 0 };
    // Order must match the SET-clause construction order in routes/auth.js's
    // PATCH handler: password_hash, nickname, email, is_admin, blocked.
    const setFields = [];
    if (s.includes('password_hash = $')) setFields.push('password_hash');
    if (s.includes('nickname = $')) setFields.push('nickname');
    if (s.includes('email = $')) setFields.push('email');
    if (s.includes('is_admin = $')) setFields.push('is_admin');
    if (s.includes('blocked = $')) setFields.push('blocked');
    setFields.forEach((field, i) => { row[field] = params[i]; });
    return { rows: [publicUserFields(row)], rowCount: 1 };
  }
  if (s.startsWith('DELETE FROM auth_users WHERE user_code = $1')) {
    const existed = authUsers.delete(params[0]);
    return { rows: [], rowCount: existed ? 1 : 0 };
  }
  if (s.startsWith('INSERT INTO approval_tokens')) {
    const [token, userCode, expiresAt] = params;
    approvalTokens.set(token, { token, user_code: userCode, approved: false, expires_at: expiresAt, created_at: new Date() });
    return { rows: [], rowCount: 1 };
  }
  if (s.startsWith('UPDATE approval_tokens SET approved = TRUE')) {
    const row = approvalTokens.get(params[0]);
    const ok = row && new Date(row.expires_at) > new Date() && !row.approved;
    if (!ok) return { rows: [], rowCount: 0 };
    row.approved = true;
    return { rows: [row], rowCount: 1 };
  }
  if (s.startsWith('SELECT 1 FROM approval_tokens WHERE token = $1 AND expires_at > NOW() AND approved = FALSE')) {
    const row = approvalTokens.get(params[0]);
    const ok = row && new Date(row.expires_at) > new Date() && !row.approved;
    return { rows: ok ? [{ '?column?': 1 }] : [], rowCount: ok ? 1 : 0 };
  }
  if (s.startsWith('SELECT 1 FROM approval_tokens WHERE token = $1')) {
    const row = approvalTokens.get(params[0]);
    return { rows: row ? [{ '?column?': 1 }] : [], rowCount: row ? 1 : 0 };
  }
  if (s.startsWith('DELETE FROM approval_tokens WHERE token = $1')) {
    approvalTokens.delete(params[0]);
    return { rows: [], rowCount: 1 };
  }
  if (s.startsWith('SELECT * FROM approval_tokens WHERE token = $1')) {
    const row = approvalTokens.get(params[0]);
    return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
  }
  if (s.startsWith('SELECT id, actor_user_code')) {
    return { rows: [...auditLog].reverse(), rowCount: auditLog.length };
  }
  throw new Error(`Unmocked query in auth.test.js fake DB: ${s}`);
});

const logAuditEventMock = vi.fn(async (actor, action, targetUserCode = null, details = null) => {
  auditLog.push({ id: auditLog.length + 1, actor_user_code: actor.userCode, actor_nickname: actor.nickname || null, action, target_user_code: targetUserCode, details, created_at: new Date() });
});

vi.mock('../services/database.js', () => ({
  query: (...args) => queryMock(...args),
  logAuditEvent: (...args) => logAuditEventMock(...args),
}));

process.env.DATABASE_URL = 'postgres://fake/db-for-tests';

const { default: authRouter } = await import('./auth.js');
const { JWT_SECRET } = await import('../lib/jwtSecret.js');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRouter);
  return app;
}

async function seedUser({ userCode, password, nickname, isAdmin = false, blocked = false }) {
  const password_hash = await bcrypt.hash(password, 4);
  authUsers.set(userCode, { user_code: userCode, password_hash, nickname, is_admin: isAdmin, blocked, created_at: new Date() });
}

function adminToken(userCode = 'ADMIN-1', nickname = 'BOLD') {
  return jwt.sign({ userCode, nickname, isAdmin: true }, JWT_SECRET, { expiresIn: '1h' });
}

function userToken(userCode, nickname) {
  return jwt.sign({ userCode, nickname, isAdmin: false }, JWT_SECRET, { expiresIn: '1h' });
}

beforeEach(() => {
  resetFakeDb();
  queryMock.mockClear();
  logAuditEventMock.mockClear();
});

describe('POST /api/auth/login-request', () => {
  it('rejects a request missing userCode/password', async () => {
    const app = buildApp();
    const res = await request(app).post('/api/auth/login-request').send({ userCode: 'X' });
    expect(res.status).toBe(400);
  });

  it('rejects an unknown user code', async () => {
    const app = buildApp();
    const res = await request(app).post('/api/auth/login-request').send({ userCode: 'no-such-user', password: 'whatever' });
    expect(res.status).toBe(401);
  });

  it('rejects an incorrect password', async () => {
    await seedUser({ userCode: 'U1', password: 'correct-horse', nickname: 'BOLD-001' });
    const app = buildApp();
    const res = await request(app).post('/api/auth/login-request').send({ userCode: 'U1', password: 'wrong' });
    expect(res.status).toBe(401);
  });

  it('rejects a blocked user even with the correct password', async () => {
    await seedUser({ userCode: 'U2', password: 'correct-horse', nickname: 'BOLD-002', blocked: true });
    const app = buildApp();
    const res = await request(app).post('/api/auth/login-request').send({ userCode: 'U2', password: 'correct-horse' });
    expect(res.status).toBe(403);
  });

  it('issues a JWT directly for an admin, skipping mail approval', async () => {
    await seedUser({ userCode: 'ADMIN-1', password: 'correct-horse', nickname: 'BOLD', isAdmin: true });
    const app = buildApp();
    const res = await request(app).post('/api/auth/login-request').send({ userCode: 'ADMIN-1', password: 'correct-horse' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('approved');
    expect(res.body.jwt).toBeTruthy();
    const decoded = jwt.verify(res.body.jwt, JWT_SECRET);
    expect(decoded.isAdmin).toBe(true);
  });

  it('creates a pending approval token for a non-admin user instead of an immediate JWT', async () => {
    await seedUser({ userCode: 'U3', password: 'correct-horse', nickname: 'BOLD-003' });
    const app = buildApp();
    const res = await request(app).post('/api/auth/login-request').send({ userCode: 'U3', password: 'correct-horse' });
    expect(res.status).toBe(200);
    expect(res.body.jwt).toBeUndefined();
    expect(res.body.token).toBeTruthy();
    expect(approvalTokens.has(res.body.token)).toBe(true);
  });
});

describe('GET/POST /api/auth/approve/:token and /reject/:token', () => {
  it('GET renders a confirmation page instead of approving immediately (so a mail-scanner prefetch is a no-op)', async () => {
    approvalTokens.set('tok-1', { token: 'tok-1', user_code: 'U1', approved: false, expires_at: new Date(Date.now() + 60000) });
    const app = buildApp();
    const res = await request(app).get('/api/auth/approve/tok-1');
    expect(res.status).toBe(200);
    expect(res.text).toContain('<form method="POST"');
    expect(approvalTokens.get('tok-1').approved).toBe(false);
  });

  it('GET returns an error page for an invalid/expired token', async () => {
    const app = buildApp();
    const res = await request(app).get('/api/auth/approve/does-not-exist');
    expect(res.status).toBe(400);
    expect(res.text).toContain('geçersiz');
  });

  it('POST actually approves the token', async () => {
    approvalTokens.set('tok-2', { token: 'tok-2', user_code: 'U1', approved: false, expires_at: new Date(Date.now() + 60000) });
    const app = buildApp();
    const res = await request(app).post('/api/auth/approve/tok-2');
    expect(res.status).toBe(200);
    expect(approvalTokens.get('tok-2').approved).toBe(true);
  });

  it('POST rejects deletes the pending token', async () => {
    approvalTokens.set('tok-3', { token: 'tok-3', user_code: 'U1', approved: false, expires_at: new Date(Date.now() + 60000) });
    const app = buildApp();
    const res = await request(app).post('/api/auth/reject/tok-3');
    expect(res.status).toBe(200);
    expect(approvalTokens.has('tok-3')).toBe(false);
  });

  it('escapes an error message reflected into the HTML error page (defense-in-depth for htmlPage())', async () => {
    // htmlPage() is also reached via `catch (err) => htmlPage('error', err.message)`
    // -- simulate a lower-level failure whose message contains HTML to verify
    // that path is escaped too, not just the static known-error strings.
    queryMock.mockImplementationOnce(async () => { throw new Error('<script>alert(1)</script>'); });
    const app = buildApp();
    const res = await request(app).get('/api/auth/approve/some-token');
    expect(res.status).toBe(500);
    expect(res.text).not.toContain('<script>alert(1)</script>');
    expect(res.text).toContain('&lt;script&gt;');
  });
});

describe('GET /api/auth/check/:token', () => {
  it('returns pending for a token that has not been approved yet', async () => {
    approvalTokens.set('tok-4', { token: 'tok-4', user_code: 'U1', approved: false, expires_at: new Date(Date.now() + 60000) });
    const app = buildApp();
    const res = await request(app).get('/api/auth/check/tok-4');
    expect(res.body.status).toBe('pending');
  });

  it('returns expired for a token past its expiry', async () => {
    approvalTokens.set('tok-5', { token: 'tok-5', user_code: 'U1', approved: false, expires_at: new Date(Date.now() - 1000) });
    const app = buildApp();
    const res = await request(app).get('/api/auth/check/tok-5');
    expect(res.body.status).toBe('expired');
  });

  it('returns a JWT once approved', async () => {
    await seedUser({ userCode: 'U6', password: 'x', nickname: 'BOLD-006' });
    approvalTokens.set('tok-6', { token: 'tok-6', user_code: 'U6', approved: true, expires_at: new Date(Date.now() + 60000) });
    const app = buildApp();
    const res = await request(app).get('/api/auth/check/tok-6');
    expect(res.body.status).toBe('approved');
    expect(jwt.verify(res.body.jwt, JWT_SECRET).userCode).toBe('U6');
  });

  it('blocks a user who was blocked after requesting login but before it was approved', async () => {
    await seedUser({ userCode: 'U7', password: 'x', nickname: 'BOLD-007', blocked: true });
    approvalTokens.set('tok-7', { token: 'tok-7', user_code: 'U7', approved: true, expires_at: new Date(Date.now() + 60000) });
    const app = buildApp();
    const res = await request(app).get('/api/auth/check/tok-7');
    expect(res.status).toBe(403);
  });
});

describe('admin user-management routes', () => {
  it('rejects a non-admin JWT with 403', async () => {
    await seedUser({ userCode: 'U8', password: 'x', nickname: 'BOLD-008' });
    const app = buildApp();
    const res = await request(app).get('/api/auth/admin/users').set('Authorization', `Bearer ${userToken('U8', 'BOLD-008')}`);
    expect(res.status).toBe(403);
  });

  it('rejects a missing token with 401', async () => {
    const app = buildApp();
    const res = await request(app).get('/api/auth/admin/users');
    expect(res.status).toBe(401);
  });

  it('lists users for an admin', async () => {
    await seedUser({ userCode: 'U9', password: 'x', nickname: 'BOLD-009' });
    const app = buildApp();
    const res = await request(app).get('/api/auth/admin/users').set('Authorization', `Bearer ${adminToken()}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });

  it('rejects creating a user with too short a password', async () => {
    const app = buildApp();
    const res = await request(app).post('/api/auth/admin/users').set('Authorization', `Bearer ${adminToken()}`).send({ userCode: 'NEW1', password: 'short' });
    expect(res.status).toBe(400);
  });

  it('creates a user and logs an audit event', async () => {
    const app = buildApp();
    const res = await request(app).post('/api/auth/admin/users').set('Authorization', `Bearer ${adminToken('ADMIN-1', 'BOLD')}`).send({ userCode: 'NEW2', password: 'longenough', nickname: 'BOLD-NEW' });
    expect(res.status).toBe(201);
    expect(authUsers.has('NEW2')).toBe(true);
    expect(logAuditEventMock).toHaveBeenCalledWith(expect.objectContaining({ userCode: 'ADMIN-1' }), 'user_added', 'NEW2', expect.anything());
  });

  it('creates a user with an email and returns it in the list', async () => {
    const app = buildApp();
    const res = await request(app).post('/api/auth/admin/users').set('Authorization', `Bearer ${adminToken('ADMIN-1', 'BOLD')}`)
      .send({ userCode: 'NEW3', password: 'longenough', nickname: 'BOLD-EMAIL', email: 'user@example.com' });
    expect(res.status).toBe(201);
    expect(res.body.email).toBe('user@example.com');

    const list = await request(app).get('/api/auth/admin/users').set('Authorization', `Bearer ${adminToken()}`);
    expect(list.body.find((u) => u.user_code === 'NEW3').email).toBe('user@example.com');
  });

  it('rejects an invalid email format when creating a user', async () => {
    const app = buildApp();
    const res = await request(app).post('/api/auth/admin/users').set('Authorization', `Bearer ${adminToken()}`)
      .send({ userCode: 'NEW4', password: 'longenough', email: 'not-an-email' });
    expect(res.status).toBe(400);
    expect(authUsers.has('NEW4')).toBe(false);
  });

  it('updates a user email via PATCH', async () => {
    await seedUser({ userCode: 'U12', password: 'x', nickname: 'BOLD-012' });
    const app = buildApp();
    const res = await request(app).patch('/api/auth/admin/users/U12').set('Authorization', `Bearer ${adminToken()}`)
      .send({ email: 'u12@example.com' });
    expect(res.status).toBe(200);
    expect(res.body.email).toBe('u12@example.com');
    expect(authUsers.get('U12').email).toBe('u12@example.com');
  });

  it('rejects an invalid email format on PATCH', async () => {
    await seedUser({ userCode: 'U13', password: 'x', nickname: 'BOLD-013' });
    const app = buildApp();
    const res = await request(app).patch('/api/auth/admin/users/U13').set('Authorization', `Bearer ${adminToken()}`)
      .send({ email: 'nope' });
    expect(res.status).toBe(400);
  });

  it('rejects creating a duplicate user code with 409', async () => {
    await seedUser({ userCode: 'DUP', password: 'x', nickname: 'BOLD-DUP' });
    const app = buildApp();
    const res = await request(app).post('/api/auth/admin/users').set('Authorization', `Bearer ${adminToken()}`).send({ userCode: 'DUP', password: 'longenough' });
    expect(res.status).toBe(409);
  });

  it('prevents an admin from blocking their own account', async () => {
    await seedUser({ userCode: 'ADMIN-1', password: 'x', nickname: 'BOLD', isAdmin: true });
    const app = buildApp();
    const res = await request(app).patch('/api/auth/admin/users/ADMIN-1').set('Authorization', `Bearer ${adminToken()}`).send({ blocked: true });
    expect(res.status).toBe(400);
  });

  it('blocks a different user and logs the audit event', async () => {
    await seedUser({ userCode: 'U10', password: 'x', nickname: 'BOLD-010' });
    const app = buildApp();
    const res = await request(app).patch('/api/auth/admin/users/U10').set('Authorization', `Bearer ${adminToken('ADMIN-1', 'BOLD')}`).send({ blocked: true });
    expect(res.status).toBe(200);
    expect(authUsers.get('U10').blocked).toBe(true);
    expect(logAuditEventMock).toHaveBeenCalledWith(expect.anything(), 'user_blocked', 'U10', expect.anything());
  });

  it('prevents deleting your own account', async () => {
    await seedUser({ userCode: 'ADMIN-1', password: 'x', nickname: 'BOLD', isAdmin: true });
    const app = buildApp();
    const res = await request(app).delete('/api/auth/admin/users/ADMIN-1').set('Authorization', `Bearer ${adminToken()}`);
    expect(res.status).toBe(400);
  });

  it('prevents deleting the last remaining admin account', async () => {
    // Only one admin exists in the DB (ADMIN-1); the acting caller is a
    // *different* admin identity (their JWT is self-issued in this test and
    // never touches the DB, same as production -- admin routes trust the
    // JWT's isAdmin claim without re-checking the DB row), so the self-delete
    // guard doesn't trigger and only the "last admin" guard is exercised.
    await seedUser({ userCode: 'ADMIN-1', password: 'x', nickname: 'BOLD', isAdmin: true });
    const app = buildApp();
    const res = await request(app).delete('/api/auth/admin/users/ADMIN-1').set('Authorization', `Bearer ${adminToken('ADMIN-OTHER', 'BOLD-OTHER')}`);
    expect(res.status).toBe(400);
    expect(authUsers.has('ADMIN-1')).toBe(true);
  });

  it('allows deleting an admin when another admin remains', async () => {
    await seedUser({ userCode: 'ADMIN-1', password: 'x', nickname: 'BOLD', isAdmin: true });
    await seedUser({ userCode: 'ADMIN-2', password: 'x', nickname: 'BOLD-2', isAdmin: true });
    const app = buildApp();
    const res = await request(app).delete('/api/auth/admin/users/ADMIN-2').set('Authorization', `Bearer ${adminToken('ADMIN-1', 'BOLD')}`);
    expect(res.status).toBe(200);
    expect(authUsers.has('ADMIN-2')).toBe(false);
  });

  it('returns the audit log for an admin', async () => {
    await seedUser({ userCode: 'U11', password: 'x', nickname: 'BOLD-011' });
    const app = buildApp();
    await request(app).patch('/api/auth/admin/users/U11').set('Authorization', `Bearer ${adminToken('ADMIN-1', 'BOLD')}`).send({ nickname: 'RENAMED' });
    const res = await request(app).get('/api/auth/admin/audit-log').set('Authorization', `Bearer ${adminToken()}`);
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body[0].action).toBe('user_updated');
  });
});
