import { app, BrowserWindow, Menu, ipcMain, shell, safeStorage, session } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createDiagnostics } from './diagnostics.js';
import { openDatabase } from './db/index.js';
import { listAnalyses, getAnalysis, createAnalysis, updateAnalysis, deleteAnalysis } from './db/analysesRepo.js';
import { getOrCreateDeviceId } from './auth/deviceId.js';
import { createSecureStore } from './auth/secureStore.js';
import { createSessionManager } from './auth/session.js';
import { runSync } from './sync/engine.js';
import { listUnresolvedConflicts, resolveConflict } from './sync/conflict.js';
import { createLocalAIProvider } from './localAI/provider.js';
import { createConnectivityMonitor } from './connectivity.js';
import { serveStaticDir } from './staticServer.js';
import { checkForUpdate, downloadUpdate } from './appUpdate.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// The deployed web app is the source of truth this points at by default;
// override with ANATOLIA_CLOUD_URL for a self-hosted/staging server.
const CLOUD_URL = process.env.ANATOLIA_CLOUD_URL || 'https://anatolia-q.onrender.com';
// Fixed (not random) so it can be allowlisted in the server's CORS config
// (server/src/index.js) -- see the loadURL call below.
const STATIC_SERVER_PORT = 57813;
// ANATOLIA_DESKTOP_FORCE_PROD lets an unpackaged checkout (npm run desktop,
// or this project's own smoke tests) exercise the production static-server
// load path without needing a full electron-builder build first.
const isDev = process.env.ANATOLIA_DESKTOP_FORCE_PROD !== '1'
  && (!app.isPackaged || process.env.ANATOLIA_DESKTOP_DEV === '1');

// Only one running instance touches the local SQLite file at a time.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

let mainWindow = null;
let db = null;
let deviceId = null;
let sessionManager = null;
let connectivity = null;
let syncTimer = null;
// Created before anything else in app.whenReady() so every subsequent
// step (db open, sync, IPC handlers) can log through it; diagnostics.js
// itself never throws, so this is safe to call unconditionally everywhere
// below even before that assignment runs (only during the brief window
// before whenReady resolves, which none of this code executes in).
let diagnostics = null;
// Set once checkAppUpdate() finds a newer version, read by the
// update:approve/update:install IPC handlers below.
let pendingUpdate = null;
let downloadedInstallerPath = null;

function currentUserCode() {
  return sessionManager?.getSession()?.userCode || null;
}

async function performSync() {
  const session_ = sessionManager?.getSession();
  if (!session_ || !db) return;

  // A cached JWT past its own exp claim is a guaranteed 401 on every call
  // -- there's no server-side refresh-token endpoint to silently renew it
  // with, so skip the doomed network round-trip and tell the renderer to
  // prompt for a fresh online login instead (see session.js's needsReauth
  // doc comment). The sync queue and local data are untouched either way;
  // whatever is queued gets pushed automatically the moment
  // establishOnlineSession succeeds again (its IPC handler already
  // triggers a sync right after).
  if (sessionManager.needsReauth()) {
    diagnostics?.warn('reauth_required', {});
    mainWindow?.webContents.send('auth:reauthRequired');
    return { ok: false, error: 'reauth_required', reauthRequired: true };
  }

  connectivity.markSyncing();
  diagnostics?.info('sync_start', {});
  let result;
  try {
    result = await runSync(db, {
      apiBaseUrl: CLOUD_URL,
      getToken: () => session_.jwt,
      deviceId,
      userId: session_.userCode,
    });
  } catch (err) {
    diagnostics?.error('sync_failed', { message: err.message });
    throw err;
  }
  if (result?.ok === false) {
    diagnostics?.warn('sync_failed', { message: result.error });
  } else {
    diagnostics?.info('sync_success', {
      pushed: result?.push?.pushed ?? 0,
      pulled: result?.pull?.pulled ?? 0,
    });
    const conflicts = result?.push?.conflicts ?? 0;
    if (conflicts > 0) diagnostics?.warn('sync_conflict', { count: conflicts });
  }
  await connectivity.checkOnce();
  mainWindow?.webContents.send('connectivity:change', connectivity.getState());
  return result;
}

