import { describe, it, expect, vi } from 'vitest';
import { createTestDb } from '../testHelpers.js';
import { createSessionManager } from './session.js';

function fakeJwt(payload) {
  const b64 = Buffer.from(JSON.stringify(payload)).toString('base64');
  return `header.${b64}.signature`;
}

function memoryStore() {
  let value = null;
  return {
    save: (v) => { value = v; return { persisted: true }; },
    load: () => value,
    clear: () => { value = null; },
    encryptionAvailable: () => true,
  };
}

const DEVICE = 'AQ-WIN-AAAAAAAA';

function buildManager({ fetchImpl }) {
  const db = createTestDb();
  const secureStore = memoryStore();
  const manager = createSessionManager({ db, secureStore, deviceId: DEVICE, apiBaseUrl: 'https://api.test', fetchImpl, appVersion: '1.0.0' });
  return { db, manager, secureStore };
}

describe('establishOnlineSession', () => {
  it('registers the device with the server and caches the session locally', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ success: true }) }));
    const { manager, secureStore } = buildManager({ fetchImpl });

    const jwt = fakeJwt({ userCode: 'BOLD-001', nickname: 'Ali' });
    const result = await manager.establishOnlineSession(jwt);

    expect(result.userCode).toBe('BOLD-001');
    expect(secureStore.load().jwt).toBe(jwt);
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.test/api/devices/register',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('unlocks offline login for that account on this device afterward', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ success: true }) }));
    const { manager } = buildManager({ fetchImpl });

    await manager.establishOnlineSession(fakeJwt({ userCode: 'BOLD-001' }));
    expect(manager.isOfflineLoginAllowed('BOLD-001')).toBe(true);
    expect(manager.isOfflineLoginAllowed('BOLD-002')).toBe(false); // a different account was never authorized here
  });

  it('does not cache the session if server-side device registration fails', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 403, json: async () => ({ error: 'Cihaz limiti aşıldı' }) }));
    const { manager, secureStore } = buildManager({ fetchImpl });

    await expect(manager.establishOnlineSession(fakeJwt({ userCode: 'BOLD-001' }))).rejects.toThrow('Cihaz limiti aşıldı');
    expect(secureStore.load()).toBeNull();
    // A 4xx is not retried -- it would just fail identically again.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('retries a transient network failure right after login instead of permanently stranding the device offline', async () => {
    vi.useFakeTimers();
    let attempts = 0;
    const fetchImpl = vi.fn(async () => {
      attempts += 1;
      if (attempts < 3) throw new TypeError('fetch failed');
      return { ok: true, json: async () => ({ success: true }) };
    });
    const { manager, secureStore } = buildManager({ fetchImpl });

    const resultPromise = manager.establishOnlineSession(fakeJwt({ userCode: 'BOLD-001' }));
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.userCode).toBe('BOLD-001');
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(secureStore.load().userCode).toBe('BOLD-001');
    vi.useRealTimers();
  });

  it('gives up and rejects after repeated registration failures, still without caching anything', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn(async () => { throw new TypeError('fetch failed'); });
    const { manager, secureStore } = buildManager({ fetchImpl });

    const resultPromise = manager.establishOnlineSession(fakeJwt({ userCode: 'BOLD-001' }));
    const assertion = expect(resultPromise).rejects.toThrow('fetch failed');
    await vi.runAllTimersAsync();
    await assertion;

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(secureStore.load()).toBeNull();
    vi.useRealTimers();
  });
});

describe('establishOnlineSession when no OS keychain is available', () => {
  it('surfaces sessionPersisted:false instead of silently persisting an unencrypted session', async () => {
    const db = createTestDb();
    const secureStore = {
      save: () => ({ persisted: false }),
      load: () => null,
      clear: () => {},
      encryptionAvailable: () => false,
    };
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ success: true }) }));
    const manager = createSessionManager({ db, secureStore, deviceId: DEVICE, apiBaseUrl: 'https://api.test', fetchImpl, appVersion: '1.0.0' });

    const result = await manager.establishOnlineSession(fakeJwt({ userCode: 'BOLD-001' }));
    expect(result.sessionPersisted).toBe(false);
  });
});

describe('offline login gate (spec test I)', () => {
  it('a device that was never authorized online cannot offline-login', () => {
    const { manager } = buildManager({ fetchImpl: vi.fn() });
    expect(manager.isOfflineLoginAllowed('BOLD-001')).toBe(false);
  });

  it('getSession still returns the cached session even past JWT expiry (local SQLite access stays available offline)', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ success: true }) }));
    const { manager } = buildManager({ fetchImpl });
    const expiredJwt = fakeJwt({ userCode: 'BOLD-001', exp: Math.floor(Date.now() / 1000) - 3600 });

    await manager.establishOnlineSession(expiredJwt);
    expect(manager.getSession().userCode).toBe('BOLD-001'); // still usable to unlock the local app
  });
});

