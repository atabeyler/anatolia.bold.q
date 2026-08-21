import { describe, it, expect, vi, beforeEach } from 'vitest';

// This test proves the *real* production call site -- main.js's
// 'update:approve' IPC handler, registered via registerIpcHandlers() as
// part of the normal app.whenReady() startup flow -- forwards
// pendingUpdate.sha256 through to downloadUpdate() as the 7th positional
// argument.
//
// Regression covered: the handler used to call
//   downloadUpdate(url, name, destDir, onProgress, fetch, size)
// -- six args, silently dropping expectedSha256 (the 7th parameter in
// appUpdate.js's signature). downloadUpdate() correctly fails closed when
// expectedSha256 is missing (see appUpdate.js), so every real update
// download in a packaged app failed regardless of whether the server
// reported a correct hash. This test exercises main.js's actual ipcMain
// registration (not just downloadUpdate() in isolation, which is already
// covered by appUpdate.test.js) so a future refactor of the call site
// can't silently reintroduce the same argument-count bug.
//
// electron and every other module main.js imports are mocked below so the
// module can be loaded under plain Node (vitest's `node` environment) --
// none of electron's native bindings exist there.
const { ipcHandlers, makeWindow, checkForUpdateSpy, downloadUpdateSpy } = vi.hoisted(() => {
  const ipcHandlers = new Map();

  function makeWindow() {
    return {
      webContents: {
        setWindowOpenHandler: () => {},
        on: () => {},
        getURL: () => 'http://localhost:57813/',
      },
      on: () => {},
      once: () => {},
      show: () => {},
      loadURL: async () => {},
      isDestroyed: () => false,
      close: () => {},
      isMinimized: () => false,
      focus: () => {},
      setMenuBarVisibility: () => {},
    };
  }

  const checkForUpdateSpy = vi.fn(async () => ({
    available: true,
    version: '9.9.9',
    notes: 'test release',
    url: 'https://example.com/update.exe',
    name: 'update.exe',
    size: 1000,
    // The field pendingUpdate actually carries (see appUpdate.js's
    // checkForUpdate: `sha256: asset.sha256 || null`).
    sha256: 'a'.repeat(64),
    platform: 'linux',
  }));

  const downloadUpdateSpy = vi.fn(async () => '/tmp/anatolia-test-download/update.exe');

  return { ipcHandlers, makeWindow, checkForUpdateSpy, downloadUpdateSpy };
});

vi.mock('electron', () => {
  class BrowserWindow {
    constructor() {
      return makeWindow();
    }
    static getAllWindows() {
      return [];
    }
  }
  return {
    app: {
      requestSingleInstanceLock: () => true,
      quit: () => {},
      isPackaged: true,
      getPath: () => '/tmp/anatolia-test-userdata',
      getVersion: () => '1.0.0',
      whenReady: () => Promise.resolve(),
      on: () => {},
    },
    BrowserWindow,
    Menu: { setApplicationMenu: () => {}, buildFromTemplate: () => [] },
    ipcMain: { handle: (channel, fn) => ipcHandlers.set(channel, fn) },
    shell: { openPath: () => {}, openExternal: () => {} },
    safeStorage: {},
    session: { defaultSession: { webRequest: { onHeadersReceived: () => {} } } },
  };
});

vi.mock('./diagnostics.js', () => ({
  createDiagnostics: () => ({ info: () => {}, warn: () => {}, error: () => {} }),
}));
vi.mock('./db/index.js', () => ({ openDatabase: () => ({}) }));
vi.mock('./db/dbKey.js', () => ({ createDbKeyStore: () => ({ getOrCreateKey: () => null }) }));
vi.mock('./db/analysesRepo.js', () => ({
  listAnalyses: () => [],
  getAnalysis: () => null,
  createAnalysis: () => ({}),
  updateAnalysis: () => ({}),
  deleteAnalysis: () => ({}),
}));
vi.mock('./auth/deviceId.js', () => ({ getOrCreateDeviceId: () => 'device-1' }));
vi.mock('./auth/secureStore.js', () => ({ createSecureStore: () => ({}) }));
vi.mock('./auth/session.js', () => ({
  createSessionManager: () => ({ getSession: () => null, needsReauth: () => false }),
}));
vi.mock('./sync/engine.js', () => ({ runSync: () => Promise.resolve({ ok: true }) }));
vi.mock('./sync/conflict.js', () => ({ listUnresolvedConflicts: () => [], resolveConflict: () => null }));
vi.mock('./localAI/provider.js', () => ({ createLocalAIProvider: () => ({ query: () => ({}) }) }));
vi.mock('./localAI/registry.js', () => ({ configureLocalLLM: () => {}, getModelManager: () => ({}) }));
vi.mock('./connectivity.js', () => ({
  createConnectivityMonitor: () => ({
    onChange: () => {},
    start: () => {},
    onReconnect: () => {},
    stop: () => {},
    getState: () => 'local',
    checkOnce: () => Promise.resolve(),
  }),
}));
vi.mock('./staticServer.js', () => ({ serveStaticDir: () => Promise.resolve({ url: 'http://localhost:57813' }) }));
vi.mock('./appUpdate.js', () => ({
  checkForUpdate: checkForUpdateSpy,
  downloadUpdate: downloadUpdateSpy,
}));

describe('update:approve production wiring (desktop/main.js)', () => {
  beforeEach(() => {
    ipcHandlers.clear();
    checkForUpdateSpy.mockClear();
    downloadUpdateSpy.mockClear();
    delete process.env.ANATOLIA_DESKTOP_DEV;
    delete process.env.ANATOLIA_DESKTOP_FORCE_PROD;
  });

  it('forwards pendingUpdate.sha256 to downloadUpdate as the 7th argument', async () => {
    vi.resetModules();

    // Loading main.js runs its module-level side effects, including
    // app.whenReady().then(...) which calls registerIpcHandlers() (wiring
    // up 'update:approve') and, since app.isPackaged is true here, the
    // fire-and-forget checkAndBroadcastUpdate() that populates
    // pendingUpdate from checkForUpdate()'s result.
    await import('./main.js');

    // Let the async whenReady callback chain (registerIpcHandlers ->
    // createWindow -> checkAndBroadcastUpdate -> checkForUpdate) settle.
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(checkForUpdateSpy).toHaveBeenCalled();

    const approveHandler = ipcHandlers.get('update:approve');
    expect(approveHandler).toBeTypeOf('function');

    const result = await approveHandler();

    expect(result).toEqual({ ok: true });
    expect(downloadUpdateSpy).toHaveBeenCalledTimes(1);

    const args = downloadUpdateSpy.mock.calls[0];
    // downloadUpdate's real signature (appUpdate.js):
    // (url, fileName, destDir, onProgress, fetchImpl, expectedSize, expectedSha256)
    expect(args).toHaveLength(7);
    expect(args[0]).toBe('https://example.com/update.exe');
    expect(args[1]).toBe('update.exe');
    expect(args[5]).toBe(1000);
    // This is the field the P1 bug dropped: expectedSha256 must be the
    // truthy value pendingUpdate actually carries, not undefined/null.
    expect(args[6]).toBe('a'.repeat(64));
    expect(args[6]).toBeTruthy();
  });
});
