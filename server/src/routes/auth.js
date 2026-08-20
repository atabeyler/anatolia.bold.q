import express from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { v4 as uuid } from 'uuid';
import { query, logAuditEvent } from '../services/database.js';
import { sendApprovalEmail } from '../services/email.js';
import { authMiddleware } from '../middleware/auth.js';
import { publicActionLimiter } from '../middleware/rateLimit.js';
import * as onlineState from '../lib/onlineState.js';
import { JWT_SECRET } from '../lib/jwtSecret.js';
import { escapeHtml } from '../lib/escapeHtml.js';
import { isLoginLocked, recordLoginFailure, clearLoginFailures } from '../lib/loginThrottle.js';
import { ROLES } from '../lib/rbac.js';
import { setAuthCookie, clearAuthCookie } from '../lib/cookies.js';
import { validatePassword } from '../lib/passwordPolicy.js';

const router = express.Router();

const APP_URL = process.env.APP_URL || 'http://localhost:10000';

// One-time migration data: the user codes that used to be hardcoded here.
// Seeded into auth_users on first boot only (if the table is empty) so
// existing users keep working after the move to DB-backed accounts. After
// the seed, this list is never read again — all account management goes
// through the /admin/users endpoints below.
const LEGACY_SEED_PASSWORD = process.env.SHARED_PASSWORD;
const LEGACY_SEED_USERS = [
  { userCode: '120184', nickname: 'BOLD', isAdmin: true },
  { userCode: '847293', nickname: 'BOLD-001', isAdmin: false },
  { userCode: '362518', nickname: 'BOLD-002', isAdmin: false },
  { userCode: '195047', nickname: 'BOLD-003', isAdmin: false },
  { userCode: '728364', nickname: 'BOLD-004', isAdmin: false },
  { userCode: '541209', nickname: 'BOLD-005', isAdmin: false },
  { userCode: '983627', nickname: 'BOLD-006', isAdmin: false },
  { userCode: '416853', nickname: 'BOLD-007', isAdmin: false },
  { userCode: '274091', nickname: 'BOLD-008', isAdmin: false },
  { userCode: '639475', nickname: 'BOLD-009', isAdmin: false },
  { userCode: '857130', nickname: 'BOLD-010', isAdmin: false },
];

let seeded = false;
async function seedLegacyUsersIfEmpty() {
  if (seeded || !process.env.DATABASE_URL) return;
  seeded = true;
  try {
    const { rows } = await query('SELECT COUNT(*)::int AS count FROM auth_users');
    if (rows[0].count > 0) return;

    if (!LEGACY_SEED_PASSWORD) {
      console.error('auth_users seed skipped: SHARED_PASSWORD env var is not set');
      return;
    }

    const passwordHash = await bcrypt.hash(LEGACY_SEED_PASSWORD, 10);
    for (const u of LEGACY_SEED_USERS) {
      await query(
        'INSERT INTO auth_users (user_code, password_hash, nickname, is_admin) VALUES ($1, $2, $3, $4) ON CONFLICT (user_code) DO NOTHING',
        [u.userCode, passwordHash, u.nickname, u.isAdmin]
      );
    }
    console.log('auth_users seeded from legacy user list (one-time migration)');
  } catch (err) {
    console.error('auth_users seed error:', err);
  }
}

async function findUser(userCode) {
  const { rows } = await query('SELECT * FROM auth_users WHERE user_code = $1', [userCode]);
  return rows[0] || null;
}

// A precomputed bcrypt hash (same cost factor as real ones, see bcrypt.hash
// calls below) with no corresponding real password -- compared against on
// the "user not found" path in /login-request so that path takes about the
// same time as a real wrong-password compare, instead of returning
// immediately. Without this, response timing alone lets an attacker
// distinguish a valid user code from an invalid one even though the error
// message is now identical (see the unified "Kullanıcı kodu veya şifre
// hatalı" message below).
const DUMMY_PASSWORD_HASH = bcrypt.hashSync('not-a-real-password-timing-decoy', 10);

