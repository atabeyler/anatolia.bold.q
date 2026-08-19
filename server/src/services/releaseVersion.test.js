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
      { name: 'ANATOLIA-Q-2.1.140.dmg', browser_download_url: 'https://x/dmg', size: 300 },
      { name: 'ANATOLIA-Q-2.1.140.AppImage', browser_download_url: 'https://x/appimage', size: 400 },
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
  it('strips the leading v and picks the .apk/.exe/.dmg/.AppImage assets, ignoring blockmap/yml', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => [fakeRelease()] }));
    vi.stubGlobal('fetch', fetchMock);
    const { getLatestVersionInfo } = await import('./releaseVersion.js');

    const info = await getLatestVersionInfo();

    expect(info.version).toBe('2.1.140');
    expect(info.assets.androidApk).toEqual({ url: 'https://x/apk', name: 'ANATOLIA-Q-2.1.140.apk', size: 100 });
    expect(info.assets.desktopWin).toEqual({ url: 'https://x/exe', name: 'ANATOLIA-Q-Setup-2.1.140.exe', size: 200 });
    expect(info.assets.desktopMac).toEqual({ url: 'https://x/dmg', name: 'ANATOLIA-Q-2.1.140.dmg', size: 300 });
    expect(info.assets.desktopLinux).toEqual({ url: 'https://x/appimage', name: 'ANATOLIA-Q-2.1.140.AppImage', size: 400 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('fetches fresh release data on every call', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => [fakeRelease()] }));
    vi.stubGlobal('fetch', fetchMock);
    const { getLatestVersionInfo } = await import('./releaseVersion.js');

    await getLatestVersionInfo();
    await getLatestVersionInfo();

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('throws when the GitHub lookup itself fails', async () => {
    const fetchMock = vi.fn(async () => ({ ok: false, status: 403 }));
    vi.stubGlobal('fetch', fetchMock);
    const { getLatestVersionInfo } = await import('./releaseVersion.js');

    await expect(getLatestVersionInfo()).rejects.toThrow('HTTP 403');
  });

  it('skips drafts and uses the newest published release', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => [
        fakeRelease({ tag_name: 'v2.1.999', draft: true }),
        fakeRelease({ tag_name: 'v2.1.206', draft: false }),
      ],
    }));
    vi.stubGlobal('fetch', fetchMock);
    const { getLatestVersionInfo } = await import('./releaseVersion.js');

    const info = await getLatestVersionInfo();

    expect(info.version).toBe('2.1.206');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
