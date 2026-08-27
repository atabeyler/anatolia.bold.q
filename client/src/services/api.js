// On the web, the page's own origin *is* the cloud server (server/src/index.js
// serves the built SPA and the API from the same origin), so a same-origin
// relative fetch just works. Desktop (Electron) and mobile (Capacitor) load
// the built SPA from their own local origin instead -- a bundled static
// server for desktop, capacitor://localhost for Android -- so relative
// fetches there would hit nothing. Both bridges make the real deployed API
// origin discoverable; resolved on every call (not cached at module load)
// since window.anatoliaDesktop is only guaranteed to exist by the time
// preload.cjs has run, and Capacitor's platform check has no such ordering
// concern but is equally cheap.
function baseFor() {
  if (typeof window !== 'undefined' && window.anatoliaDesktop?.cloudUrl) {
    return window.anatoliaDesktop.cloudUrl;
  }
  if (typeof window !== 'undefined' && window.anatoliaMobile?.cloudUrl) {
    return window.anatoliaMobile.cloudUrl;
  }
  return '';
}

export function getSocketBaseUrl() {
  return baseFor() || '/';
}

// Desktop (Electron) and mobile (Capacitor) call the deployed API from a
// different origin than the one serving the app shell (see baseFor() above)
// -- an httpOnly cookie set by that API origin would never reach them, so
// they keep authenticating with an explicit Authorization header, sourced
// from a JWT they store in localStorage themselves (unchanged from before).
// The web build, served from the SAME origin as the API, no longer stores
// or reads a JWT at all: the server sets it as an httpOnly session cookie
// on login (routes/auth.js), the browser attaches it to same-origin
// requests automatically, and JS on the page can never read it -- closing
// off the XSS token-theft vector localStorage left open.
function isNativeShell() {
  return typeof window !== 'undefined' && !!(window.anatoliaDesktop || window.anatoliaMobile);
}

function getJWT() { return isNativeShell() ? localStorage.getItem('anatolia_jwt') : null; }

export function getToken() { return getJWT(); }

// `timeoutMs` is opt-in per call (only loginRequest sets it below) --
// without it a plain fetch() has no ceiling and stays exactly as it was for
// every other call, including long-running cloud analysis generation. It
// exists because a native device with no network doesn't always reject
// fetch() promptly: depending on Android's radio/DNS state, an unreachable
// origin can hang far longer than a user will wait before giving up,
// leaving the login button spinning with neither a result nor an error --
// and, critically, never reaching the offline-login fallback in
// LoginPage.jsx, which only runs once this call's promise actually
// rejects. AbortController turns that open-ended hang into a deterministic
// rejection so the offline path is reached every time, not just when the
// network happens to fail fast.
async function req(path, options = {}) {
  const { timeoutMs, ...fetchOptions } = options;
  const headers = { 'Content-Type': 'application/json', ...(fetchOptions.headers || {}) };
  const jwt = getJWT();
  if (jwt) headers.Authorization = `Bearer ${jwt}`;

  const controller = timeoutMs ? new AbortController() : null;
  const timeoutId = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const res = await fetch(baseFor(path) + path, {
      ...fetchOptions, headers, credentials: 'include',
      ...(controller ? { signal: controller.signal } : {}),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      const e = new Error(err.error || 'API hatası');
      // Some server errors carry a machine-readable code (e.g.
      // ALL_AI_PROVIDERS_FAILED) so UI code can show a localized message
      // instead of the raw server-side (Turkish-only) error text.
      if (err.code) e.code = err.code;
      throw e;
    }
    return res.json();
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

async function reqBlob(path) {
  const jwt = getJWT();
  const headers = jwt ? { Authorization: `Bearer ${jwt}` } : {};
  const res = await fetch(baseFor(path) + path, { headers, credentials: 'include' });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || 'API hatası');
  }
  const filename = res.headers.get('Content-Disposition')?.match(/filename="([^"]+)"/)?.[1];
  return { blob: await res.blob(), filename };
}

