// Bridges the renderer to the Electron desktop shell's preload API
// (desktop/preload.cjs's contextBridge surface). On the web build
// `window.anatoliaDesktop` is simply undefined, so `isDesktop` is false and
// every export here is inert — nothing about the web app's behavior
// changes by importing this module.
export const isDesktop = typeof window !== 'undefined' && !!window.anatoliaDesktop;

const bridge = isDesktop ? window.anatoliaDesktop : null;

export const desktopAuth = {
  establishOnlineSession: (jwt, password) => bridge?.auth.establishOnlineSession(jwt, password),
  verifyOfflineLogin: (userCode, password) => bridge?.auth.verifyOfflineLogin(userCode, password),
  getSession: () => bridge?.auth.getSession(),
  isOfflineLoginAllowed: (userCode) => bridge?.auth.isOfflineLoginAllowed(userCode),
  needsReauth: () => bridge?.auth.needsReauth(),
  onReauthRequired: (callback) => bridge?.auth.onReauthRequired(callback) || (() => {}),
  logout: () => bridge?.auth.logout(),
};

export const desktopAnalyses = {
  list: () => bridge?.analyses.list(),
  get: (id) => bridge?.analyses.get(id),
  create: (data) => bridge?.analyses.create(data),
  update: (id, data) => bridge?.analyses.update(id, data),
  remove: (id) => bridge?.analyses.remove(id),
};

export const desktopSync = {
  status: () => bridge?.sync.status(),
  forceSync: () => bridge?.sync.forceSync(),
  listConflicts: () => bridge?.sync.listConflicts(),
  resolveConflict: (conflictId, resolution) => bridge?.sync.resolveConflict(conflictId, resolution),
};

export const desktopAI = {
  query: (request) => bridge?.ai.query(request),
  // Model Manager surface (task: Local Model Manager) -- wired into
  // Settings > Local AI, see components/LocalAIPanel.jsx.
  modelStatus: () => bridge?.ai.modelStatus(),
  modelDownload: () => bridge?.ai.modelDownload(),
  modelRemove: () => bridge?.ai.modelRemove(),
  onModelDownloadProgress: (callback) => bridge?.ai.onModelDownloadProgress(callback) || (() => {}),
};

export const desktopConnectivity = {
  getState: () => bridge?.connectivity.getState(),
  onChange: (callback) => bridge?.connectivity.onChange(callback) || (() => {}),
};

export const desktopUpdate = {
  onAvailable: (callback) => bridge?.update.onAvailable(callback) || (() => {}),
  onProgress: (callback) => bridge?.update.onProgress(callback) || (() => {}),
  getAvailable: () => bridge?.update.getAvailable?.(),
  approve: () => bridge?.update.approve(),
  install: () => bridge?.update.install(),
};
