import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

function fakeRelease(overrides = {}) {
  return {
    tag_name: 'v2.1.140',
    published_at: '2026-08-14T00:00:00Z',
    body: 'Some notes',
    assets: [
      { name: 'ANATOLIA-Q-2.1.140.apk', browser_download_url: 'https://x/apk', size: 100 },
      { name: 'ANATOLIA-Q-Setup-2.1.140.exe', browser_download_url: 'https://x/exe', size: 200 },
      { name: 'ANATOLIA-Q-Setup-2.1.140.exe.blockmap', browser_download_url: 'https://x/blockmap', size: 5 },
      { name: 'latest.yml', browser_download_url: 'https://x/yml', size: 1 },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('getLatestVersionInfo', () => {
  it('strips the leading v and picks the .apk/.exe assets, ignoring blockmap/yml', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => fakeRelease() }));
    vi.stubGlobal('fetch', fetchMock);
    const { getLatestVersionInfo } = await import('./releaseVersion.js');

    const info = await getLatestVersionInfo();

    expect(info.version).toBe('2.1.140');
    expect(info.assets.androidApk).toEqual({ url: 'https://x/apk', name: 'ANATOLIA-Q-2.1.140.apk', size: 100 });
    expect(info.assets.desktopExe).toEqual({ url: 'https://x/exe', name: 'ANATOLIA-Q-Setup-2.1.140.exe', size: 200 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('caches the result and does not re-fetch within the TTL', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => fakeRelease() }));
    vi.stubGlobal('fetch', fetchMock);
    const { getLatestVersionInfo } = await import('./releaseVersion.js');

    await getLatestVersionInfo();
    await getLatestVersionInfo();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('throws when the GitHub lookup itself fails', async () => {
    const fetchMock = vi.fn(async () => ({ ok: false, status: 403 }));
    vi.stubGlobal('fetch', fetchMock);
    const { getLatestVersionInfo } = await import('./releaseVersion.js');

    await expect(getLatestVersionInfo()).rejects.toThrow('HTTP 403');
  });
});
