import { describe, it, expect, vi } from 'vitest';
import { createTestDb } from '../testHelpers.js';
import { createSessionManager } from './session.js';

function fakeJwt(payload) {
  const b64 = Buffer.from(JSON.stringify(payload)).toString('base64');
  return `header.${b64}.signature`;
}

function memoryStore() {
  let value = null;
  return { save: (v) => { value = v; }, load: () => value, clear: () => { value = null; } };
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
