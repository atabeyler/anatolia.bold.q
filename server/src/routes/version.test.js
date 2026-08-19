import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

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

function releaseInfo() {
  return {
    version: '2.1.140',
    publishedAt: '2026-08-14T00:00:00Z',
    notes: '',
    assets: {
      androidApk: { url: 'https://github.com/x/ANATOLIA-Q-2.1.140.apk', name: 'ANATOLIA-Q-2.1.140.apk', size: 100 },
      desktopWin: { url: 'https://github.com/x/ANATOLIA-Q-Setup-2.1.140.exe', name: 'ANATOLIA-Q-Setup-2.1.140.exe', size: 200 },
      desktopMac: { url: 'https://github.com/x/ANATOLIA-Q-2.1.140.dmg', name: 'ANATOLIA-Q-2.1.140.dmg', size: 300 },
      desktopLinux: { url: 'https://github.com/x/ANATOLIA-Q-2.1.140.AppImage', name: 'ANATOLIA-Q-2.1.140.AppImage', size: 400 },
    },
  };
}

describe('GET /api/version/latest', () => {
  it('returns canonical GitHub Release asset URLs with no auth required', async () => {
    getLatestVersionInfoMock.mockResolvedValue(releaseInfo());

    const res = await request(buildApp()).get('/api/version/latest');

    expect(res.status).toBe(200);
    expect(res.body.version).toBe('2.1.140');
    expect(res.body.assets.androidApk).toEqual(releaseInfo().assets.androidApk);
    expect(res.body.assets.desktopWin).toEqual(releaseInfo().assets.desktopWin);
    expect(res.body.assets.desktopMac).toEqual(releaseInfo().assets.desktopMac);
    expect(res.body.assets.desktopLinux).toEqual(releaseInfo().assets.desktopLinux);
    expect(res.body.assets.desktopWin.url).toContain('github.com');
  });

  it('returns 502 without leaking the underlying error when the lookup fails', async () => {
    getLatestVersionInfoMock.mockRejectedValue(new Error('GitHub releases lookup failed (HTTP 403)'));

    const res = await request(buildApp()).get('/api/version/latest');

    expect(res.status).toBe(502);
    expect(res.body.error).toBeTruthy();
  });
});

describe('GET /api/version/download/:platform', () => {
  it('redirects legacy download URLs to the canonical GitHub Release asset', async () => {
    getLatestVersionInfoMock.mockResolvedValue(releaseInfo());

    const res = await request(buildApp()).get('/api/version/download/android');

    expect(res.status).toBe(307);
    expect(res.headers.location).toBe('https://github.com/x/ANATOLIA-Q-2.1.140.apk');
  });

  it('redirects the legacy Windows download URL to the canonical installer', async () => {
    getLatestVersionInfoMock.mockResolvedValue(releaseInfo());

    const res = await request(buildApp()).get('/api/version/download/windows');

    expect(res.status).toBe(307);
    expect(res.headers.location).toBe('https://github.com/x/ANATOLIA-Q-Setup-2.1.140.exe');
  });

  it('rejects an unknown platform', async () => {
    const res = await request(buildApp()).get('/api/version/download/ios');
    expect(res.status).toBe(404);
  });
});
