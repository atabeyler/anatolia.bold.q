import { describe, it, expect, vi } from 'vitest';
import { createTestMobileDb } from '../testHelpers.js';
import { createSessionManager } from './session.js';

function fakeJwt(payload) {
  const b64 = btoa(JSON.stringify(payload));
  return `header.${b64}.signature`;
}

function memoryStore() {
  let value = null;
  return { save: async (v) => { value = v; }, load: async () => value, clear: async () => { value = null; } };
}

const DEVICE = 'AQ-AND-AAAAAAAA';

async function buildManager({ fetchImpl }) {
  const db = await createTestMobileDb();
  const secureStore = memoryStore();
  const manager = createSessionManager({ db, secureStore, deviceId: DEVICE, apiBaseUrl: 'https://api.test', fetchImpl, appVersion: '1.0.0' });
  return { db, manager, secureStore };
}

describe('establishOnlineSession', () => {
  it('registers the device with the server and caches the session locally', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ success: true }) }));
    const { manager, secureStore } = await buildManager({ fetchImpl });

    const jwt = fakeJwt({ userCode: 'BOLD-001', nickname: 'Ali' });
    const result = await manager.establishOnlineSession(jwt);

    expect(result.userCode).toBe('BOLD-001');
    expect((await secureStore.load()).jwt).toBe(jwt);
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.test/api/devices/register',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('unlocks offline login for that account on this device afterward', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ success: true }) }));
    const { manager } = await buildManager({ fetchImpl });

    await manager.establishOnlineSession(fakeJwt({ userCode: 'BOLD-001' }));
    expect(await manager.isOfflineLoginAllowed('BOLD-001')).toBe(true);
    expect(await manager.isOfflineLoginAllowed('BOLD-002')).toBe(false);
  });

  it('does not cache the session if server-side device registration fails', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 403, json: async () => ({ error: 'Cihaz limiti aşıldı' }) }));
    const { manager, secureStore } = await buildManager({ fetchImpl });

    await expect(manager.establishOnlineSession(fakeJwt({ userCode: 'BOLD-001' }))).rejects.toThrow('Cihaz limiti aşıldı');
    expect(await secureStore.load()).toBeNull();
    // A 4xx is not retried -- it would just fail identically again.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('retries a transient network failure right after login instead of permanently stranding the device offline', async () => {
    vi.useFakeTimers();
    let attempts = 0;
    const fetchImpl = vi.fn(async () => {
      attempts += 1;
      if (attempts < 3) throw new TypeError('Failed to fetch');
      return { ok: true, json: async () => ({ success: true }) };
    });
    const { manager, secureStore } = await buildManager({ fetchImpl });

    const resultPromise = manager.establishOnlineSession(fakeJwt({ userCode: 'BOLD-001' }));
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.userCode).toBe('BOLD-001');
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect((await secureStore.load()).userCode).toBe('BOLD-001');
    vi.useRealTimers();
  });

  it('gives up and rejects after repeated registration failures, still without caching anything', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn(async () => { throw new TypeError('Failed to fetch'); });
    const { manager, secureStore } = await buildManager({ fetchImpl });

    const resultPromise = manager.establishOnlineSession(fakeJwt({ userCode: 'BOLD-001' }));
    const assertion = expect(resultPromise).rejects.toThrow('Failed to fetch');
    await vi.runAllTimersAsync();
    await assertion;

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(await secureStore.load()).toBeNull();
    vi.useRealTimers();
  });
});

