import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

const getLatestVersionInfoMock = vi.fn();
const fetchAssetBinaryMock = vi.fn();
const getLatestReleaseAssetsMock = vi.fn();
const findReleaseAssetByFilenameMock = vi.fn();
vi.mock('../services/releaseVersion.js', () => ({
  getLatestVersionInfo: (...args) => getLatestVersionInfoMock(...args),
  fetchAssetBinary: (...args) => fetchAssetBinaryMock(...args),
  getLatestReleaseAssets: (...args) => getLatestReleaseAssetsMock(...args),
  findReleaseAssetByFilename: (...args) => findReleaseAssetByFilenameMock(...args),
}));

const { default: versionRouter } = await import('./version.js');

function buildApp() {
  const app = express();
  app.use('/api/version', versionRouter);
  return app;
}

beforeEach(() => {
  getLatestVersionInfoMock.mockReset();
  fetchAssetBinaryMock.mockReset();
  getLatestReleaseAssetsMock.mockReset();
  findReleaseAssetByFilenameMock.mockReset();
});

function releaseInfo() {
  return {
    version: '2.1.140',
    publishedAt: '2026-08-14T00:00:00Z',
    notes: '',
    assets: {
      androidApk: { id: 1, url: 'https://github.com/x/ANATOLIA-Q-2.1.140.apk', name: 'ANATOLIA-Q-2.1.140.apk', size: 100 },
      desktopWin: { id: 2, url: 'https://github.com/x/ANATOLIA-Q-Setup-2.1.140.exe', name: 'ANATOLIA-Q-Setup-2.1.140.exe', size: 200 },
      desktopMac: { id: 3, url: 'https://github.com/x/ANATOLIA-Q-2.1.140.dmg', name: 'ANATOLIA-Q-2.1.140.dmg', size: 300 },
      desktopLinux: { id: 4, url: 'https://github.com/x/ANATOLIA-Q-2.1.140.AppImage', name: 'ANATOLIA-Q-2.1.140.AppImage', size: 400 },
    },
  };
}

describe('GET /api/version/latest', () => {
  const originalAppUrl = process.env.APP_URL;

  beforeEach(() => {
    process.env.APP_URL = 'https://app.example.com';
  });

  afterEach(() => {
    if (originalAppUrl === undefined) delete process.env.APP_URL; else process.env.APP_URL = originalAppUrl;
  });

  it('always rewrites asset URLs to this server, never the raw GitHub URL', async () => {
    getLatestVersionInfoMock.mockResolvedValue(releaseInfo());

    const res = await request(buildApp()).get('/api/version/latest');

    expect(res.status).toBe(200);
    expect(res.body.version).toBe('2.1.140');
    expect(res.body.assets.androidApk.url).toBe('https://app.example.com/api/version/download/android');
    expect(res.body.assets.desktopWin.url).toBe('https://app.example.com/api/version/download/windows');
    expect(res.body.assets.desktopMac.url).toBe('https://app.example.com/api/version/download/mac');
    expect(res.body.assets.desktopLinux.url).toBe('https://app.example.com/api/version/download/linux');
    // No asset URL response should ever mention github anywhere in the body.
    expect(JSON.stringify(res.body)).not.toContain('github');
    // Non-URL asset fields (name/size/sha256) are preserved.
    expect(res.body.assets.androidApk.name).toBe(releaseInfo().assets.androidApk.name);
  });

  it('defaults a schemeless APP_URL to https instead of producing a relative link', async () => {
    process.env.APP_URL = 'site--anatoliaboldq--6ftfc8q7458m.code.run/';
    getLatestVersionInfoMock.mockResolvedValue(releaseInfo());

    const res = await request(buildApp()).get('/api/version/latest');

    expect(res.body.assets.androidApk.url).toBe('https://site--anatoliaboldq--6ftfc8q7458m.code.run/api/version/download/android');
  });

  it('returns 502 without leaking the underlying error when the lookup fails', async () => {
    getLatestVersionInfoMock.mockRejectedValue(new Error('GitHub releases lookup failed (HTTP 403)'));

    const res = await request(buildApp()).get('/api/version/latest');

    expect(res.status).toBe(502);
    expect(res.body.error).toBeTruthy();
  });
});

describe('GET /api/version/download/:platform', () => {
  it('streams the asset bytes through this server instead of redirecting to GitHub', async () => {
    getLatestVersionInfoMock.mockResolvedValue(releaseInfo());
    fetchAssetBinaryMock.mockResolvedValue({
      headers: new Map([['content-length', '4']]),
      body: new Response(new Uint8Array([1, 2, 3, 4])).body,
    });

    const res = await request(buildApp()).get('/api/version/download/android');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/octet-stream');
    expect(res.headers.location).toBeUndefined();
    expect(fetchAssetBinaryMock).toHaveBeenCalledWith(1);
  });

  it('streams the windows installer bytes the same way', async () => {
    getLatestVersionInfoMock.mockResolvedValue(releaseInfo());
    fetchAssetBinaryMock.mockResolvedValue({
      headers: new Map([['content-length', '4']]),
      body: new Response(new Uint8Array([1, 2, 3, 4])).body,
    });

    const res = await request(buildApp()).get('/api/version/download/windows');

    expect(res.status).toBe(200);
    expect(fetchAssetBinaryMock).toHaveBeenCalledWith(2);
  });

  it('rejects an unknown platform', async () => {
    const res = await request(buildApp()).get('/api/version/download/ios');
    expect(res.status).toBe(404);
  });

  it('returns 502 without leaking the underlying error when the upstream fetch fails', async () => {
    getLatestVersionInfoMock.mockResolvedValue(releaseInfo());
    fetchAssetBinaryMock.mockRejectedValue(new Error('GitHub asset download failed (HTTP 403)'));

    const res = await request(buildApp()).get('/api/version/download/android');

    expect(res.status).toBe(502);
    expect(res.body.error).toBeTruthy();
  });
});