function registerIpcHandlers() {
  ipcMain.handle('auth:establishOnlineSession', async (_e, jwt, password) => {
    const result = await sessionManager.establishOnlineSession(jwt, password);
    performSync().catch(() => {});
    return result;
  });
  ipcMain.handle('auth:verifyOfflineLogin', (_e, userCode, password) => sessionManager.verifyOfflineLogin(userCode, password));
  ipcMain.handle('auth:getSession', () => sessionManager.getSession());
  ipcMain.handle('auth:isOfflineLoginAllowed', (_e, userCode) => sessionManager.isOfflineLoginAllowed(userCode));
  ipcMain.handle('auth:needsReauth', () => sessionManager.needsReauth());
  ipcMain.handle('auth:logout', () => sessionManager.logout());

  ipcMain.handle('analyses:list', () => {
    const userId = currentUserCode();
    if (!userId) return [];
    return listAnalyses(db, userId);
  });
  ipcMain.handle('analyses:get', (_e, id) => {
    const userId = currentUserCode();
    return userId ? getAnalysis(db, userId, id) : null;
  });
  ipcMain.handle('analyses:create', (_e, data) => {
    const userId = currentUserCode();
    if (!userId) throw new Error('Oturum açılmamış');
    // userId/deviceId are session-derived and must win over any same-named
    // key the renderer's data object happens to carry -- spreading data
    // first (not last) is what makes that override impossible.
    const row = createAnalysis(db, { ...data, userId, deviceId });
    performSync().catch(() => {});
    return row;
  });
  ipcMain.handle('analyses:update', (_e, id, data) => {
    const userId = currentUserCode();
    if (!userId) throw new Error('Oturum açılmamış');
    const row = updateAnalysis(db, { ...data, userId, deviceId, id });
    performSync().catch(() => {});
    return row;
  });
  ipcMain.handle('analyses:remove', (_e, id) => {
    const userId = currentUserCode();
    if (!userId) throw new Error('Oturum açılmamış');
    const removed = deleteAnalysis(db, { userId, deviceId, id });
    performSync().catch(() => {});
    return removed;
  });

  ipcMain.handle('sync:status', () => ({ state: connectivity.getState(), deviceId }));
  ipcMain.handle('sync:forceSync', () => performSync());
  ipcMain.handle('sync:listConflicts', () => listUnresolvedConflicts(db));
  ipcMain.handle('sync:resolveConflict', (_e, conflictId, resolution) => {
    const resolved = resolveConflict(db, { conflictId, deviceId, resolution });
    if (resolved) performSync().catch(() => {});
    return resolved;
  });

  ipcMain.handle('ai:query', (_e, request) => {
    const userId = currentUserCode();
    if (!userId) return { ok: false, error: 'Oturum açılmamış' };
    return createLocalAIProvider({ db, userId, diagnostics }).query(request);
  });

  ipcMain.handle('connectivity:getState', () => connectivity.getState());

  // The renderer's update banner (see ReauthBanner-style UI) calls these
  // once the user has explicitly approved installing the version reported
  // by the 'update:available' event below. See appUpdate.js's header
  // comment for why this doesn't go through electron-updater's own
  // GitHub-facing check.
  ipcMain.handle('update:approve', async () => {
    if (!pendingUpdate) return { ok: false, error: 'Güncelleme bulunamadı' };
    try {
      const destPath = await downloadUpdate(pendingUpdate.url, app.getPath('temp'), (progress) => {
        mainWindow?.webContents.send('update:progress', progress);
      });
      downloadedInstallerPath = destPath;
      diagnostics?.info('update_downloaded', { version: pendingUpdate.version });
      return { ok: true };
    } catch (err) {
      diagnostics?.error('update_download_failed', { message: err?.message });
      return { ok: false, error: err?.message || 'İndirme başarısız' };
    }
  });
  ipcMain.handle('update:install', () => {
    if (!downloadedInstallerPath) return { ok: false, error: 'İndirilen kurulum dosyası yok' };
    shell.openPath(downloadedInstallerPath);
    // NSIS installers expect the running app to exit so they can replace
    // its files -- a short delay so openPath's spawn has actually started
    // the installer process before this process disappears.
    setTimeout(() => app.quit(), 500);
    return { ok: true };
  });
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  // No external navigation and no new windows out of the app shell — any
  // http(s) link opens in the OS browser instead of inside this window.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const target = new URL(url);
    const current = new URL(mainWindow.webContents.getURL());
    if (target.origin !== current.origin) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  if (isDev) {
    await mainWindow.loadURL('http://localhost:5173');
  } else {
    const clientDist = path.join(__dirname, '..', 'client', 'dist');
    // Fixed, not random, port: this origin needs to be allowlisted in the
    // server's CORS config (server/src/index.js's ELECTRON_APP_ORIGIN) for
    // api.js's cross-origin calls to CLOUD_URL to work at all.
    const { url } = await serveStaticDir(clientDist, { port: STATIC_SERVER_PORT });
    await mainWindow.loadURL(url);
  }

  mainWindow.on('closed', () => { mainWindow = null; });

  // Renderer console output (including CSP violations and preload errors)
  // surfaced to the main process log -- otherwise it's invisible outside
  // devtools, which nobody has open on an end user's machine.
  mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
    if (level >= 2) console.error(`[renderer] ${message} (${sourceId}:${line})`);
  });
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    console.error(`[renderer] failed to load: ${errorDescription} (${errorCode})`);
    diagnostics?.error('renderer_load_failed', { errorCode, errorDescription });
  });
  mainWindow.webContents.on('preload-error', (event, preloadPath, error) => {
    console.error(`[preload] error in ${preloadPath}:`, error);
    diagnostics?.error('preload_error', { message: error?.message });
  });
  // The renderer process crashing/being killed (OOM, GPU crash, ...) --
  // distinct from did-fail-load (a navigation failure). Logged so a crash
  // report from a user can be correlated with what the app was doing.
  mainWindow.webContents.on('render-process-gone', (event, details) => {
    console.error('[renderer] process gone:', details?.reason);
    diagnostics?.error('renderer_crash', { reason: details?.reason, exitCode: details?.exitCode });
  });
}

