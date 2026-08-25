import { app, BrowserWindow, Menu, ipcMain, shell, safeStorage, session } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createDiagnostics } from './diagnostics.js';
import { openDatabase } from './db/index.js';
import { createDbKeyStore } from './db/dbKey.js';
import { listAnalyses, getAnalysis, createAnalysis, updateAnalysis, deleteAnalysis } from './db/analysesRepo.js';
import { getOrCreateDeviceId } from './auth/deviceId.js';
import { createSecureStore } from './auth/secureStore.js';
import { createSessionManager } from './auth/session.js';
import { runSync } from './sync/engine.js';
import { listUnresolvedConflicts, resolveConflict } from './sync/conflict.js';
import { createLocalAIProvider } from './localAI/provider.js';
import { configureLocalLLM, getModelManager } from './localAI/registry.js';
import { createConnectivityMonitor } from './connectivity.js';
import { serveStaticDir } from './staticServer.js';
// electron-updater is a CommonJS package with no "exports" map telling
// Node's ESM interop which of its properties are safe to statically
// detect as named exports -- `import { autoUpdater } from 'electron-updater'`
// throws "Named export 'autoUpdater' not found" in a packaged app (this
// only surfaced after shipping; the dev/test runs here all went through a
// mocked module, which bypasses Node's real CJS/ESM interop entirely).
// Importing the default and destructuring is what Node itself suggests as
// the fix, and works in both packaged and unpackaged runs.
import electronUpdaterPkg from 'electron-updater';
const { autoUpdater } = electronUpdaterPkg;

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// The deployed web app is the source of truth this points at by default;
// override with ANATOLIA_CLOUD_URL for a self-hosted/staging server.
const CLOUD_URL = process.env.ANATOLIA_CLOUD_URL || 'https://site--anatoliaboldq--6ftfc8q7458m.code.run';
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
let splashWindow = null;
let db = null;
let deviceId = null;
let sessionManager = null;
let connectivity = null;
let syncTimer = null;
let updateTimer = null;
// Created before anything else in app.whenReady() so every subsequent
// step (db open, sync, IPC handlers) can log through it; diagnostics.js
// itself never throws, so this is safe to call unconditionally everywhere
// below even before that assignment runs (only during the brief window
// before whenReady resolves, which none of this code executes in).
let diagnostics = null;
// Set once electron-updater's 'update-available' event fires (see
// configureAutoUpdater below), read by the update:approve/update:install/
// update:getAvailable IPC handlers.
let pendingUpdate = null;
let updateReadyToInstall = false;
let splashShownAt = 0;
let updateCheckInFlight = false;

// electron-updater's own UpdateInfo carries more than the renderer needs
// (and releaseNotes can be a per-version array instead of a string,
// depending on how many versions were skipped) -- narrow it down to the
// {available, version, notes} shape the renderer's UpdateBanner already
// expects from the old custom update flow.
function toRendererUpdateInfo(info) {
  return {
    available: true,
    version: info.version,
    notes: typeof info.releaseNotes === 'string' ? info.releaseNotes : '',
  };
}

// electron-updater's own "generic" provider feed, served by this app's own
// server (see server/src/routes/version.js's /generic/*) instead of ever
// pointing at GitHub -- that route proxies electron-builder's published
// latest.yml/latest-mac.yml/latest-linux.yml and each installer's
// .blockmap through, rewriting every URL inside to itself first, so
// nothing in the update flow (metadata *or* the differential download
// requests) ever names github.com to the client. Configured lazily so
// tests that stub electron-updater don't need CLOUD_URL to resolve to
// anything real.
function configureAutoUpdater() {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.setFeedURL({ provider: 'generic', url: `${CLOUD_URL}/api/version/generic` });

  autoUpdater.on('update-available', (info) => {
    if (pendingUpdate?.version === info.version) return;
    pendingUpdate = toRendererUpdateInfo(info);
    updateReadyToInstall = false;
    diagnostics?.info('update_available', { version: info.version });
    mainWindow?.webContents.send('update:available', pendingUpdate);
  });
  autoUpdater.on('update-downloaded', () => {
    updateReadyToInstall = true;
  });
  autoUpdater.on('download-progress', (progress) => {
    mainWindow?.webContents.send('update:progress', { received: Math.round(progress.transferred), total: Math.round(progress.total) });
  });
  autoUpdater.on('error', (err) => {
    diagnostics?.error('update_error', { message: err?.message });
  });
}

