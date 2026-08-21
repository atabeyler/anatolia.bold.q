import bcrypt from 'bcryptjs';
import { dbGet, dbRun } from '../db/index.js';

// A lost/stolen device with no OS-level lock of its own could otherwise be
// brute-forced against the cached bcrypt hash indefinitely -- offline login
// has no server to rate-limit it. After MAX_OFFLINE_ATTEMPTS wrong
// passwords in a row, the device locks itself out of offline login for
// OFFLINE_LOCKOUT_MS (see device_meta.offline_locked_until, migration
// 003_offline_lockout.sql). OFFLINE_SESSION_TTL_MS separately bounds how
// long a cached credential stays usable at all without a fresh online
// login, regardless of attempt count.
const MAX_OFFLINE_ATTEMPTS = 5;
const OFFLINE_LOCKOUT_MS = 15 * 60 * 1000;
const OFFLINE_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

// Browser-safe JWT payload decode (no Buffer global in a Vite web bundle),
// matching the same approach client/src/services/api.js's getCurrentUser()
// already uses for the web app. JWT payload segments are base64url (RFC
// 4648 §5: '-'/'_', no padding), not plain base64 -- atob() throws (or
// silently mangles the input) on those characters, which a token's payload
// commonly contains.
function decodeJwtPayload(jwt) {
  try {
    const [, payloadB64] = jwt.split('.');
    let base64 = payloadB64.replace(/-/g, '+').replace(/_/g, '/');
    const pad = base64.length % 4;
    if (pad) base64 += '='.repeat(4 - pad);
    return JSON.parse(atob(base64));
  } catch {
    return null;
  }
}