describe('GET /api/version/generic/:feedFile (electron-updater differential feed)', () => {
  const originalAppUrl = process.env.APP_URL;

  beforeEach(() => {
    process.env.APP_URL = 'https://app.example.com';
  });

  afterEach(() => {
    if (originalAppUrl === undefined) delete process.env.APP_URL; else process.env.APP_URL = originalAppUrl;
  });

  function rawAssets() {
    return [
      { id: 10, name: 'ANATOLIA-Q-Setup-2.1.140.exe', size: 200 },
      { id: 11, name: 'ANATOLIA-Q-Setup-2.1.140.exe.blockmap', size: 5 },
      { id: 12, name: 'latest.yml', size: 1 },
    ];
  }

  function ymlText() {
    return [
      'version: 2.1.140',
      'files:',
      '  - url: ANATOLIA-Q-Setup-2.1.140.exe',
      '    sha512: abc123',
      '    size: 200',
      'path: ANATOLIA-Q-Setup-2.1.140.exe',
      'sha512: abc123',
      'releaseDate: 2026-08-14T00:00:00.000Z',
      '',
    ].join('\n');
  }

  it('rewrites the files[].url and path fields to point at our own /generic/download, never GitHub', async () => {
    getLatestReleaseAssetsMock.mockResolvedValue(rawAssets());
    fetchAssetBinaryMock.mockResolvedValue({ text: async () => ymlText() });

    const res = await request(buildApp()).get('/api/version/generic/latest.yml');

    expect(res.status).toBe(200);
    expect(fetchAssetBinaryMock).toHaveBeenCalledWith(12);
    expect(res.text).not.toContain('github');
    expect(res.text).toContain('https://app.example.com/api/version/generic/download/ANATOLIA-Q-Setup-2.1.140.exe');
    // version/sha512 pass through untouched -- only the URL fields are rewritten.
    expect(res.text).toContain('version: 2.1.140');
    expect(res.text).toContain('sha512: abc123');
  });

  it('404s for a feed filename that is not one of the three electron-updater expects', async () => {
    const res = await request(buildApp()).get('/api/version/generic/some-other-file.yml');
    expect(res.status).toBe(404);
  });

  it('404s when the requested feed file was not published on the latest release', async () => {
    getLatestReleaseAssetsMock.mockResolvedValue(rawAssets().filter((a) => a.name !== 'latest.yml'));

    const res = await request(buildApp()).get('/api/version/generic/latest.yml');

    expect(res.status).toBe(404);
  });
});

describe('GET /api/version/generic/download/:filename (differential blockmap/installer proxy)', () => {
  it('forwards a Range header to the upstream fetch and relays a 206 partial response', async () => {
    findReleaseAssetByFilenameMock.mockResolvedValue({ id: 11, name: 'ANATOLIA-Q-Setup-2.1.140.exe.blockmap', size: 5 });
    fetchAssetBinaryMock.mockResolvedValue({
      status: 206,
      headers: new Map([['content-length', '2'], ['content-range', 'bytes 0-1/5']]),
      body: new Response(new Uint8Array([1, 2])).body,
    });

    const res = await request(buildApp())
      .get('/api/version/generic/download/ANATOLIA-Q-Setup-2.1.140.exe.blockmap')
      .set('Range', 'bytes=0-1');

    expect(res.status).toBe(206);
    expect(res.headers['content-range']).toBe('bytes 0-1/5');
    expect(res.headers['accept-ranges']).toBe('bytes');
    expect(fetchAssetBinaryMock).toHaveBeenCalledWith(11, 'bytes=0-1');
  });

  // The whole point of findReleaseAssetByFilename: a differential update
  // needs the *previous* version's blockmap/exe, which only exists in an
  // older GitHub release, not the latest one -- this route must be able to
  // find it there instead of only checking the newest release's assets.
  it('finds an asset that only exists in an older release (previous-version blockmap for a differential update)', async () => {
    findReleaseAssetByFilenameMock.mockResolvedValue({ id: 9, name: 'ANATOLIA-Q-Setup-2.1.139.exe.blockmap', size: 5 });
    fetchAssetBinaryMock.mockResolvedValue({
      status: 200,
      headers: new Map([['content-length', '5']]),
      body: new Response(new Uint8Array([1, 2, 3, 4, 5])).body,
    });

    const res = await request(buildApp()).get('/api/version/generic/download/ANATOLIA-Q-Setup-2.1.139.exe.blockmap');

    expect(res.status).toBe(200);
    expect(fetchAssetBinaryMock).toHaveBeenCalledWith(9, null);
  });

  it('404s for a filename that does not match any published asset across recent releases (no path traversal)', async () => {
    findReleaseAssetByFilenameMock.mockResolvedValue(null);

    const res = await request(buildApp()).get('/api/version/generic/download/..%2F..%2Fetc%2Fpasswd');

    expect(res.status).toBe(404);
    expect(findReleaseAssetByFilenameMock).toHaveBeenCalledWith('passwd');
  });
});