function createSplashWindow() {
  const iconData = fs.readFileSync(path.join(__dirname, 'build', 'icon.png')).toString('base64');
  const splashHtml = `<!doctype html>
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline';" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>ANATOLIA-Q</title>
      <style>
        :root { color-scheme: dark; }
        html, body { width: 100%; height: 100%; margin: 0; }
        body {
          overflow: hidden;
          background:
            radial-gradient(circle at 50% 38%, rgba(0, 120, 180, 0.22), transparent 34%),
            linear-gradient(180deg, #08111f 0%, #050a14 100%);
          color: #d4af37;
          display: grid;
          place-items: center;
          font-family: "Cinzel", "Times New Roman", serif;
          letter-spacing: 0.28em;
          text-transform: uppercase;
        }
        .frame {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 18px;
          padding: 32px 28px;
          border: 1px solid rgba(0, 212, 255, 0.16);
          background: rgba(2, 8, 18, 0.42);
          box-shadow:
            0 0 50px rgba(0, 120, 180, 0.12),
            inset 0 0 40px rgba(212, 175, 55, 0.05);
          min-width: 360px;
        }
        img {
          width: 164px;
          height: 164px;
          image-rendering: auto;
          animation: pulse 2.8s ease-in-out infinite;
          filter: drop-shadow(0 0 16px rgba(0, 200, 255, 0.25));
        }
        .title { font-size: 22px; }
        .subtitle {
          font-size: 11px;
          color: rgba(212, 175, 55, 0.72);
        }
        @keyframes pulse {
          0%, 100% { transform: scale(1); opacity: 0.96; }
          50% { transform: scale(1.03); opacity: 1; }
        }
      </style>
    </head>
    <body>
      <div class="frame">
        <img src="data:image/png;base64,${iconData}" alt="ANATOLIA-Q" />
        <div class="title">ANATOLIA-Q</div>
        <div class="subtitle">BOLD TECHNOLOGIES</div>
      </div>
    </body>
  </html>`;

  splashShownAt = Date.now();
  splashWindow = new BrowserWindow({
    width: 520,
    height: 560,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    show: true,
    frame: false,
    center: true,
    transparent: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    backgroundColor: '#050a14',
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });
  splashWindow.setMenuBarVisibility(false);
  splashWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(splashHtml)}`);
  splashWindow.on('closed', () => { splashWindow = null; });
  return splashWindow;
}

function hideSplashThenShowMain() {
  // Matches DISPLAY_MS in client/src/components/SplashScreen.jsx (the
  // in-app splash Android/PWA show instead of this native window) so the
  // pre-login launch screen lasts the same amount of time on every
  // platform -- keep the two in sync if either changes.
  const minSplashMs = 2500;
  const remaining = Math.max(0, minSplashMs - (Date.now() - splashShownAt));
  setTimeout(() => {
    if (splashWindow && !splashWindow.isDestroyed()) splashWindow.close();
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.show();
  }, remaining);
}

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

async function checkAndBroadcastUpdate() {
  if (isDev || !app.isPackaged || updateCheckInFlight) return;
  updateCheckInFlight = true;
  try {
    // Resolves once electron-updater has fetched and compared the feed;
    // pendingUpdate/the 'update:available' push happen from the
    // 'update-available' listener registered in configureAutoUpdater, not
    // here, since that's also how a version found by a *later* check (the
    // 5-minute interval below) reaches the renderer.
    await autoUpdater.checkForUpdates();
  } catch (err) {
    console.warn('[AppUpdate] check failed:', err?.message || err);
    diagnostics?.error('update_check_failed', { message: err?.message });
  } finally {
    updateCheckInFlight = false;
  }
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
    if (!userId) throw new Error('not_logged_in');
    // userId/deviceId are session-derived and must win over any same-named
    // key the renderer's data object happens to carry -- spreading data
    // first (not last) is what makes that override impossible.
    const row = createAnalysis(db, { ...data, userId, deviceId });
    performSync().catch(() => {});
    return row;
  });
  ipcMain.handle('analyses:update', (_e, id, data) => {
    const userId = currentUserCode();
    if (!userId) throw new Error('not_logged_in');
    const row = updateAnalysis(db, { ...data, userId, deviceId, id });
    performSync().catch(() => {});
    return row;
  });
  ipcMain.handle('analyses:remove', (_e, id) => {
    const userId = currentUserCode();
    if (!userId) throw new Error('not_logged_in');
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
    if (!userId) return { ok: false, error: 'not_logged_in' };
    return createLocalAIProvider({ db, userId, diagnostics }).query(request);
  });

  // Model Manager IPC surface -- lets a future Settings panel drive
  // install/remove/status for the local LLM without any of this module's
  // logic living in the renderer. Every handler here only touches the
  // local filesystem/device info or, for downloadModel, the one Hugging
  // Face URL pinned in modelSpec.js -- never anything else (spec point 9).
  ipcMain.handle('ai:modelStatus', () => {
    const mm = getModelManager();
    return { installed: mm.isModelInstalled(), available: mm.isAvailable(), capability: mm.checkCapability(), spec: mm.spec };
  });
  ipcMain.handle('ai:modelDownload', async (event) => {
    const mm = getModelManager();
    try {
      const result = await mm.downloadModel({
        onProgress: (progress) => event.sender.send('ai:modelDownloadProgress', progress),
      });
      diagnostics.info('local_llm_model_installed', { sha256: result.sha256 });
      return { ok: true, ...result };
    } catch (err) {
      diagnostics.error('local_llm_model_download_failed', { message: err.message });
      return { ok: false, error: err.message };
    }
  });
  ipcMain.handle('ai:modelRemove', async () => getModelManager().removeModel());

  ipcMain.handle('connectivity:getState', () => connectivity.getState());

  // The renderer's update banner calls these once the user has explicitly
  // approved installing the version reported by the 'update:available'
  // event (see configureAutoUpdater above). electron-updater's own
  // differential (blockmap) downloader and per-file sha512 verification
  // (against the values in the generic feed's latest.yml, itself proxied
  // through this app's own server -- see server/src/routes/version.js)
  // replace the previous hand-rolled download+SHA-256-check flow: a
  // failing verification rejects downloadUpdate() below the same way a
  // checksum mismatch used to, so nothing partially-downloaded or
  // tampered-with ever reaches quitAndInstall().
  ipcMain.handle('update:approve', async () => {
    if (!pendingUpdate) return { ok: false, error: 'update_not_found' };
    updateReadyToInstall = false;
    try {
      await autoUpdater.downloadUpdate();
      diagnostics?.info('update_downloaded', { version: pendingUpdate.version });
      return { ok: true };
    } catch (err) {
      diagnostics?.error('update_download_failed', { message: err?.message });
      return { ok: false, error: err?.message || 'İndirme başarısız' };
    }
  });
  ipcMain.handle('update:getAvailable', () => pendingUpdate);
  ipcMain.handle('update:install', () => {
    if (!updateReadyToInstall) return { ok: false, error: 'installer_missing' };
    // quitAndInstall handles the quit-then-relaunch-installer dance itself
    // per platform (Windows: runs the NSIS installer and quits; macOS:
    // swaps the .app bundle; Linux: replaces the running AppImage in
    // place) -- unlike the old shell.openPath flow, there's no separate
    // "did the OS actually manage to open this file" failure mode to
    // report back, and no manual app.quit() needed alongside it.
    autoUpdater.quitAndInstall();
    return { ok: true };
  });
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
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

  mainWindow.once('ready-to-show', hideSplashThenShowMain);
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
    {
      label: 'Görünüm',
      submenu: [
        { role: 'reload' },
        // DevTools exposes the renderer's full JS console/network/storage
        // inspector -- fine for development, but a production install must
        // not hand every user a live debugger into an app that holds
        // decrypted session data in memory. Uses the same isDev gate as
        // the rest of this file's dev-only branches (main.js's update-check
        // skip, the production-only load-path branch).
        ...(isDev ? [{ role: 'toggleDevTools' }] : []),
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
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

  // AQ-002: sensitive analyses fields (title/content) are encrypted at rest
  // with a key protected by safeStorage -- see db/dbKey.js/fieldCrypto.js.
  // getOrCreateKey() returns null (encrypting nothing, matching pre-AQ-002
  // behavior) on a platform/config where safeStorage isn't available,
  // rather than falling back to an insecure hardcoded key.
  const dbKeyStore = createDbKeyStore(app.getPath('userData'), safeStorage);
  db = openDatabase(path.join(app.getPath('userData'), 'anatolia-q.db'), {
    onMigrations: (applied) => diagnostics.info('db_migrated', { applied: applied.length, files: applied }),
    encryptionKey: dbKeyStore.getOrCreateKey(),
  });
  // Points the local-llm provider's Model Manager at this install's real
  // userData dir instead of registry.js's ~/.anatolia-q fallback (which
  // only exists so that module stays importable/testable without
  // Electron). No network access happens here -- this only resolves a
  // path and checks for an already-downloaded file (spec point 9).
  configureLocalLLM({ modelsDir: path.join(app.getPath('userData'), 'models') });
  deviceId = getOrCreateDeviceId(app.getPath('userData'));
  const secureStore = createSecureStore(app.getPath('userData'), safeStorage);
  sessionManager = createSessionManager({
    db, secureStore, deviceId, apiBaseUrl: CLOUD_URL,
    platform: process.platform, appVersion: app.getVersion(),
  });

  // macOS keeps the app process alive after all windows close (see
  // window-all-closed below), which also tears this down -- 'activate'
  // (the dock-icon reopen) used to only recreate the window and left sync/
  // connectivity dead for the rest of that run, silently, until the app was
  // fully quit and relaunched. Wrapped in one function so both the initial
  // boot and every later reopen start it the same way.
  function startBackgroundServices() {
    connectivity = createConnectivityMonitor({ apiBaseUrl: CLOUD_URL });
    connectivity.onChange((state) => {
      diagnostics.info('connectivity_change', { state });
      mainWindow?.webContents.send('connectivity:change', state);
    });
    connectivity.start();
    // A reconnect (local -> cloud) triggers an immediate sync instead of
    // waiting for the next timer tick -- spec point 3: sync starts
    // automatically the moment connectivity returns, with no user action.
    // onReconnect() (not the raw onChange()) is required here: it only fires
    // on a genuine local->cloud transition, not on performSync()'s own
    // sync->cloud settling step at the end of every sync pass -- see
    // connectivity.js's onReconnect doc comment for the infinite-loop bug
    // this previously caused (the sync status badge flickering constantly).
    connectivity.onReconnect(() => performSync().catch(() => {}));

    performSync().catch(() => {});

    // Periodic background sync in addition to the reconnect-triggered one
    // above, so a long-lived idle session with a flaky-but-technically-online
    // connection still eventually reconciles.
    syncTimer = setInterval(() => performSync().catch(() => {}), 5 * 60 * 1000);
    syncTimer.unref?.();

    if (!isDev && app.isPackaged) {
      // Checked via this app's own server (server/src/routes/version.js's
      // /generic/* feed), never GitHub directly -- see configureAutoUpdater.
      // Only surfaces a banner for the renderer to show -- nothing downloads
      // until the user approves it via the update:approve IPC handler above.
      // Failure here (no releases published yet, machine offline, ...) is
      // never fatal -- the app just runs the version it already has.
      checkAndBroadcastUpdate().catch(() => {});
      updateTimer = setInterval(() => checkAndBroadcastUpdate().catch(() => {}), 5 * 60 * 1000);
      updateTimer.unref?.();
    }
  }

  function stopBackgroundServices() {
    if (syncTimer) clearInterval(syncTimer);
    if (updateTimer) clearInterval(updateTimer);
    syncTimer = null;
    updateTimer = null;
    connectivity?.stop();
    connectivity = null;
  }

  configureAutoUpdater();
  registerIpcHandlers();
  buildAppMenu();
  createSplashWindow();
  await createWindow();
  startBackgroundServices();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    // window-all-closed (macOS branch) stopped these -- restart them any
    // time we're reopening from that stopped state, not just on cold boot.
    if (!connectivity) startBackgroundServices();
  });

  app.on('window-all-closed', () => {
    stopBackgroundServices();
    if (process.platform !== 'darwin') app.quit();
  });
});
