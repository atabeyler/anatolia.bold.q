export const isDesktop = typeof window !== 'undefined' && !!window.anatoliaDesktop;
const bridge = isDesktop ? window.anatoliaDesktop : null;

export const desktopAuth = {
  establishOnlineSession: (...args) => bridge?.auth.establishOnlineSession(...args),
  getSession: () => bridge?.auth.getSession(),
  isOfflineLoginAllowed: (userCode) => bridge?.auth.isOfflineLoginAllowed(userCode),
  verifyOfflineLogin: (...args) => bridge?.auth.verifyOfflineLogin(...args),
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
export const desktopAI = { query: (request) => bridge?.ai.query(request) };
export const desktopConnectivity = {
  getState: () => bridge?.connectivity.getState(),
  onChange: (callback) => bridge?.connectivity.onChange(callback) || (() => {}),
};
