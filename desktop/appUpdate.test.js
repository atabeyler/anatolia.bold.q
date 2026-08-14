import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { checkForUpdate, downloadUpdate, _internal } from './appUpdate.js';

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'aq-update-'));
}

describe('isNewer', () => {
  it('compares semver-ish dotted versions numerically, not lexically', () => {
    expect(_internal.isNewer('2.1.140', '2.1.139')).toBe(true);
    expect(_internal.isNewer('2.1.9', '2.1.10')).toBe(false); // lexical compare would get this wrong
    expect(_internal.isNewer('2.1.139', '2.1.139')).toBe(false);
    expect(_internal.isNewer('2.2.0', '2.1.139')).toBe(true);
  });
});

describe('checkForUpdate', () => {
  it('reports available:true with the exe url/name when the server has a newer version', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        version: '2.1.140',
        notes: 'notlar',
        assets: { desktopExe: { url: 'https://x/exe', name: 'ANATOLIA-Q-Setup-2.1.140.exe', size: 123 } },
      }),
    }));

    const result = await checkForUpdate('https://api.test', '2.1.139', fetchImpl);
    expect(result).toEqual({
      available: true, version: '2.1.140', notes: 'notlar',
      url: 'https://x/exe', name: 'ANATOLIA-Q-Setup-2.1.140.exe', size: 123,
    });
  });

  it('reports available:false when the server version is not newer', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({ version: '2.1.139', assets: { desktopExe: { url: 'https://x/exe', size: 1 } } }),
    }));

    const result = await checkForUpdate('https://api.test', '2.1.139', fetchImpl);
    expect(result).toEqual({ available: false });
  });

  it('throws when the version-check request itself fails', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 502 }));
    await expect(checkForUpdate('https://api.test', '2.1.139', fetchImpl)).rejects.toThrow('502');
  });
});

describe('downloadUpdate', () => {
  it('streams the response body to disk and reports progress', async () => {
    const body = Buffer.from('a'.repeat(1000));
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      body: Readable.toWeb(Readable.from([body])),
      headers: new Map([['content-length', String(body.length)]]),
    }));
    const dir = tmpDir();
    const progress = [];

    const destPath = await downloadUpdate('https://x/api/version/download/desktop', 'ANATOLIA-Q-Setup-2.1.140.exe', dir, (p) => progress.push(p), fetchImpl);

    expect(path.basename(destPath)).toBe('ANATOLIA-Q-Setup-2.1.140.exe');
    expect(fs.readFileSync(destPath).length).toBe(1000);
    expect(progress.at(-1)).toEqual({ received: 1000, total: 1000 });
  });

  it('throws when the download request itself fails', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 404, body: null }));
    await expect(downloadUpdate('https://x/y', 'y.exe', tmpDir(), undefined, fetchImpl)).rejects.toThrow('404');
  });
});
