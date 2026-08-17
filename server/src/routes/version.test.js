import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { Readable } from 'node:stream';

const getLatestVersionInfoMock = vi.fn();
vi.mock('../services/releaseVersion.js', () => ({ getLatestVersionInfo: (...args) => getLatestVersionInfoMock(...args) }));

const { default: versionRouter } = await import('./version.js');

function buildApp() {
  const app = express();
  app.use('/api/version', versionRouter);
  return app;
}

beforeEach(() => {
  getLatestVersionInfoMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('GET /api/version/latest', () => {
  it('returns our own /download proxy URLs, never a github.com address, with no auth required', async () => {
    getLatestVersionInfoMock.mockResolvedValue({
      version: '2.1.140',
      publishedAt: '2026-08-14T00:00:00Z',
      notes: '',
      assets: {
        androidApk: { url: 'https://github.com/x/apk', name: 'ANATOLIA-Q-2.1.140.apk', size: 100 },
        desktopWin: { url: 'https://github.com/x/exe', name: 'ANATOLIA-Q-Setup-2.1.140.exe', size: 200 },
        desktopMac: { url: 'https://github.com/x/dmg', name: 'ANATOLIA-Q-2.1.140.dmg', size: 300 },
        desktopLinux: { url: 'https://github.com/x/appimage', name: 'ANATOLIA-Q-2.1.140.AppImage', size: 400 },
      },
    });

    const res = await request(buildApp()).get('/api/version/latest');

    expect(res.status).toBe(200);
    expect(res.body.version).toBe('2.1.140');
    expect(res.body.assets.androidApk).toEqual({
      url: expect.stringMatching(/\/api\/version\/download\/android$/), name: 'ANATOLIA-Q-2.1.140.apk', size: 100,
    });
    expect(res.body.assets.desktopWin).toEqual({
      url: expect.stringMatching(/\/api\/version\/download\/windows$/), name: 'ANATOLIA-Q-Setup-2.1.140.exe', size: 200,
    });
    expect(res.body.assets.desktopMac).toEqual({
      url: expect.stringMatching(/\/api\/version\/download\/mac$/), name: 'ANATOLIA-Q-2.1.140.dmg', size: 300,
    });
    expect(res.body.assets.desktopLinux).toEqual({
      url: expect.stringMatching(/\/api\/version\/download\/linux$/), name: 'ANATOLIA-Q-2.1.140.AppImage', size: 400,
    });
    expect(res.body.assets.androidApk.url).not.toContain('github.com');
    expect(res.body.assets.desktopWin.url).not.toContain('github.com');
  });

  it('returns 502 without leaking the underlying error when the lookup fails', async () => {
    getLatestVersionInfoMock.mockRejectedValue(new Error('GitHub releases lookup failed (HTTP 403)'));

    const res = await request(buildApp()).get('/api/version/latest');

    expect(res.status).toBe(502);
    expect(res.body.error).toBeTruthy();
  });
});

describe('GET /api/version/download/:platform', () => {
  function releaseInfo() {
    return {
      version: '2.1.140',
      assets: {
        androidApk: { url: 'https://github.com/x/ANATOLIA-Q-2.1.140.apk', name: 'ANATOLIA-Q-2.1.140.apk', size: 4 },
        desktopWin: { url: 'https://github.com/x/ANATOLIA-Q-Setup-2.1.140.exe', name: 'ANATOLIA-Q-Setup-2.1.140.exe', size: 4 },
      },
    };
  }

  it('streams the upstream asset bytes through this server with the right headers', async () => {
    getLatestVersionInfoMock.mockResolvedValue(releaseInfo());
    const fetchMock = vi.fn(async () => ({
      ok: true,
      body: Readable.toWeb(Readable.from([Buffer.from('data')])),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const res = await request(buildApp()).get('/api/version/download/android').buffer(true);

    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toContain('ANATOLIA-Q-2.1.140.apk');
    expect(Buffer.from(res.body).toString()).toBe('data');
    expect(fetchMock).toHaveBeenCalledWith('https://github.com/x/ANATOLIA-Q-2.1.140.apk');
  });

  it('rejects an unknown platform', async () => {
    const res = await request(buildApp()).get('/api/version/download/ios');
    expect(res.status).toBe(404);
  });

  it('returns 502 when the upstream fetch fails', async () => {
    getLatestVersionInfoMock.mockResolvedValue(releaseInfo());
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, body: null })));

    const res = await request(buildApp()).get('/api/version/download/windows');
    expect(res.status).toBe(502);
  });
});
