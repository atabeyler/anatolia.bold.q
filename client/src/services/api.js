// Exposed so services/socket.js can point Socket.IO at the same origin as
// the REST calls above.
export function getSocketBaseUrl() {
  return '/';
}

// Every call targets the current page's own origin -- that origin is always
// the cloud server.
const API = '';

function baseFor() {
  return API;
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
    throw new Error(err.error || 'API hatası');
  }
  return res.json();
}

export const api = {
  loginRequest: (userCode, password) =>
    req('/api/auth/login-request', { method: 'POST', body: JSON.stringify({ userCode, password }) }),

  checkApproval: (token) => req(`/api/auth/check/${token}`),

  generateAnalysis: (category, title, prompt, quantumMode = false, documentContext = null, imageData = null, realTransactions = null) =>
    req('/api/analysis/generate', { method: 'POST', body: JSON.stringify({ category, title, prompt, quantumMode, documentContext, imageData, realTransactions }) }),

  scenarioDeepDive: (category, scenarioId, scenarioSummary) =>
    req('/api/analysis/scenario-deep-dive', { method: 'POST', body: JSON.stringify({ category, scenarioId, scenarioSummary }) }),

  // Without an image the reply arrives as a stream — onChunk is called for each piece.
  // With an image, or when the server returns JSON (e.g. the weather shortcut), it returns all at once.
  chatConsult: async (message, history, documentContext = null, imageData = null, onChunk = null) => {
    const headers = { 'Content-Type': 'application/json' };
    const jwt = getJWT();
    if (jwt) headers.Authorization = `Bearer ${jwt}`;

    const res = await fetch(API + '/api/analysis/chat', {
      method: 'POST',
      headers,
      body: JSON.stringify({ message, history, documentContext, imageData }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || 'API hatası');
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
    return { provider, content: full };
  },

  // AI-aware upload: image → returns base64, document → extracts text
  uploadForAI: async (file) => {
    const jwt = getJWT();
    const formData = new FormData();
    formData.append('file', file);
    const res = await fetch(API + '/api/analysis/upload', {
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
    const res = await fetch(API + '/api/files/upload', {
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
    const res = await fetch(API + '/api/analysis/upload', {
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

  weatherCurrent: (lat, lng) => req(`/api/weather/current?lat=${lat}&lng=${lng}`),

  emergencyCenter: (message, region) =>
    req('/api/emergency/center', { method: 'POST', body: JSON.stringify({ message, region }) }),

  emergencyUsers: (message) =>
    req('/api/emergency/users', { method: 'POST', body: JSON.stringify({ message }) }),

  emergencyRegion: (region, message) =>
    req('/api/emergency/region', { method: 'POST', body: JSON.stringify({ region, message }) }),

  historyList: () => req('/api/history/list'),
  activityFeed: () => req('/api/history/feed'),
  morningBriefToday: () => req('/api/history/morning-brief/today'),
  morningBriefRefresh: () => req('/api/history/morning-brief/refresh', { method: 'POST' }),
  morningBriefList: () => req('/api/history/morning-brief/list'),
  morningBriefByDate: (date) => req(`/api/history/morning-brief/date/${date}`),
  historyGet: (id) => req(`/api/history/${id}`),
  historyDownloadUrl: (id) => `${API}/api/history/${id}/download`,
  historyDownloadPdfUrl: (id) => `${API}/api/history/${id}/download-pdf`,

  voiceIntent: (transcript, context, actions) =>
    req('/api/voice/intent', { method: 'POST', body: JSON.stringify({ transcript, context, actions }) }),
};

export const adminApi = {
  listUsers: () => req('/api/auth/admin/users'),
  addUser: (userCode, password, nickname, isAdmin = false) =>
    req('/api/auth/admin/users', { method: 'POST', body: JSON.stringify({ userCode, password, nickname, isAdmin }) }),
  setBlocked: (userCode, blocked) =>
    req(`/api/auth/admin/users/${userCode}`, { method: 'PATCH', body: JSON.stringify({ blocked }) }),
  updateUser: (userCode, { nickname, password, isAdmin } = {}) =>
    req(`/api/auth/admin/users/${userCode}`, { method: 'PATCH', body: JSON.stringify({ nickname, password, isAdmin }) }),
  deleteUser: (userCode) =>
    req(`/api/auth/admin/users/${userCode}`, { method: 'DELETE' }),
  auditLog: () => req('/api/auth/admin/audit-log'),
};

export function setJWT(jwt) {
  if (jwt) localStorage.setItem('anatolia_jwt', jwt);
  else localStorage.removeItem('anatolia_jwt');
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
