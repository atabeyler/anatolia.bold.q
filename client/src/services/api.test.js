import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getToken, setJWT, getCurrentUser, resolveCurrentUser, logoutRequest, api } from './api.js';

function fakeJwtWithPayload(payload) {
  const b64 = (obj) => btoa(JSON.stringify(obj)).replace(/=+$/, '');
  return `${b64({ alg: 'none' })}.${b64(payload)}.sig`;
}

describe('api.js session handling', () => {
  afterEach(() => {
    localStorage.clear();
    delete window.anatoliaDesktop;
    delete window.anatoliaMobile;
    vi.unstubAllGlobals();
  });

  describe('on the web (no native shell)', () => {
    it('getToken()/getCurrentUser() never read localStorage -- the session lives only in the httpOnly cookie', () => {
      localStorage.setItem('anatolia_jwt', fakeJwtWithPayload({ userCode: 'X', exp: Math.floor(Date.now() / 1000) + 3600 }));
      expect(getToken()).toBeNull();
      expect(getCurrentUser()).toBeNull();
    });

    it('setJWT() never writes to localStorage', () => {
      setJWT('some-token');
      expect(localStorage.getItem('anatolia_jwt')).toBeNull();
    });

    it('resolveCurrentUser() calls GET /api/auth/me and returns its payload', async () => {
      const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ userCode: 'U1', nickname: 'BOLD-001', isAdmin: false }) }));
      vi.stubGlobal('fetch', fetchMock);

      const user = await resolveCurrentUser();
      expect(user).toEqual({ userCode: 'U1', nickname: 'BOLD-001', isAdmin: false });
      expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/api/auth/me'), expect.objectContaining({ credentials: 'include' }));
    });

    it('resolveCurrentUser() returns null when the server says unauthenticated', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 401, json: async () => ({ error: 'Yetkisiz' }) })));
      expect(await resolveCurrentUser()).toBeNull();
    });

    it('logoutRequest() posts to /api/auth/logout and never throws even if it fails', async () => {
      const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ success: true }) }));
      vi.stubGlobal('fetch', fetchMock);
      await expect(logoutRequest()).resolves.toBeUndefined();
      expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/api/auth/logout'), expect.objectContaining({ method: 'POST' }));

      vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('network down'); }));
      await expect(logoutRequest()).resolves.toBeUndefined();
    });

    it('req() sends credentials: include so the session cookie rides along', async () => {
      const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ success: true }) }));
      vi.stubGlobal('fetch', fetchMock);
      await api.getAIStatus();
      expect(fetchMock).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ credentials: 'include' }));
      // No Authorization header -- getJWT() is null on web, nothing to attach.
      expect(fetchMock.mock.calls[0][1].headers.Authorization).toBeUndefined();
    });
  });

  describe('on desktop/mobile (native shell)', () => {
    beforeEach(() => {
      window.anatoliaDesktop = { cloudUrl: 'https://cloud.example.com' };
    });

    it('getToken()/getCurrentUser() read the JWT from localStorage, unchanged from before', () => {
      const token = fakeJwtWithPayload({ userCode: 'D1', nickname: 'BOLD-D1', exp: Math.floor(Date.now() / 1000) + 3600 });
      localStorage.setItem('anatolia_jwt', token);
      expect(getToken()).toBe(token);
      expect(getCurrentUser()).toMatchObject({ userCode: 'D1', nickname: 'BOLD-D1' });
    });

    it('setJWT() writes to localStorage', () => {
      setJWT('native-token');
      expect(localStorage.getItem('anatolia_jwt')).toBe('native-token');
      setJWT(null);
      expect(localStorage.getItem('anatolia_jwt')).toBeNull();
    });

    it('resolveCurrentUser() resolves synchronously from the stored JWT without a network call', async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
      localStorage.setItem('anatolia_jwt', fakeJwtWithPayload({ userCode: 'D2', exp: Math.floor(Date.now() / 1000) + 3600 }));

      const user = await resolveCurrentUser();
      expect(user).toMatchObject({ userCode: 'D2' });
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
});