export const api = {
  // 25s, not a snappier few seconds: this endpoint's own bcrypt.compare()
  // has been observed taking 7-12s under real server load, and a timeout
  // that fires while a normal online login is still legitimately in
  // flight is worse than one that waits a bit longer -- it wrongly routes
  // an online device into the offline-login fallback (see LoginPage.jsx),
  // which then fails for a device that was never meant to need it.
  loginRequest: (userCode, password) =>
    req('/api/auth/login-request', { method: 'POST', body: JSON.stringify({ userCode, password }), timeoutMs: 25000 }),

  checkApproval: (token) => req(`/api/auth/check/${token}`),

  me: () => req('/api/auth/me'),

  logout: () => req('/api/auth/logout', { method: 'POST' }),

  // Passkey/WebAuthn -- see server/src/routes/webauthn.js. Registration
  // requires an existing authenticated session (added from the Security
  // settings tab); login is the unauthenticated alternative to
  // loginRequest()/checkApproval() above.
  webauthn: {
    registerOptions: () => req('/api/webauthn/register/options', { method: 'POST', body: JSON.stringify({}) }),
    registerVerify: (response, deviceName) =>
      req('/api/webauthn/register/verify', { method: 'POST', body: JSON.stringify({ response, deviceName }) }),
    listCredentials: () => req('/api/webauthn/credentials'),
    renameCredential: (id, deviceName) =>
      req(`/api/webauthn/credentials/${id}`, { method: 'PATCH', body: JSON.stringify({ deviceName }) }),
    removeCredential: (id) => req(`/api/webauthn/credentials/${id}`, { method: 'DELETE' }),
    loginOptions: (userCode) => req('/api/webauthn/login/options', { method: 'POST', body: JSON.stringify({ userCode }) }),
    loginVerify: (userCode, response) =>
      req('/api/webauthn/login/verify', { method: 'POST', body: JSON.stringify({ userCode, response }) }),
  },

  generateAnalysis: (category, title, prompt, quantumMode = false, documentContext = null, imageData = null, realTransactions = null, realScenarios = null, realOptimization = null, lang = 'tr', priority = 'normal', depth = 'standart') =>
    req('/api/analysis/generate', { method: 'POST', body: JSON.stringify({ category, title, prompt, quantumMode, documentContext, imageData, realTransactions, realScenarios, realOptimization, lang, priority, depth }) }),

  scenarioDeepDive: (category, scenarioId, scenarioSummary, lang = 'tr') =>
    req('/api/analysis/scenario-deep-dive', { method: 'POST', body: JSON.stringify({ category, scenarioId, scenarioSummary, lang }) }),

  // Without an image the reply arrives as a stream — onChunk is called for each piece.
  // With an image, or when the server returns JSON (e.g. the weather shortcut), it returns all at once.
  chatConsult: async (message, history, documentContext = null, imageData = null, onChunk = null) => {
    const headers = { 'Content-Type': 'application/json' };
    const jwt = getJWT();
    if (jwt) headers.Authorization = `Bearer ${jwt}`;

    const res = await fetch(baseFor() + '/api/analysis/chat', {
      method: 'POST',
      headers,
      credentials: 'include',
      body: JSON.stringify({ message, history, documentContext, imageData }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      const e = new Error(err.error || 'API hatası');
      if (err.code) e.code = err.code;
      throw e;
    }

    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      return res.json();
    }

    const provider = decodeURIComponent(res.headers.get('x-ai-provider') || '');
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let full = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      full += chunk;
      onChunk?.(chunk, full);
    }
    // Flush any pending partial multi-byte UTF-8 sequence left in the
    // decoder (e.g. a Turkish character split across a stream boundary) --
    // without this, a trailing byte can be silently dropped.
    const tail = decoder.decode();
    if (tail) {
      full += tail;
      onChunk?.(tail, full);
    }
    return { provider, content: full };
  },

  // AI-aware upload: image → returns base64, document → extracts text
  uploadForAI: async (file) => {
    const jwt = getJWT();
    const formData = new FormData();
    formData.append('file', file);
    const res = await fetch(baseFor() + '/api/analysis/upload', {
      method: 'POST',
      headers: jwt ? { Authorization: `Bearer ${jwt}` } : {},
      credentials: 'include',
      body: formData,
    });
    if (!res.ok) {
      const e = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(e.error || 'Yükleme hatası');
    }
    return res.json(); // { type: 'text'|'image', text?, base64?, mimetype?, filename }
  },

  uploadFile: async (file) => {
    const jwt = getJWT();
    const formData = new FormData();
    formData.append('file', file);
    const res = await fetch(baseFor() + '/api/files/upload', {
      method: 'POST',
      headers: jwt ? { Authorization: `Bearer ${jwt}` } : {},
      credentials: 'include',
      body: formData,
    });
    if (!res.ok) {
      const e = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(e.error || 'Yükleme hatası');
    }
    return res.json(); // { url, filename, mimetype, size }
  },

  uploadDocument: async (file) => {
    const jwt = getJWT();
    const formData = new FormData();
    formData.append('file', file);
    const res = await fetch(baseFor() + '/api/analysis/upload', {
      method: 'POST',
      headers: jwt ? { Authorization: `Bearer ${jwt}` } : {},
      credentials: 'include',
      body: formData,
    });
    if (!res.ok) {
      const e = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(e.error || 'Yükleme hatası');
    }
    const data = await res.json();
    return data.text;
  },

  getAIStatus: () => req('/api/analysis/status'),

  fraudTrend: (category = null) => req(`/api/analysis/fraud-trend${category ? `?category=${category}` : ''}`),

  weatherCurrent: (lat, lng) => req(`/api/weather/current?lat=${lat}&lng=${lng}`),

  emergencyCenter: (message, region) =>
    req('/api/emergency/center', { method: 'POST', body: JSON.stringify({ message, region }) }),

  emergencyUsers: (message) =>
    req('/api/emergency/users', { method: 'POST', body: JSON.stringify({ message }) }),

  emergencyRegion: (region, message) =>
    req('/api/emergency/region', { method: 'POST', body: JSON.stringify({ region, message }) }),

  pushVapidPublicKey: () => req('/api/emergency/push/vapid-public-key'),
  pushSubscribe: (subscription) => req('/api/emergency/push/subscribe', { method: 'POST', body: JSON.stringify({ subscription }) }),
  pushUnsubscribe: (endpoint) => req('/api/emergency/push/unsubscribe', { method: 'POST', body: JSON.stringify({ endpoint }) }),

  historyList: () => req('/api/history/list'),
  activityFeed: () => req('/api/history/feed'),
  morningBriefToday: () => req('/api/history/morning-brief/today'),
  morningBriefRefresh: () => req('/api/history/morning-brief/refresh', { method: 'POST' }),
  morningBriefList: () => req('/api/history/morning-brief/list'),
  morningBriefByDate: (date) => req(`/api/history/morning-brief/date/${date}`),
  historyGet: (id) => req(`/api/history/${id}`),
  historyDelete: (id) => req(`/api/history/${id}`, { method: 'DELETE' }),
  // These endpoints require the Bearer token like any other API call, so a
  // plain window.open() (no Authorization header) gets a 401 instead of the
  // file -- fetch it ourselves and hand back a Blob the caller can download
  // or feed into the Web Share API.
  historyDownloadBlob: (id) => reqBlob(`/api/history/${id}/download`),
  historyDownloadPdfBlob: (id) => reqBlob(`/api/history/${id}/download-pdf`),

  // voiceIntent (POST /api/voice/intent) intentionally removed here: voice
  // command interpretation is now a fully local, deterministic engine (see
  // voiceAssistantEngine.js) with no AI/network call in that path. The
  // server route itself is left in place, unused -- see the comment on it.
};

