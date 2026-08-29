import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createFakeSqliteConnection } from '../mobile/testHelpers.js';

// mobileBridge.js's isMobileApp is computed once at import time from
// Capacitor.isNativePlatform(), so every test here mocks @capacitor/core to
// report 'android' *before* a fresh dynamic import (vi.resetModules()) --
// otherwise every exported method silently no-ops (guard()'s web/desktop
// path). DB-backed paths (getSessionManager -> getDb) reuse the same fake
// SQLite connection pattern as mobile/testHelpers.js (a real in-memory
// better-sqlite3 db behind the @capacitor-community/sqlite plugin shape),
// per mobile/README.md's Testing section, wired through a minimal
// SQLiteConnection stand-in since production code goes through that class
// rather than the raw connection object testHelpers.js hands session.test.js
// directly.

function fakeJwt(payload) {
  const b64 = btoa(JSON.stringify(payload));
  return `header.${b64}.signature`;
}

function fakeSecureStorage() {
  const map = new Map();
  return {
    getItem: vi.fn(async (key) => (map.has(key) ? map.get(key) : null)),
    setItem: vi.fn(async (key, value) => { map.set(key, value); }),
    removeItem: vi.fn(async (key) => { map.delete(key); }),
  };
}

function mockNativePlugins() {
  const fakeSqlite = createFakeSqliteConnection();
  vi.doMock('@capacitor/core', () => ({
    Capacitor: { isNativePlatform: () => true, getPlatform: () => 'android' },
  }));
  vi.doMock('@capacitor-community/sqlite', () => ({
    SQLiteConnection: class {
      isConnection(...args) { return fakeSqlite.isConnection(...args); }
      createConnection(...args) { return fakeSqlite.createConnection(...args); }
      retrieveConnection(...args) { return fakeSqlite.retrieveConnection(...args); }
      closeConnection(...args) { return fakeSqlite.closeConnection(...args); }
    },
    CapacitorSQLite: {},
  }));
  vi.doMock('@aparajita/capacitor-secure-storage', () => ({ SecureStorage: fakeSecureStorage() }));
}

// appModePreference.js's subscribeAppModePreference() attaches a plain
// window 'anatolia:app-mode-change' listener that outlives vi.resetModules()
// (jsdom's window isn't torn down between tests in the same file) -- without
// tracking and removing them, a later test's setAppMode() would also fire
// every earlier test's now-stale mobileBridge module instance (still
// pointed at the *current* global fetch), double-counting calls. Track every
// addEventListener call for this one event type per test and remove them
// all in afterEach.
let trackedListeners = [];
const realAddEventListener = window.addEventListener.bind(window);
beforeEach(() => {
  trackedListeners = [];
  vi.spyOn(window, 'addEventListener').mockImplementation((type, handler, opts) => {
    if (type === 'anatolia:app-mode-change') trackedListeners.push(handler);
    return realAddEventListener(type, handler, opts);
  });
});

afterEach(() => {
  for (const handler of trackedListeners) window.removeEventListener('anatolia:app-mode-change', handler);
  localStorage.clear();
  vi.restoreAllMocks();
  vi.doUnmock('@capacitor/core');
  vi.doUnmock('@capacitor-community/sqlite');
  vi.doUnmock('@aparajita/capacitor-secure-storage');
  vi.doUnmock('../mobile/sync/engine.js');
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('mobileBridge -- Offline Mode connectivity gate', () => {
  it('checkConnectivity reports "local" with no /api/health fetch while Offline Mode is on', async () => {
    localStorage.setItem('anatolia_app_mode', 'offline');
    mockNativePlugins();
    const fetchMock = vi.fn(async () => ({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    vi.resetModules();

    const { mobileConnectivity } = await import('./mobileBridge.js');
    await new Promise((r) => setTimeout(r, 0));

    expect(await mobileConnectivity.getState()).toBe('local');
    const healthCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes('/api/health'));
    expect(healthCalls).toHaveLength(0);
  });

  it('an offline -> auto flip triggers exactly one reconciling checkConnectivity call', async () => {
    localStorage.setItem('anatolia_app_mode', 'offline');
    mockNativePlugins();
    const fetchMock = vi.fn(async (url) => (String(url).includes('/api/health') ? { ok: true } : { ok: false }));
    vi.stubGlobal('fetch', fetchMock);
    vi.resetModules();

    const { mobileConnectivity } = await import('./mobileBridge.js');
    const appModePref = await import('./appModePreference.js');
    await new Promise((r) => setTimeout(r, 0));
    fetchMock.mockClear();

    appModePref.setAppMode('auto');
    await new Promise((r) => setTimeout(r, 0));

    const healthCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes('/api/health'));
    expect(healthCalls).toHaveLength(1);
    expect(await mobileConnectivity.getState()).toBe('cloud');
  });
});

describe('mobileBridge -- Offline Mode sync gate', () => {
  it('performSync (via mobileSync.forceSync) skips the sync engine entirely while Offline Mode is on', async () => {
    localStorage.setItem('anatolia_app_mode', 'offline');
    mockNativePlugins();
    const runSyncSpy = vi.fn();
    vi.doMock('../mobile/sync/engine.js', () => ({ runSync: runSyncSpy }));
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false })));
    vi.resetModules();

    const { mobileSync } = await import('./mobileBridge.js');
    const result = await mobileSync.forceSync();

    expect(result).toEqual({ ok: false, skipped: true });
    expect(runSyncSpy).not.toHaveBeenCalled();
  });
});

describe('mobileBridge -- forgetDevice offline/auto handoff', () => {
  it('skips the DELETE while offline, persists a pending revoke marker, and flushes it once back to Auto', async () => {
    mockNativePlugins();
    const registerCalls = [];
    const deleteCalls = [];
    const fetchMock = vi.fn(async (url, options = {}) => {
      const u = String(url);
      if (u.includes('/api/devices/register')) { registerCalls.push(u); return { ok: true, json: async () => ({}) }; }
      if (options.method === 'DELETE' && u.includes('/api/devices/')) { deleteCalls.push(u); return { ok: true, json: async () => ({}) }; }
      return { ok: false, json: async () => ({}) };
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.resetModules();

    const { mobileAuth } = await import('./mobileBridge.js');
    const appModePref = await import('./appModePreference.js');

    await mobileAuth.establishOnlineSession(fakeJwt({ userCode: 'BOLD-001' }), 'pw');
    expect(registerCalls).toHaveLength(1);

    appModePref.setAppMode('offline');
    const result = await mobileAuth.forgetDevice();

    expect(result.pendingServerRevoke).toBeTruthy();
    expect(deleteCalls).toHaveLength(0);
    const stored = JSON.parse(localStorage.getItem('anatolia_pending_device_revoke'));
    expect(stored).toMatchObject({ deviceId: result.pendingServerRevoke.deviceId, jwt: result.pendingServerRevoke.jwt });

    appModePref.setAppMode('auto');
    await new Promise((r) => setTimeout(r, 0));

    expect(deleteCalls).toHaveLength(1);
    expect(localStorage.getItem('anatolia_pending_device_revoke')).toBeNull();
  });
});