// Orchestrates: online login → register this device with the account
// (server/src/routes/devices.js) → cache the session + device authorization
// locally, so a later launch with no network can still open the app for
// this same account (spec 5: "offline login only on a previously
// authorized device"). Mirrors desktop/auth/session.js exactly, ported to
// the async Capacitor SQLite + secure-storage APIs.
export function createSessionManager({ db, secureStore, deviceId, apiBaseUrl, fetchImpl = fetch, platform = 'android', appVersion }) {
  async function upsertDeviceMeta(fields) {
    const existing = await dbGet(db, 'SELECT device_id FROM device_meta WHERE device_id = ?', [deviceId]);
    if (existing) {
      await dbRun(db, `
        UPDATE device_meta SET platform = ?, last_authorized_user_id = ?, last_authorized_at = ? WHERE device_id = ?
      `, [fields.platform, fields.userId, fields.ts, deviceId]);
    } else {
      await dbRun(db, `
        INSERT INTO device_meta (device_id, platform, created_at, last_authorized_user_id, last_authorized_at)
        VALUES (?, ?, ?, ?, ?)
      `, [deviceId, fields.platform, fields.ts, fields.userId, fields.ts]);
    }
  }

  // Call once the renderer's existing login flow (the same LoginPage /
  // api.js the web app already uses) has produced a valid JWT. This is the
  // "must be online once" step -- it both saves the session locally and
  // authorizes this device_id against the account on the server.
  //
  // `password` is the plaintext the user just typed into the real login
  // form -- it is NEVER persisted as-is. It's hashed here (bcrypt, same
  // cost factor the server itself uses for auth_users, see
  // server/src/routes/auth.js) purely so a *later offline* login attempt on
  // this same device can be verified locally without ever storing or
  // needing the plaintext again.
  async function establishOnlineSession(jwt, password) {
    const payload = decodeJwtPayload(jwt);
    if (!payload?.userCode) throw new Error('Geçersiz oturum belirteci');

    const res = await fetchImpl(`${apiBaseUrl}/api/devices/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
      body: JSON.stringify({ deviceId, deviceName: `ANATOLIA-Q Android (${platform})`, platform, appVersion }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `Cihaz kaydı başarısız (HTTP ${res.status})`);
    }

    const offlinePasswordHash = password ? bcrypt.hashSync(password, 10) : undefined;
    await secureStore.save({
      jwt, userCode: payload.userCode, nickname: payload.nickname, isAdmin: !!payload.isAdmin,
      offlinePasswordHash,
    });
    await upsertDeviceMeta({ platform, userId: payload.userCode, ts: new Date().toISOString() });
    // A fresh online login re-proves the user knows the real password, so
    // any offline-lockout state from earlier failed attempts no longer
    // applies to the credential that was just cached.
    await dbRun(db, 'UPDATE device_meta SET failed_offline_attempts = 0, offline_locked_until = NULL WHERE device_id = ?', [deviceId]);
    return { userCode: payload.userCode };
  }

  // The actual offline login check: requires both (a) this device having
  // been online-authorized for this exact account before, and (b) the
  // entered password matching the bcrypt hash cached at that time --
  // verified locally, never against plaintext, never over the network.
  // Also enforces a lockout after repeated wrong attempts and a max age on
  // the cached credential itself (see the constants above) -- there's no
  // server to rate-limit an offline guess, so this device has to.
  async function verifyOfflineLogin(userCode, password) {
    if (!(await isOfflineLoginAllowed(userCode))) {
      return { ok: false, error: 'Bu cihaz bu hesap için daha önce çevrimiçi yetkilendirilmemiş.' };
    }
    const cached = await secureStore.load();
    if (!cached || cached.userCode !== userCode || !cached.offlinePasswordHash) {
      return { ok: false, error: 'Çevrimdışı oturum bilgisi bulunamadı — lütfen önce çevrimiçi giriş yapın.' };
    }

    const meta = await dbGet(db, 'SELECT last_authorized_at, failed_offline_attempts, offline_locked_until FROM device_meta WHERE device_id = ?', [deviceId]);
    const now = Date.now();

    if (meta?.offline_locked_until && new Date(meta.offline_locked_until).getTime() > now) {
      return { ok: false, error: 'Çok fazla hatalı deneme. Lütfen daha sonra tekrar deneyin veya çevrimiçi giriş yapın.' };
    }
    if (meta?.last_authorized_at && now - new Date(meta.last_authorized_at).getTime() > OFFLINE_SESSION_TTL_MS) {
      return { ok: false, error: 'Çevrimdışı oturum süresi doldu — lütfen önce çevrimiçi giriş yapın.' };
    }

    if (!bcrypt.compareSync(password || '', cached.offlinePasswordHash)) {
      const attempts = (meta?.failed_offline_attempts || 0) + 1;
      const lockedUntil = attempts >= MAX_OFFLINE_ATTEMPTS ? new Date(now + OFFLINE_LOCKOUT_MS).toISOString() : null;
      await dbRun(db, 'UPDATE device_meta SET failed_offline_attempts = ?, offline_locked_until = ? WHERE device_id = ?', [attempts, lockedUntil, deviceId]);
      return lockedUntil
        ? { ok: false, error: 'Çok fazla hatalı deneme. Lütfen daha sonra tekrar deneyin veya çevrimiçi giriş yapın.' }
        : { ok: false, error: 'Kullanıcı kodu veya şifre hatalı.' };
    }

    await dbRun(db, 'UPDATE device_meta SET failed_offline_attempts = 0, offline_locked_until = NULL WHERE device_id = ?', [deviceId]);
    return { ok: true, jwt: cached.jwt, userCode: cached.userCode, nickname: cached.nickname, isAdmin: cached.isAdmin };
  }

  // Returns the cached session even if the JWT itself has since expired --
  // an expired-but-previously-valid token still proves "this device was
  // authorized for this account" for the purpose of unlocking local SQLite
  // access while offline. The bcrypt hash is stripped before returning --
  // no caller of this function has a legitimate use for it.
  async function getSession() {
    const stored = await secureStore.load();
    if (!stored) return null;
    const { offlinePasswordHash: _offlinePasswordHash, ...session } = stored;
    return session;
  }

  async function isOfflineLoginAllowed(userCode) {
    const row = await dbGet(db, 'SELECT last_authorized_user_id FROM device_meta WHERE device_id = ?', [deviceId]);
    return !!row && row.last_authorized_user_id === userCode;
  }

  // True once the cached JWT's own `exp` claim has passed -- mirrors
  // desktop/auth/session.js's needsReauth() exactly (same reasoning: no
  // server-side refresh-token endpoint, so a long offline stretch leaves a
  // stale cached token that would otherwise fail every sync call with 401
  // forever until the user happens to log out and back in).
  async function needsReauth() {
    const cached = await secureStore.load();
    if (!cached?.jwt) return false;
    const payload = decodeJwtPayload(cached.jwt);
    if (!payload?.exp) return false;
    return Date.now() >= payload.exp * 1000;
  }

  // Explicit logout revokes this device's offline capability too -- the
  // next login on this machine must be online again.
  async function logout() {
    await secureStore.clear();
    await dbRun(db, 'UPDATE device_meta SET last_authorized_user_id = NULL WHERE device_id = ?', [deviceId]);
  }

  return { establishOnlineSession, verifyOfflineLogin, getSession, isOfflineLoginAllowed, logout, needsReauth };
}

export const _internal = { decodeJwtPayload };
