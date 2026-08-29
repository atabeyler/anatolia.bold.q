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
    // Machine-readable codes (not Turkish prose) below, matching this
    // codebase's own 'local_llm_unavailable'-style convention -- errors
    // from this module previously leaked raw Turkish sentences straight
    // into a session an English/German/French/Arabic-language user set
    // up, bypassing the i18n system entirely (LoginPage.jsx's
    // attemptOfflineLogin() shows result.error/e.message verbatim). The UI
    // layer maps these codes through t() instead.
    if (!payload?.userCode) throw new Error('invalid_session_token');

    // This one round-trip is the single gate on this device ever getting
    // offline-login capability at all -- a login just succeeded (the JWT
    // above proves it), so a brief network blip failing only *this* call
    // right afterwards would otherwise silently strand the device with no
    // offline fallback until the next fully-successful online login, with
    // nothing shown to the user (registerNativeSession's caller only
    // console.warns on failure -- see its comment in LoginPage.jsx). Retry
    // a few times before giving up, same reasoning as UpdateBanner.jsx's
    // periodic re-check: one failed attempt right after connectivity was
    // just proven to exist is far more likely transient than permanent.
    let res;
    let lastErr;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        res = await fetchImpl(`${apiBaseUrl}/api/devices/register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
          body: JSON.stringify({ deviceId, deviceName: `ANATOLIA-Q Android (${platform})`, platform, appVersion }),
        });
        // Only a server-side/transient failure (5xx) is worth retrying; a
        // 4xx (e.g. invalid deviceId) will just fail identically again.
        if (res.ok || res.status < 500) break;
      } catch (err) {
        lastErr = err;
      }
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 750));
    }
    if (!res) throw lastErr || new Error('device_registration_failed:network');
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `device_registration_failed:${res.status}`);
    }

    const offlinePasswordHash = password ? bcrypt.hashSync(password, 12) : undefined;
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
      return { ok: false, error: 'device_not_authorized_offline' };
    }
    const cached = await secureStore.load();
    if (!cached || cached.userCode !== userCode || !cached.offlinePasswordHash) {
      return { ok: false, error: 'no_offline_session' };
    }

    const meta = await dbGet(db, 'SELECT last_authorized_at, failed_offline_attempts, offline_locked_until FROM device_meta WHERE device_id = ?', [deviceId]);
    const now = Date.now();

    if (meta?.offline_locked_until && new Date(meta.offline_locked_until).getTime() > now) {
      return { ok: false, error: 'too_many_offline_attempts' };
    }
    if (meta?.last_authorized_at && now - new Date(meta.last_authorized_at).getTime() > OFFLINE_SESSION_TTL_MS) {
      return { ok: false, error: 'offline_session_expired' };
    }

    if (!bcrypt.compareSync(password || '', cached.offlinePasswordHash)) {
      const attempts = (meta?.failed_offline_attempts || 0) + 1;
      const lockedUntil = attempts >= MAX_OFFLINE_ATTEMPTS ? new Date(now + OFFLINE_LOCKOUT_MS).toISOString() : null;
      await dbRun(db, 'UPDATE device_meta SET failed_offline_attempts = ?, offline_locked_until = ? WHERE device_id = ?', [attempts, lockedUntil, deviceId]);
      return lockedUntil
        ? { ok: false, error: 'too_many_offline_attempts' }
        : { ok: false, error: 'invalid_credentials' };
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

  // Clears only the active session (the cached JWT) -- this device's
  // offline-login authorization (device_meta.last_authorized_user_id +
  // the cached bcrypt hash) is deliberately left intact, so the same
  // account can immediately offline-login again on this device without
  // a fresh online round-trip. There is no partial-update primitive on
  // secureStore (only save/load/clear), so re-saving the full cached
  // object with jwt: null is how a single field gets cleared. Mirrors
  // desktop/auth/session.js's logoutSession() exactly.
  async function logoutSession() {
    const cached = await secureStore.load();
    if (!cached) return;
    await secureStore.save({ ...cached, jwt: null });
  }

  // Full device revocation: wipes the local session cache, this device's
  // offline-login authorization, *and* the offline-lockout state (a fresh
  // credential means any earlier failed-attempt count no longer applies),
  // then best-effort tells the server this device is no longer trusted for
  // the account. Unlike logoutSession(), a later login on this machine must
  // be online again before offline login works here for this account.
  async function forgetDevice() {
    // Captured before clearing -- the jwt is needed for the server call
    // below, and secureStore has no way to read it back afterward.
    const cached = await secureStore.load();
    await secureStore.clear();
    await dbRun(db, 'UPDATE device_meta SET last_authorized_user_id = NULL, last_authorized_at = NULL, failed_offline_attempts = 0, offline_locked_until = NULL WHERE device_id = ?', [deviceId]);
    // Fire-and-forget -- the local wipe above is what actually matters for
    // this device; a network blip or an already-expired token here must
    // never block or fail forgetDevice() itself.
    if (cached?.jwt) {
      fetchImpl(`${apiBaseUrl}/api/devices/${deviceId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${cached.jwt}` },
      }).catch(() => {});
    }
  }

  return { establishOnlineSession, verifyOfflineLogin, getSession, isOfflineLoginAllowed, logoutSession, forgetDevice, needsReauth };
}

export const _internal = { decodeJwtPayload };
