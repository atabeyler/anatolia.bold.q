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

describe('GET /api/version/latest', () => {
  it('returns the release info with no auth required', async () => {
    getLatestVersionInfoMock.mockResolvedValue({
      version: '2.1.140',
      publishedAt: '2026-08-14T00:00:00Z',
      notes: '',
      assets: { androidApk: { url: 'https://x/apk', size: 1 }, desktopExe: { url: 'https://x/exe', size: 2 } },
    });

    const res = await request(buildApp()).get('/api/version/latest');

    expect(res.status).toBe(200);
    expect(res.body.version).toBe('2.1.140');
    expect(res.body.assets.androidApk.url).toBe('https://x/apk');
  });

  it('returns 502 without leaking the underlying error when the lookup fails', async () => {
    getLatestVersionInfoMock.mockRejectedValue(new Error('GitHub releases lookup failed (HTTP 403)'));

    const res = await request(buildApp()).get('/api/version/latest');

    expect(res.status).toBe(502);
    expect(res.body.error).toBeTruthy();
  });
});