describe('verifyOfflineLogin (spec: hashed, never plaintext)', () => {
  it('accepts the correct password for a previously online-authorized account', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ success: true }) }));
    const { manager } = await buildManager({ fetchImpl });
    await manager.establishOnlineSession(fakeJwt({ userCode: 'BOLD-001' }), 'CorrectHorse123');

    const result = await manager.verifyOfflineLogin('BOLD-001', 'CorrectHorse123');
    expect(result.ok).toBe(true);
    expect(result.jwt).toBeTruthy();
  });

  it('rejects a wrong password', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ success: true }) }));
    const { manager } = await buildManager({ fetchImpl });
    await manager.establishOnlineSession(fakeJwt({ userCode: 'BOLD-001' }), 'CorrectHorse123');

    expect((await manager.verifyOfflineLogin('BOLD-001', 'WrongPassword')).ok).toBe(false);
  });

  it('rejects offline login for a device never authorized for that account', async () => {
    const { manager } = await buildManager({ fetchImpl: vi.fn() });
    expect((await manager.verifyOfflineLogin('BOLD-001', 'whatever')).ok).toBe(false);
  });

  it('never stores the plaintext password anywhere in the cached session', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ success: true }) }));
    const { manager, secureStore } = await buildManager({ fetchImpl });
    await manager.establishOnlineSession(fakeJwt({ userCode: 'BOLD-001' }), 'CorrectHorse123');

    const stored = JSON.stringify(await secureStore.load());
    expect(stored).not.toContain('CorrectHorse123');
    expect((await secureStore.load()).offlinePasswordHash).toMatch(/^\$2[aby]\$/);
  });
});

describe('getSession', () => {
  it('never exposes the password hash to the caller', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ success: true }) }));
    const { manager } = await buildManager({ fetchImpl });
    await manager.establishOnlineSession(fakeJwt({ userCode: 'BOLD-001' }), 'CorrectHorse123');

    expect((await manager.getSession()).offlinePasswordHash).toBeUndefined();
  });

  it('still returns the cached session even past JWT expiry (local SQLite access stays available offline)', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ success: true }) }));
    const { manager } = await buildManager({ fetchImpl });
    const expiredJwt = fakeJwt({ userCode: 'BOLD-001', exp: Math.floor(Date.now() / 1000) - 3600 });

    await manager.establishOnlineSession(expiredJwt);
    expect((await manager.getSession()).userCode).toBe('BOLD-001');
  });
});

describe('needsReauth', () => {
  it('is false with no cached session at all', async () => {
    const { manager } = await buildManager({ fetchImpl: vi.fn() });
    expect(await manager.needsReauth()).toBe(false);
  });

  it('is false right after a normal online login (fresh, non-expired JWT)', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ success: true }) }));
    const { manager } = await buildManager({ fetchImpl });
    const freshJwt = fakeJwt({ userCode: 'BOLD-001', exp: Math.floor(Date.now() / 1000) + 3600 });

    await manager.establishOnlineSession(freshJwt);
    expect(await manager.needsReauth()).toBe(false);
  });

  it('is true once the cached JWT\'s exp claim has passed (e.g. after a long offline stretch)', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ success: true }) }));
    const { manager } = await buildManager({ fetchImpl });
    const expiredJwt = fakeJwt({ userCode: 'BOLD-001', exp: Math.floor(Date.now() / 1000) - 3600 });

    await manager.establishOnlineSession(expiredJwt);
    expect(await manager.needsReauth()).toBe(true);
  });

  it('goes back to false once a fresh online login replaces the expired cached session', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ success: true }) }));
    const { manager } = await buildManager({ fetchImpl });
    const expiredJwt = fakeJwt({ userCode: 'BOLD-001', exp: Math.floor(Date.now() / 1000) - 3600 });
    await manager.establishOnlineSession(expiredJwt);
    expect(await manager.needsReauth()).toBe(true);

    const freshJwt = fakeJwt({ userCode: 'BOLD-001', exp: Math.floor(Date.now() / 1000) + 3600 });
    await manager.establishOnlineSession(freshJwt);
    expect(await manager.needsReauth()).toBe(false);
  });
});

describe('logout', () => {
  it('clears the cached session and revokes offline capability for this device', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ success: true }) }));
    const { manager } = await buildManager({ fetchImpl });

    await manager.establishOnlineSession(fakeJwt({ userCode: 'BOLD-001' }));
    await manager.logout();

    expect(await manager.getSession()).toBeNull();
    expect(await manager.isOfflineLoginAllowed('BOLD-001')).toBe(false);
  });
});