export const adminApi = {
  listUsers: () => req('/api/auth/admin/users'),
  addUser: (userCode, password, nickname, isAdmin = false, email = '') =>
    req('/api/auth/admin/users', { method: 'POST', body: JSON.stringify({ userCode, password, nickname, isAdmin, email }) }),
  setBlocked: (userCode, blocked) =>
    req(`/api/auth/admin/users/${userCode}`, { method: 'PATCH', body: JSON.stringify({ blocked }) }),
  updateUser: (userCode, { nickname, password, isAdmin, email } = {}) =>
    req(`/api/auth/admin/users/${userCode}`, { method: 'PATCH', body: JSON.stringify({ nickname, password, isAdmin, email }) }),
  deleteUser: (userCode) =>
    req(`/api/auth/admin/users/${userCode}`, { method: 'DELETE' }),
  renameUser: (userCode, newUserCode) =>
    req(`/api/auth/admin/users/${userCode}/rename`, { method: 'POST', body: JSON.stringify({ newUserCode }) }),
  auditLog: () => req('/api/auth/admin/audit-log'),
};

// Dispatched whenever the JWT is written/cleared in this tab, so App.jsx can
// react to login/logout without polling getCurrentUser() on an interval
// (the 'storage' event alone only fires for *other* tabs, not this one, and
// only when localStorage is actually written -- which the web build never
// does, see below).
export const AUTH_CHANGED_EVENT = 'anatoliaq:auth-changed';