function buildAppMenu() {
  const template = [
    {
      label: 'ANATOLIA-Q',
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { label: 'Şimdi Senkronize Et', click: () => performSync().catch(() => {}) },
        { type: 'separator' },
        { role: 'quit', label: 'Çıkış' },
      ],
    },
    { label: 'Düzen', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }] },
    { label: 'Görünüm', submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

app.whenReady().then(async () => {
  diagnostics = createDiagnostics(app.getPath('userData'));
  diagnostics.info('app_start', { version: app.getVersion(), platform: process.platform, isDev });

  // Baseline CSP for the desktop shell (the web deploy leaves this off
  // pending a dedicated audit -- see server/src/index.js's comment; this is
  // scoped to only the Electron BrowserWindow's own session, so it can't
  // affect the web app).
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self' " + CLOUD_URL + "; connect-src 'self' " + CLOUD_URL + " wss: ws:; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; script-src 'self'",
        ],
      },
    });
  });

  db = openDatabase(path.join(app.getPath('userData'), 'anatolia-q.db'), {
    onMigrations: (applied) => diagnostics.info('db_migrated', { applied: applied.length, files: applied }),
  });
  deviceId = getOrCreateDeviceId(app.getPath('userData'));
  const secureStore = createSecureStore(app.getPath('userData'), safeStorage);
  sessionManager = createSessionManager({
    db, secureStore, deviceId, apiBaseUrl: CLOUD_URL,
    platform: process.platform, appVersion: app.getVersion(),
  });

  connectivity = createConnectivityMonitor({ apiBaseUrl: CLOUD_URL });
  connectivity.onChange((state) => {
    diagnostics.info('connectivity_change', { state });
    mainWindow?.webContents.send('connectivity:change', state);
  });
  connectivity.start();
  // A reconnect (local -> cloud) triggers an immediate sync instead of
  // waiting for the next timer tick -- spec point 3: sync starts
  // automatically the moment connectivity returns, with no user action.
  connectivity.onChange((state) => { if (state === 'cloud') performSync().catch(() => {}); });

  registerIpcHandlers();
  buildAppMenu();
  await createWindow();
  performSync().catch(() => {});

  // Periodic background sync in addition to the reconnect-triggered one
  // above, so a long-lived idle session with a flaky-but-technically-online
  // connection still eventually reconciles.
  syncTimer = setInterval(() => performSync().catch(() => {}), 5 * 60 * 1000);
  syncTimer.unref?.();

  if (!isDev && app.isPackaged) {
    // Checked via this app's own server (appUpdate.js / server/src/routes/
    // version.js), never GitHub's API directly. Only surfaces a banner for
    // the renderer to show -- nothing downloads until the user approves it
    // via the update:approve IPC handler above. Failure here (no releases
    // published yet, machine offline, ...) is never fatal -- the app just
    // runs the version it already has.
    checkForUpdate(CLOUD_URL, app.getVersion())
      .then((result) => {
        if (!result.available) return;
        pendingUpdate = result;
        diagnostics.info('update_available', { version: result.version });
        mainWindow?.webContents.send('update:available', result);
      })
      .catch((err) => {
        console.warn('[AppUpdate] check failed:', err?.message || err);
        diagnostics.error('update_check_failed', { message: err?.message });
      });
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (syncTimer) clearInterval(syncTimer);
  connectivity?.stop();
  if (process.platform !== 'darwin') app.quit();
});