describe('verifyOfflineLogin (spec: hashed, never plaintext)', () => {
  it('accepts the correct password for a previously online-authorized account', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ success: true }) }));
    const { manager } = buildManager({ fetchImpl });
    await manager.establishOnlineSession(fakeJwt({ userCode: 'BOLD-001' }), 'CorrectHorse123');

    const result = manager.verifyOfflineLogin('BOLD-001', 'CorrectHorse123');
    expect(result.ok).toBe(true);
    expect(result.jwt).toBeTruthy();
  });

  it('rejects a wrong password', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ success: true }) }));
    const { manager } = buildManager({ fetchImpl });
    await manager.establishOnlineSession(fakeJwt({ userCode: 'BOLD-001' }), 'CorrectHorse123');

    const result = manager.verifyOfflineLogin('BOLD-001', 'WrongPassword');
    expect(result.ok).toBe(false);
  });

  it('rejects offline login for a device never authorized for that account', () => {
    const { manager } = buildManager({ fetchImpl: vi.fn() });
    const result = manager.verifyOfflineLogin('BOLD-001', 'whatever');
    expect(result.ok).toBe(false);
  });

  it('never stores the plaintext password anywhere in the cached session', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ success: true }) }));
    const { manager, secureStore } = buildManager({ fetchImpl });
    await manager.establishOnlineSession(fakeJwt({ userCode: 'BOLD-001' }), 'CorrectHorse123');

    const stored = JSON.stringify(secureStore.load());
    expect(stored).not.toContain('CorrectHorse123');
    expect(secureStore.load().offlinePasswordHash).toMatch(/^\$2[aby]\$/); // a real bcrypt hash, not plaintext
  });

  it('getSession() never exposes the password hash to the caller (the renderer, via IPC)', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ success: true }) }));
    const { manager } = buildManager({ fetchImpl });
    await manager.establishOnlineSession(fakeJwt({ userCode: 'BOLD-001' }), 'CorrectHorse123');

    expect(manager.getSession().offlinePasswordHash).toBeUndefined();
  });

  it('rejects offline login after logout, even with the correct password', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ success: true }) }));
    const { manager } = buildManager({ fetchImpl });
    await manager.establishOnlineSession(fakeJwt({ userCode: 'BOLD-001' }), 'CorrectHorse123');
    manager.logout();

    expect(manager.verifyOfflineLogin('BOLD-001', 'CorrectHorse123').ok).toBe(false);
  });
});

describe('needsReauth', () => {
  it('is false with no cached session at all', () => {
    const { manager } = buildManager({ fetchImpl: vi.fn() });
    expect(manager.needsReauth()).toBe(false);
  });

  it('is false right after a normal online login (fresh, non-expired JWT)', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ success: true }) }));
    const { manager } = buildManager({ fetchImpl });
    const freshJwt = fakeJwt({ userCode: 'BOLD-001', exp: Math.floor(Date.now() / 1000) + 3600 });

    await manager.establishOnlineSession(freshJwt);
    expect(manager.needsReauth()).toBe(false);
  });

  it('is true once the cached JWT\'s exp claim has passed (e.g. after a long offline stretch)', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ success: true }) }));
    const { manager } = buildManager({ fetchImpl });
    const expiredJwt = fakeJwt({ userCode: 'BOLD-001', exp: Math.floor(Date.now() / 1000) - 3600 });

    await manager.establishOnlineSession(expiredJwt);
    expect(manager.needsReauth()).toBe(true);
  });

  it('goes back to false once a fresh online login replaces the expired cached session', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ success: true }) }));
    const { manager } = buildManager({ fetchImpl });
    const expiredJwt = fakeJwt({ userCode: 'BOLD-001', exp: Math.floor(Date.now() / 1000) - 3600 });
    await manager.establishOnlineSession(expiredJwt);
    expect(manager.needsReauth()).toBe(true);

    const freshJwt = fakeJwt({ userCode: 'BOLD-001', exp: Math.floor(Date.now() / 1000) + 3600 });
    await manager.establishOnlineSession(freshJwt);
    expect(manager.needsReauth()).toBe(false);
  });
});

describe('logout', () => {
  it('clears the cached session and revokes offline capability for this device', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ success: true }) }));
    const { manager } = buildManager({ fetchImpl });

    await manager.establishOnlineSession(fakeJwt({ userCode: 'BOLD-001' }));
    manager.logout();

    expect(manager.getSession()).toBeNull();
    expect(manager.isOfflineLoginAllowed('BOLD-001')).toBe(false);
  });
});