// Cross-tab login/logout sync on the web build: it authenticates via an
// httpOnly cookie, so it never writes anatolia_jwt to localStorage and the
// 'storage' event (App.jsx's other cross-tab signal, still needed for
// native) never fires for it. BroadcastChannel is same-origin-only same as
// 'storage' would be, and every browser this app targets supports it.
const AUTH_BROADCAST_CHANNEL = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('anatoliaq-auth') : null;

export function setJWT(jwt) {
  if (isNativeShell()) {
    if (jwt) localStorage.setItem('anatolia_jwt', jwt);
    else localStorage.removeItem('anatolia_jwt');
  }
  // Web has nothing to store here -- routes/auth.js already set/cleared the
  // httpOnly cookie as part of the login/logout request itself.
  window.dispatchEvent(new CustomEvent(AUTH_CHANGED_EVENT));
  AUTH_BROADCAST_CHANNEL?.postMessage('changed');
}

// ConsultChat.jsx persists its message history under this key so a
// consultation survives a reload/relaunch -- but on a shared/kiosk device
// that history must not carry over to the next person who logs in, so
// every logout path clears it (see DashboardPage.jsx's logout()/onBlocked).
// Duplicated literal rather than imported from ConsultChat.jsx to avoid
// pulling a React component into this module.
const CONSULT_HISTORY_KEY = 'aq_consult_history';

export function clearLocalChatHistory() {
  try { localStorage.removeItem(CONSULT_HISTORY_KEY); } catch { /* best-effort */ }
}

// Clears the session server-side (the cookie for web; harmless no-op call
// for native, which clears its own localStorage JWT via setJWT(null)).
export async function logoutRequest() {
  try { await api.logout(); } catch { /* best-effort -- setJWT(null)/disconnect still run */ }
}

// JWT payload segments are base64url (RFC 4648 §5: '-'/'_', no padding),
// not plain base64 -- atob() throws (or on some engines silently mangles
// the input) on the '-'/'_' characters a token's payload commonly contains,
// which was surfacing as a false "invalid session" logout on native shells.
function base64UrlDecode(input) {
  let base64 = input.replace(/-/g, '+').replace(/_/g, '/');
  const pad = base64.length % 4;
  if (pad) base64 += '='.repeat(4 - pad);
  return atob(base64);
}

// Synchronous, native-shell only: decodes the JWT desktop/mobile store
// themselves. Returns null on web -- there's no JWT there to decode (see
// getJWT()); use resolveCurrentUser() for the web path.
export function getCurrentUser() {
  const jwt = getJWT();
  if (!jwt) return null;
  try {
    const payload = JSON.parse(base64UrlDecode(jwt.split('.')[1]));
    if (payload.exp && Date.now() >= payload.exp * 1000) {
      setJWT(null);
      return null;
    }
    return payload;
  } catch { return null; }
}

// Async, works on every platform: native resolves immediately from the
// already-decoded local JWT (no network round trip needed there), web asks
// the server who the httpOnly cookie belongs to. Used for the app's initial
// bootstrap, where synchronous getCurrentUser() alone can't tell a logged-
// out web visitor apart from one whose session the server hasn't confirmed
// yet.
export async function resolveCurrentUser() {
  if (isNativeShell()) return getCurrentUser();
  try {
    return await api.me();
  } catch {
    return null;
  }
}

export const memoryApi = {
  getProfile: () => req('/api/memory/profile'),
  updateProfile: (data) => req('/api/memory/profile', { method: 'PUT', body: JSON.stringify(data) }),
  saveConversation: (history, personaId, sessionTitle) =>
    req('/api/memory/save-conversation', { method: 'POST', body: JSON.stringify({ history, personaId, sessionTitle }) }),
  getConversations: () => req('/api/memory/conversations'),
  getConversation: (id) => req(`/api/memory/conversations/${id}`),
  archiveConversation: (id, archived) =>
    req(`/api/memory/conversations/${id}/archive`, { method: 'PATCH', body: JSON.stringify({ archived }) }),
  deleteConversation: (id) =>
    req(`/api/memory/conversations/${id}`, { method: 'DELETE' }),
  getContext: () => req('/api/memory/context'),
};