// Step 1: verify the password, generate a token for mail approval, and send the email
router.post('/login-request', publicActionLimiter, async (req, res) => {
  try {
    if (!process.env.DATABASE_URL) {
      return res.status(503).json({ error: 'Kullanıcı veritabanı yapılandırılmamış' });
    }
    await seedLegacyUsersIfEmpty();

    const { userCode, password } = req.body;
    if (!userCode || !password) {
      return res.status(400).json({ error: 'Kullanıcı kodu ve şifre zorunlu' });
    }

    if (await isLoginLocked(userCode)) {
      return res.status(429).json({ error: 'Çok fazla hatalı deneme. Lütfen birkaç dakika sonra tekrar deneyin.' });
    }

    // Same generic error message and roughly the same response time whether
    // the user code doesn't exist or the password is wrong -- distinguishing
    // the two (as this used to) lets an attacker enumerate valid user codes
    // by trying candidates and watching which error/timing comes back.
    const user = await findUser(userCode);
    const passwordOk = await bcrypt.compare(password, user ? user.password_hash : DUMMY_PASSWORD_HASH);
    if (!user || !passwordOk) {
      await recordLoginFailure(userCode);
      return res.status(401).json({ error: 'Kullanıcı kodu veya şifre hatalı' });
    }

    await clearLoginFailures(userCode);

    if (user.blocked) {
      return res.status(403).json({ error: 'Hesabınız engellenmiş. Merkez ile iletişime geçin.' });
    }

    // Admin: no mail approval, direct JWT
    if (user.is_admin) {
      const jwtToken = jwt.sign(
        { userCode: user.user_code, nickname: user.nickname, isAdmin: true, role: ROLES.ADMIN },
        JWT_SECRET,
        { expiresIn: '4h' }
      );
      setAuthCookie(res, jwtToken, 4 * 60 * 60 * 1000);
      return res.json({ status: 'approved', jwt: jwtToken, userCode: user.user_code, nickname: user.nickname, isAdmin: true, role: ROLES.ADMIN });
    }

    const token = uuid();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 min

    await query(
      'INSERT INTO approval_tokens (token, user_code, expires_at) VALUES ($1, $2, $3)',
      [token, userCode, expiresAt]
    );

    const approveUrl = `${APP_URL}/api/auth/approve/${token}`;
    const rejectUrl = `${APP_URL}/api/auth/reject/${token}`;

    await sendApprovalEmail(userCode, approveUrl, rejectUrl);

    res.json({ success: true, token, message: 'Merkez onayı bekleniyor — info@boldkimya.com.tr adresine onay maili gönderildi.' });
  } catch (err) {
    console.error('login-request error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Step 2: the approval link coming from the email.
// GET only renders a confirmation page with a button that POSTs the actual
// action -- corporate mail-security link scanners/prefetchers auto-fetch
// GET links, which would otherwise silently approve a login before a human
// ever looked at the email (defeating the whole point of mail approval).
router.get('/approve/:token', async (req, res) => {
  try {
    const { token } = req.params;
    const r = await query(
      'SELECT 1 FROM approval_tokens WHERE token = $1 AND expires_at > NOW() AND approved = FALSE',
      [token]
    );
    if (r.rowCount === 0) {
      return res.status(400).send(htmlPage('error', 'Token geçersiz veya süresi dolmuş'));
    }
    res.send(confirmPage('approve', token, 'Girişi Onayla', 'Bu kullanıcının sisteme girişini onaylamak istediğinize emin misiniz?'));
  } catch (err) {
    res.status(500).send(htmlPage('error', err.message));
  }
});

router.post('/approve/:token', async (req, res) => {
  try {
    const { token } = req.params;

    const r = await query(
      'UPDATE approval_tokens SET approved = TRUE WHERE token = $1 AND expires_at > NOW() AND approved = FALSE RETURNING *',
      [token]
    );
    if (r.rowCount === 0) {
      return res.status(400).send(htmlPage('error', 'Token geçersiz veya süresi dolmuş'));
    }

    res.send(htmlPage('success', 'Giriş onaylandı. Kullanıcı şimdi sisteme giriş yapabilir.'));
  } catch (err) {
    res.status(500).send(htmlPage('error', err.message));
  }
});

router.get('/reject/:token', async (req, res) => {
  try {
    const { token } = req.params;
    const r = await query('SELECT 1 FROM approval_tokens WHERE token = $1', [token]);
    if (r.rowCount === 0) {
      return res.status(400).send(htmlPage('error', 'Token geçersiz veya süresi dolmuş'));
    }
    res.send(confirmPage('reject', token, 'Girişi Reddet', 'Bu kullanıcının giriş talebini reddetmek istediğinize emin misiniz?'));
  } catch (err) {
    res.status(500).send(htmlPage('error', err.message));
  }
});

router.post('/reject/:token', async (req, res) => {
  try {
    const { token } = req.params;
    await query('DELETE FROM approval_tokens WHERE token = $1', [token]);
    res.send(htmlPage('reject', 'Giriş reddedildi.'));
  } catch (err) {
    res.status(500).send(htmlPage('error', err.message));
  }
});

// Step 3: the frontend polls the approval status
router.get('/check/:token', async (req, res) => {
  try {
    const { token } = req.params;

    const r = await query('SELECT * FROM approval_tokens WHERE token = $1', [token]);
    if (r.rowCount === 0) return res.json({ status: 'not_found' });
    const t = r.rows[0];
    const expired = new Date(t.expires_at) < new Date();

    if (expired) return res.json({ status: 'expired' });
    if (!t.approved) return res.json({ status: 'pending' });

    const user = await findUser(t.user_code);
    if (user?.blocked) {
      return res.status(403).json({ status: 'blocked', error: 'Hesabınız engellenmiş' });
    }
    const nickname = user?.nickname || t.user_code;
    const role = user?.role || ROLES.ANALYST;
    const jwtToken = jwt.sign({ userCode: t.user_code, nickname, role }, JWT_SECRET, { expiresIn: '2h' });
    setAuthCookie(res, jwtToken, 2 * 60 * 60 * 1000);
    res.json({ status: 'approved', jwt: jwtToken, userCode: t.user_code, nickname, role });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Lets the web client (which never has JS access to the httpOnly session
// cookie, unlike desktop/mobile decoding their own stored JWT) learn who's
// logged in without needing to decode a token it doesn't have.
router.get('/me', authMiddleware, (req, res) => {
  const { userCode, nickname, isAdmin, role, exp } = req.user;
  res.json({ userCode, nickname, isAdmin: !!isAdmin, role, exp });
});

router.post('/logout', (req, res) => {
  clearAuthCookie(res);
  res.json({ success: true });
});

// ── Admin: user management ────────────────────────────────────────────────
// Nickname/password changes are admin-only (via /admin/users/:userCode below) --
// regular users cannot change their own user code or password.
// All /admin/users routes require a valid admin JWT (never client-supplied
// data — isAdmin is only ever set from a DB row via login-request above).
function requireAdmin(req, res, next) {
  if (!req.user?.isAdmin) return res.status(403).json({ error: 'Yetkisiz' });
  next();
}

function validEmail(email) {
  return email === undefined || email === null || email === '' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

router.get('/admin/users', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const { rows } = await query(
      'SELECT user_code, nickname, email, is_admin, blocked, created_at FROM auth_users ORDER BY created_at ASC'
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/admin/users', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const { userCode, password, nickname, isAdmin, email, role } = req.body;
    if (!userCode || !password) {
      return res.status(400).json({ error: 'Kullanıcı kodu ve şifre zorunlu' });
    }
    const passwordError = validatePassword(password);
    if (passwordError) {
      return res.status(400).json({ error: passwordError });
    }
    if (!validEmail(email)) {
      return res.status(400).json({ error: 'Geçerli bir e-posta adresi girin' });
    }
    if (role !== undefined && !Object.values(ROLES).includes(role)) {
      return res.status(400).json({ error: 'Geçersiz rol' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    // isAdmin stays the source of truth for the 'admin' role (see
    // lib/rbac.js's resolveRole) -- an explicit role is honored, otherwise
    // it's derived from isAdmin so existing admin-only clients keep working.
    const resolvedRole = role || (isAdmin ? ROLES.ADMIN : ROLES.ANALYST);
    const { rows } = await query(
      `INSERT INTO auth_users (user_code, password_hash, nickname, is_admin, email, role)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (user_code) DO NOTHING
       RETURNING user_code, nickname, email, is_admin, role, blocked, created_at`,
      [userCode, passwordHash, nickname || userCode, !!isAdmin, email || null, resolvedRole]
    );
    if (rows.length === 0) {
      return res.status(409).json({ error: 'Bu kullanıcı kodu zaten kayıtlı' });
    }
    await logAuditEvent(req.user, 'user_added', userCode, { nickname: rows[0].nickname, isAdmin: rows[0].is_admin, role: rows[0].role });
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/admin/users/:userCode', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const { userCode } = req.params;
    const { password, nickname, isAdmin, blocked, email, role } = req.body;

    if (blocked === true && userCode === req.user.userCode) {
      return res.status(400).json({ error: 'Kendi hesabınızı engelleyemezsiniz' });
    }
    if (!validEmail(email)) {
      return res.status(400).json({ error: 'Geçerli bir e-posta adresi girin' });
    }
    if (role !== undefined && !Object.values(ROLES).includes(role)) {
      return res.status(400).json({ error: 'Geçersiz rol' });
    }

    const sets = [];
    const params = [];
    if (password) {
      const passwordError = validatePassword(password);
      if (passwordError) return res.status(400).json({ error: passwordError });
      params.push(await bcrypt.hash(password, 10));
      sets.push(`password_hash = $${params.length}`);
    }
    if (nickname !== undefined) {
      params.push(nickname);
      sets.push(`nickname = $${params.length}`);
    }
    if (email !== undefined) {
      params.push(email || null);
      sets.push(`email = $${params.length}`);
    }
    if (isAdmin !== undefined) {
      params.push(!!isAdmin);
      sets.push(`is_admin = $${params.length}`);
    }
    if (role !== undefined) {
      params.push(role);
      sets.push(`role = $${params.length}`);
    }
    if (blocked !== undefined) {
      params.push(!!blocked);
      sets.push(`blocked = $${params.length}`);
    }
    if (sets.length === 0) return res.status(400).json({ error: 'Güncellenecek alan yok' });

    params.push(userCode);
    const r = await query(
      `UPDATE auth_users SET ${sets.join(', ')} WHERE user_code = $${params.length} RETURNING user_code, nickname, email, is_admin, role, blocked, created_at`,
      params
    );
    if (r.rowCount === 0) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
    const updated = r.rows[0];

    const auditDetails = {};
    if (password) auditDetails.passwordChanged = true;
    if (nickname !== undefined) auditDetails.nickname = nickname;
    if (email !== undefined) auditDetails.email = email;
    if (isAdmin !== undefined) auditDetails.isAdmin = !!isAdmin;
    if (role !== undefined) auditDetails.role = role;
    if (blocked !== undefined) auditDetails.blocked = !!blocked;
    await logAuditEvent(
      req.user,
      blocked === true ? 'user_blocked' : blocked === false ? 'user_unblocked' : 'user_updated',
      userCode,
      auditDetails
    );

    // Force out an active session immediately when blocking -- otherwise the
    // user's existing JWT (up to 4h) would keep working until it expires,
    // since "blocked" is only checked at login.
    if (blocked === true && updated.nickname) {
      const io = req.app.get('io');
      const socketId = await onlineState.getOnlineSocketId(updated.nickname);
      if (io && socketId) {
        io.to(socketId).emit('auth:blocked');
        io.sockets.sockets.get(socketId)?.disconnect(true);
      }
    }

    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/admin/users/:userCode', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const { userCode } = req.params;
    if (userCode === req.user.userCode) {
      return res.status(400).json({ error: 'Kendi hesabınızı silemezsiniz' });
    }

    const { rows } = await query('SELECT COUNT(*)::int AS count FROM auth_users WHERE is_admin = TRUE');
    const target = await findUser(userCode);
    if (target?.is_admin && rows[0].count <= 1) {
      return res.status(400).json({ error: 'Son admin hesabı silinemez' });
    }

    await query('DELETE FROM auth_users WHERE user_code = $1', [userCode]);
    await logAuditEvent(req.user, 'user_deleted', userCode, { nickname: target?.nickname });

    if (target?.nickname) {
      const io = req.app.get('io');
      const socketId = await onlineState.getOnlineSocketId(target.nickname);
      if (io && socketId) {
        io.to(socketId).emit('auth:blocked');
        io.sockets.sockets.get(socketId)?.disconnect(true);
      }
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/admin/audit-log', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const { rows } = await query(
      'SELECT id, actor_user_code, actor_nickname, action, target_user_code, details, created_at FROM admin_audit_log ORDER BY created_at DESC LIMIT 200'
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function htmlPage(type, message) {
  const colors = {
    success: { bg: '#1a7a3e', icon: '✓' },
    error: { bg: '#7a1a1a', icon: '✗' },
    reject: { bg: '#7a1a1a', icon: '⊘' }
  };
  const c = colors[type] || colors.error;
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>ANATOLIA-Q</title>
  <style>
    body{margin:0;background:#0a0e1a;font-family:'Times New Roman',serif;color:#e8e8e8;
         display:flex;align-items:center;justify-content:center;min-height:100vh;}
    .box{background:#11172a;border:1px solid #d4af37;border-radius:8px;padding:50px;max-width:500px;text-align:center;}
    .icon{font-size:64px;color:${c.bg === '#1a7a3e' ? '#4ade80' : '#ff4444'};margin-bottom:20px;}
    h1{color:#d4af37;letter-spacing:2px;margin:0 0 16px;}
    p{font-size:16px;line-height:1.6;}
    .footer{margin-top:30px;font-size:11px;color:#666;}
  </style></head>
  <body><div class="box">
    <div class="icon">${c.icon}</div>
    <h1>ANATOLIA-Q</h1>
    <p>${escapeHtml(message)}</p>
    <div class="footer">Bold Askeri Teknoloji ve Savunma Sanayi A.Ş.<br>Tüm Hakları Saklıdır</div>
  </div></body></html>`;
}

// GET confirmation step for approve/reject: a mail-security prefetch will
// only ever hit this idempotent read-only page, never the POST below that
// actually performs the action.
function confirmPage(action, token, buttonLabel, message) {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>ANATOLIA-Q</title>
  <style>
    body{margin:0;background:#0a0e1a;font-family:'Times New Roman',serif;color:#e8e8e8;
         display:flex;align-items:center;justify-content:center;min-height:100vh;}
    .box{background:#11172a;border:1px solid #d4af37;border-radius:8px;padding:50px;max-width:500px;text-align:center;}
    h1{color:#d4af37;letter-spacing:2px;margin:0 0 16px;}
    p{font-size:16px;line-height:1.6;}
    button{margin-top:20px;padding:12px 32px;background:#d4af37;color:#0a0e1a;border:none;border-radius:6px;
           font-family:'Times New Roman',serif;font-size:16px;font-weight:bold;cursor:pointer;letter-spacing:1px;}
    button:hover{background:#e8c458;}
    .footer{margin-top:30px;font-size:11px;color:#666;}
  </style></head>
  <body><div class="box">
    <h1>ANATOLIA-Q</h1>
    <p>${escapeHtml(message)}</p>
    <form method="POST" action="/api/auth/${action}/${encodeURIComponent(token)}">
      <button type="submit">${escapeHtml(buttonLabel)}</button>
    </form>
    <div class="footer">Bold Askeri Teknoloji ve Savunma Sanayi A.Ş.<br>Tüm Hakları Saklıdır</div>
  </div></body></html>`;
}

export default router;
