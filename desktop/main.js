import { app, BrowserWindow, Menu, ipcMain, shell, safeStorage, session } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import electronUpdater from 'electron-updater';
const { autoUpdater } = electronUpdater;

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

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// The deployed web app is the source of truth this points at by default;
// override with ANATOLIA_CLOUD_URL for a self-hosted/staging server.
const CLOUD_URL = process.env.ANATOLIA_CLOUD_URL || 'https://anatolia-q.onrender.com';
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

function currentUserCode() {
  return sessionManager?.getSession()?.userCode || null;
}

async function performSync() {
  const session_ = sessionManager?.getSession();
  if (!session_ || !db) return;
  connectivity.markSyncing();
  const result = await runSync(db, {
    apiBaseUrl: CLOUD_URL,
    getToken: () => session_.jwt,
    deviceId,
    userId: session_.userCode,
  });
  await connectivity.checkOnce();
  mainWindow?.webContents.send('connectivity:change', connectivity.getState());
  return result;
}

function registerIpcHandlers() {
  ipcMain.handle('auth:establishOnlineSession', async (_e, jwt) => {
    const result = await sessionManager.establishOnlineSession(jwt);
    performSync().catch(() => {});
    return result;
  });
  ipcMain.handle('auth:getSession', () => sessionManager.getSession());
  ipcMain.handle('auth:isOfflineLoginAllowed', (_e, userCode) => sessionManager.isOfflineLoginAllowed(userCode));
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
    const row = createAnalysis(db, { userId, deviceId, ...data });
    performSync().catch(() => {});
    return row;
  });
  ipcMain.handle('analyses:update', (_e, id, data) => {
    const userId = currentUserCode();
    if (!userId) throw new Error('Oturum açılmamış');
    const row = updateAnalysis(db, { userId, deviceId, id, ...data });
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
    return createLocalAIProvider({ db, userId }).query(request);
  });

  ipcMain.handle('connectivity:getState', () => connectivity.getState());
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
    const { url } = await serveStaticDir(clientDist);
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
  });
  mainWindow.webContents.on('preload-error', (event, preloadPath, error) => {
    console.error(`[preload] error in ${preloadPath}:`, error);
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

  db = openDatabase(path.join(app.getPath('userData'), 'anatolia-q.db'));
  deviceId = getOrCreateDeviceId(app.getPath('userData'));
  const secureStore = createSecureStore(app.getPath('userData'), safeStorage);
  sessionManager = createSessionManager({
    db, secureStore, deviceId, apiBaseUrl: CLOUD_URL,
    platform: process.platform, appVersion: app.getVersion(),
  });

  connectivity = createConnectivityMonitor({ apiBaseUrl: CLOUD_URL });
  connectivity.onChange((state) => mainWindow?.webContents.send('connectivity:change', state));
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
    autoUpdater.checkForUpdatesAndNotify().catch(() => {
      // No publish feed configured yet (see package.json's build.publish) --
      // this is expected until a release channel exists, never fatal.
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
