import { contextBridge, ipcRenderer } from 'electron';

// contextIsolation is on and nodeIntegration is off (see main.js) — this is
// the *only* surface the renderer (the ordinary client/ React app) gets
// into the main process. Every call is a thin ipcRenderer.invoke wrapper;
// there is no direct filesystem/Node/db access from renderer code.
contextBridge.exposeInMainWorld('anatoliaDesktop', {
  isDesktop: true,
  platform: process.platform,

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
