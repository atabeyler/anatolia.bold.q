// On the web, the page's own origin *is* the cloud server (server/src/index.js
// serves the built SPA and the API from the same origin), so a same-origin
// relative fetch just works. Desktop (Electron) and mobile (Capacitor) load
// the built SPA from their own local origin instead -- a bundled static
// server for desktop, capacitor://localhost for Android -- so relative
// fetches there would hit nothing. Both bridges make the real deployed API
// origin discoverable; resolved on every call (not cached at module load)
// since window.anatoliaDesktop is only guaranteed to exist by the time
// preload.js has run, and Capacitor's platform check has no such ordering
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

function getJWT() { return localStorage.getItem('anatolia_jwt'); }

export function getToken() { return getJWT(); }

async function req(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  const jwt = getJWT();
  if (jwt) headers.Authorization = `Bearer ${jwt}`;

  const res = await fetch(baseFor(path) + path, { ...options, headers });
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
}

async function reqBlob(path) {
  const jwt = getJWT();
  const headers = jwt ? { Authorization: `Bearer ${jwt}` } : {};
  const res = await fetch(baseFor(path) + path, { headers });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || 'API hatası');
  }
  const filename = res.headers.get('Content-Disposition')?.match(/filename="([^"]+)"/)?.[1];
  return { blob: await res.blob(), filename };
}

export const api = {
  loginRequest: (userCode, password) =>
    req('/api/auth/login-request', { method: 'POST', body: JSON.stringify({ userCode, password }) }),

  checkApproval: (token) => req(`/api/auth/check/${token}`),

  generateAnalysis: (category, title, prompt, quantumMode = false, documentContext = null, imageData = null, realTransactions = null, realScenarios = null, realOptimization = null, lang = 'tr') =>
    req('/api/analysis/generate', { method: 'POST', body: JSON.stringify({ category, title, prompt, quantumMode, documentContext, imageData, realTransactions, realScenarios, realOptimization, lang }) }),

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
  // These endpoints require the Bearer token like any other API call, so a
  // plain window.open() (no Authorization header) gets a 401 instead of the
  // file -- fetch it ourselves and hand back a Blob the caller can download
  // or feed into the Web Share API.
  historyDownloadBlob: (id) => reqBlob(`/api/history/${id}/download`),
  historyDownloadPdfBlob: (id) => reqBlob(`/api/history/${id}/download-pdf`),

  voiceIntent: (transcript, context, actions) =>
    req('/api/voice/intent', { method: 'POST', body: JSON.stringify({ transcript, context, actions }) }),
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
  auditLog: () => req('/api/auth/admin/audit-log'),
};

// Dispatched whenever the JWT is written/cleared in this tab, so App.jsx can
// react to login/logout without polling getCurrentUser() on an interval
// (the 'storage' event alone only fires for *other* tabs, not this one).
export const AUTH_CHANGED_EVENT = 'anatoliaq:auth-changed';

export function setJWT(jwt) {
  if (jwt) localStorage.setItem('anatolia_jwt', jwt);
  else localStorage.removeItem('anatolia_jwt');
  window.dispatchEvent(new CustomEvent(AUTH_CHANGED_EVENT));
}

export function getCurrentUser() {
  const jwt = getJWT();
  if (!jwt) return null;
  try {
    const payload = JSON.parse(atob(jwt.split('.')[1]));
    if (payload.exp && Date.now() >= payload.exp * 1000) {
      setJWT(null);
      return null;
    }
    return payload;
  } catch { return null; }
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
