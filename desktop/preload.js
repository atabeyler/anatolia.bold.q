import { contextBridge, ipcRenderer } from 'electron';

// Same default/override as main.js's CLOUD_URL -- duplicated rather than
// imported because the preload script runs in its own isolated context
// (see contextIsolation below) and doesn't share module state with main.js.
const CLOUD_URL = process.env.ANATOLIA_CLOUD_URL || 'https://anatolia-q.onrender.com';

// contextIsolation is on and nodeIntegration is off (see main.js) — this is
// the *only* surface the renderer (the ordinary client/ React app) gets
// into the main process. Every call is a thin ipcRenderer.invoke wrapper;
// there is no direct filesystem/Node/db access from renderer code.
contextBridge.exposeInMainWorld('anatoliaDesktop', {
  isDesktop: true,
  platform: process.platform,
  // The window loads client/dist from a local static server (see
  // staticServer.js), not the real backend origin -- api.js reads this to
  // know where actual /api/* calls need to go instead of a same-origin
  // relative fetch that would hit nothing.
  cloudUrl: CLOUD_URL,

  auth: {
    establishOnlineSession: (jwt, password) => ipcRenderer.invoke('auth:establishOnlineSession', jwt, password),
    verifyOfflineLogin: (userCode, password) => ipcRenderer.invoke('auth:verifyOfflineLogin', userCode, password),
    getSession: () => ipcRenderer.invoke('auth:getSession'),
    isOfflineLoginAllowed: (userCode) => ipcRenderer.invoke('auth:isOfflineLoginAllowed', userCode),
    logout: () => ipcRenderer.invoke('auth:logout'),
  },

  analyses: {
    list: () => ipcRenderer.invoke('analyses:list'),
    get: (id) => ipcRenderer.invoke('analyses:get', id),
    create: (data) => ipcRenderer.invoke('analyses:create', data),
    update: (id, data) => ipcRenderer.invoke('analyses:update', id, data),
    remove: (id) => ipcRenderer.invoke('analyses:remove', id),
  },

  sync: {
    status: () => ipcRenderer.invoke('sync:status'),
    forceSync: () => ipcRenderer.invoke('sync:forceSync'),
    listConflicts: () => ipcRenderer.invoke('sync:listConflicts'),
    resolveConflict: (conflictId, resolution) => ipcRenderer.invoke('sync:resolveConflict', conflictId, resolution),
  },

  ai: {
    query: (request) => ipcRenderer.invoke('ai:query', request),
  },

  connectivity: {
    getState: () => ipcRenderer.invoke('connectivity:getState'),
    onChange: (callback) => {
      const listener = (_event, state) => callback(state);
      ipcRenderer.on('connectivity:change', listener);
      return () => ipcRenderer.removeListener('connectivity:change', listener);
    },
  },
});
