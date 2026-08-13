import bcrypt from 'bcryptjs';

function decodeJwtPayload(jwt) {
  try {
    const [, payloadB64] = jwt.split('.');
    return JSON.parse(Buffer.from(payloadB64, 'base64').toString('utf8'));
  } catch {
    return null;
  }
}

// Orchestrates: online login → register this device with the account
// (server/src/routes/devices.js) → cache the session + device authorization
// locally, so a later launch with no network can still open the app for
// this same account (spec 5: "offline login only on a previously
// authorized device").
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
  // needing the plaintext again. If establishOnlineSession is ever called
  // without a password (shouldn't happen from the real login flow), offline
  // login for this account on this device simply stays unavailable until it
  // is.
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

    const offlinePasswordHash = password ? bcrypt.hashSync(password, 10) : undefined;
    secureStore.save({
      jwt, userCode: payload.userCode, nickname: payload.nickname, isAdmin: !!payload.isAdmin,
      offlinePasswordHash,
    });
    upsertDeviceMeta({ platform, userId: payload.userCode, ts: new Date().toISOString() });
    return { userCode: payload.userCode };
  }

  // The actual offline login check: requires both (a) this device having
  // been online-authorized for this exact account before, and (b) the
  // entered password matching the bcrypt hash cached at that time --
  // verified locally, never against plaintext, never over the network.
  function verifyOfflineLogin(userCode, password) {
    if (!isOfflineLoginAllowed(userCode)) {
      return { ok: false, error: 'Bu cihaz bu hesap için daha önce çevrimiçi yetkilendirilmemiş.' };
    }
    const cached = secureStore.load();
    if (!cached || cached.userCode !== userCode || !cached.offlinePasswordHash) {
      return { ok: false, error: 'Çevrimdışı oturum bilgisi bulunamadı — lütfen önce çevrimiçi giriş yapın.' };
    }
    if (!bcrypt.compareSync(password || '', cached.offlinePasswordHash)) {
      return { ok: false, error: 'Kullanıcı kodu veya şifre hatalı.' };
    }
    return { ok: true, jwt: cached.jwt, userCode: cached.userCode, nickname: cached.nickname, isAdmin: cached.isAdmin };
  }

  // Returns the cached session even if the JWT itself has since expired --
  // an expired-but-previously-valid token still proves "this device was
  // authorized for this account" for the purpose of unlocking local SQLite
  // access while offline. Any actual server call still goes through
  // authMiddleware normally and is rejected/refreshed like any expired
  // token once connectivity returns (handled as an ordinary sync failure,
  // not a fatal desktop error).
  function getSession() {
    return secureStore.load();
  }

  function isOfflineLoginAllowed(userCode) {
    const row = db.prepare('SELECT last_authorized_user_id FROM device_meta WHERE device_id = ?').get(deviceId);
    return !!row && row.last_authorized_user_id === userCode;
  }

  // Explicit logout revokes this device's offline capability too -- the
  // next login on this machine must be online again.
  function logout() {
    secureStore.clear();
    db.prepare('UPDATE device_meta SET last_authorized_user_id = NULL WHERE device_id = ?').run(deviceId);
  }

  return { establishOnlineSession, verifyOfflineLogin, getSession, isOfflineLoginAllowed, logout };
}

export const _internal = { decodeJwtPayload };
