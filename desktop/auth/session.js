import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

function decodeJwtPayload(jwt) {
  try {
    const [, payloadB64] = jwt.split('.');
    return JSON.parse(Buffer.from(payloadB64, 'base64').toString('utf8'));
  } catch {
    return null;
  }
}

function makePasswordVerifier(password) {
  if (typeof password !== 'string' || password.length === 0) return null;
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 32);
  return `${salt.toString('base64')}:${hash.toString('base64')}`;
}

function verifyPassword(password, verifier) {
  if (typeof password !== 'string' || !verifier) return false;
  try {
    const [saltB64, hashB64] = verifier.split(':');
    const salt = Buffer.from(saltB64, 'base64');
    const expected = Buffer.from(hashB64, 'base64');
    const actual = scryptSync(password, salt, expected.length);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

// Orchestrates: online login → register this device with the account → cache
// the session and a one-way password verifier inside Electron safeStorage.
// The real password is never persisted by the desktop shell.
export function createSessionManager({ db, secureStore, deviceId, apiBaseUrl, fetchImpl = fetch, platform = 'win32', appVersion }) {
  function upsertDeviceMeta(fields) {
    const existing = db.prepare('SELECT device_id FROM device_meta WHERE device_id = ?').get(deviceId);
    if (existing) {
      db.prepare(`
        UPDATE device_meta SET platform = @platform, last_authorized_user_id = @userId, last_authorized_at = @ts
        WHERE device_id = @deviceId
      `).run({ deviceId, platform: fields.platform, userId: fields.userId, ts: fields.ts });
    } else {
      db.prepare(`
        INSERT INTO device_meta (device_id, platform, created_at, last_authorized_user_id, last_authorized_at)
        VALUES (@deviceId, @platform, @ts, @userId, @ts)
      `).run({ deviceId, platform: fields.platform, userId: fields.userId, ts: fields.ts });
    }
  }

  // Called only after the normal cloud login has succeeded. Password is used
  // solely to derive a salted scrypt verifier; it is never stored verbatim.
  async function establishOnlineSession(jwt, password) {
    const payload = decodeJwtPayload(jwt);
    if (!payload?.userCode) throw new Error('Geçersiz oturum belirteci');

    const res = await fetchImpl(`${apiBaseUrl}/api/devices/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
      body: JSON.stringify({ deviceId, deviceName: `ANATOLIA-Q Desktop (${platform})`, platform, appVersion }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `Cihaz kaydı başarısız (HTTP ${res.status})`);
    }

    const passwordVerifier = makePasswordVerifier(password);
    secureStore.save({ jwt, userCode: payload.userCode, nickname: payload.nickname, isAdmin: !!payload.isAdmin, passwordVerifier });
    upsertDeviceMeta({ platform, userId: payload.userCode, ts: new Date().toISOString() });
    return { userCode: payload.userCode };
  }

  function getSession() {
    const stored = secureStore.load();
    if (!stored) return null;
    // Never expose the verifier to the renderer.
    const { passwordVerifier: _passwordVerifier, ...session } = stored;
    return session;
  }

  function isOfflineLoginAllowed(userCode) {
    const row = db.prepare('SELECT last_authorized_user_id FROM device_meta WHERE device_id = ?').get(deviceId);
    const stored = secureStore.load();
    return !!row && row.last_authorized_user_id === userCode && stored?.userCode === userCode && !!stored?.passwordVerifier;
  }

  function verifyOfflineLogin(userCode, password) {
    const normalized = String(userCode || '').trim();
    if (!isOfflineLoginAllowed(normalized)) return { ok: false };
    const stored = secureStore.load();
    if (!verifyPassword(password, stored.passwordVerifier)) return { ok: false };
    return { ok: true, userCode: stored.userCode, isAdmin: !!stored.isAdmin, jwt: stored.jwt };
  }

  // Explicit logout revokes this device's offline capability too.
  function logout() {
    secureStore.clear();
    db.prepare('UPDATE device_meta SET last_authorized_user_id = NULL WHERE device_id = ?').run(deviceId);
  }

  return { establishOnlineSession, getSession, isOfflineLoginAllowed, verifyOfflineLogin, logout };
}

export const _internal = { decodeJwtPayload, makePasswordVerifier, verifyPassword };
