import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
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
  it('reports available:true with the windows asset url/name when the server has a newer version', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        version: '2.1.140',
        notes: 'notlar',
        assets: { desktopWin: { url: 'https://x/exe', name: 'ANATOLIA-Q-Setup-2.1.140.exe', size: 123 } },
      }),
    }));

    const result = await checkForUpdate('https://api.test', '2.1.139', 'win32', fetchImpl);
    expect(result).toEqual({
      available: true, version: '2.1.140', notes: 'notlar',
      url: 'https://x/exe', name: 'ANATOLIA-Q-Setup-2.1.140.exe', size: 123, sha256: null, platform: 'win32',
    });
  });

  it('carries the asset sha256 through when the server provides one', async () => {
    const digest = 'b'.repeat(64);
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        version: '2.1.140',
        assets: { desktopWin: { url: 'https://x/exe', name: 'ANATOLIA-Q-Setup-2.1.140.exe', size: 123, sha256: digest } },
      }),
    }));

    const result = await checkForUpdate('https://api.test', '2.1.139', 'win32', fetchImpl);
    expect(result.sha256).toBe(digest);
  });

  it('picks the mac asset on darwin and the linux asset on linux', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        version: '2.1.140',
        assets: {
          desktopMac: { url: 'https://x/dmg', name: 'ANATOLIA-Q-2.1.140.dmg', size: 10 },
          desktopLinux: { url: 'https://x/appimage', name: 'ANATOLIA-Q-2.1.140.AppImage', size: 20 },
        },
      }),
    }));

    const mac = await checkForUpdate('https://api.test', '2.1.139', 'darwin', fetchImpl);
    expect(mac).toMatchObject({ available: true, url: 'https://x/dmg', platform: 'darwin' });

    const linux = await checkForUpdate('https://api.test', '2.1.139', 'linux', fetchImpl);
    expect(linux).toMatchObject({ available: true, url: 'https://x/appimage', platform: 'linux' });
  });

  it('reports available:false when the server version is not newer', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({ version: '2.1.139', assets: { desktopWin: { url: 'https://x/exe', size: 1 } } }),
    }));

    const result = await checkForUpdate('https://api.test', '2.1.139', 'win32', fetchImpl);
    expect(result).toEqual({ available: false });
  });

  it('throws when the version-check request itself fails', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 502 }));
    await expect(checkForUpdate('https://api.test', '2.1.139', 'win32', fetchImpl)).rejects.toThrow('502');
  });
});

function fetchImplFor(bytes) {
  return vi.fn(async () => ({
    ok: true,
    body: Readable.toWeb(Readable.from([bytes])),
    headers: new Map([['content-length', String(bytes.length)]]),
  }));
}

describe('downloadUpdate', () => {
  it('accepts a download whose SHA-256 matches the expected digest and reports progress', async () => {
    const body = Buffer.from('a'.repeat(1000));
    const sha256 = crypto.createHash('sha256').update(body).digest('hex');
    const dir = tmpDir();
    const progress = [];

    const destPath = await downloadUpdate(
      'https://x/api/version/download/desktop', 'ANATOLIA-Q-Setup-2.1.140.exe', dir,
      (p) => progress.push(p), fetchImplFor(body), body.length, sha256,
    );

    expect(path.basename(destPath)).toBe('ANATOLIA-Q-Setup-2.1.140.exe');
    expect(fs.readFileSync(destPath).length).toBe(1000);
    expect(progress.at(-1)).toEqual({ received: 1000, total: 1000 });
  });

  it('rejects (fail-closed) and deletes the file when the SHA-256 does not match (tampered/corrupted download)', async () => {
    const body = Buffer.from('a'.repeat(1000));
    const wrongSha256 = 'f'.repeat(64);
    const dir = tmpDir();

    await expect(
      downloadUpdate('https://x/api/version/download/desktop', 'ANATOLIA-Q-Setup-2.1.140.exe', dir, undefined, fetchImplFor(body), body.length, wrongSha256)
    ).rejects.toThrow('update_checksum_mismatch');

    expect(fs.existsSync(path.join(dir, 'ANATOLIA-Q-Setup-2.1.140.exe'))).toBe(false);
  });

  it('rejects (fail-closed) when no expected SHA-256 is available at all', async () => {
    const body = Buffer.from('a'.repeat(1000));
    const dir = tmpDir();

    await expect(
      downloadUpdate('https://x/api/version/download/desktop', 'ANATOLIA-Q-Setup-2.1.140.exe', dir, undefined, fetchImplFor(body), body.length, null)
    ).rejects.toThrow('update_checksum_missing');

    expect(fs.existsSync(path.join(dir, 'ANATOLIA-Q-Setup-2.1.140.exe'))).toBe(false);
  });

  it('rejects a malformed (non-hex/wrong-length) expected SHA-256 the same as a missing one', async () => {
    const body = Buffer.from('a'.repeat(1000));
    const dir = tmpDir();

    await expect(
      downloadUpdate('https://x/api/version/download/desktop', 'ANATOLIA-Q-Setup-2.1.140.exe', dir, undefined, fetchImplFor(body), body.length, 'not-a-hash')
    ).rejects.toThrow('update_checksum_missing');
  });

  it('throws when the download request itself fails', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 404, body: null }));
    await expect(downloadUpdate('https://x/y', 'y.exe', tmpDir(), undefined, fetchImpl)).rejects.toThrow('404');
  });

  it('rejects downloads whose final byte count does not match the expected size', async () => {
    const body = Buffer.from('a'.repeat(1000));
    const sha256 = crypto.createHash('sha256').update(body).digest('hex');
    const dir = tmpDir();

    await expect(
      downloadUpdate(
        'https://x/api/version/download/desktop',
        'ANATOLIA-Q-Setup-2.1.140.exe',
        dir,
        undefined,
        fetchImplFor(body),
        1200,
        sha256,
      )
    ).rejects.toThrow('beklenen boyutta değil');

    expect(fs.existsSync(path.join(dir, 'ANATOLIA-Q-Setup-2.1.140.exe'))).toBe(false);
  });

  it('sanitizes the file name to prevent writing outside the destination directory (path traversal)', async () => {
    const body = Buffer.from('a'.repeat(10));
    const sha256 = crypto.createHash('sha256').update(body).digest('hex');
    const dir = tmpDir();

    const destPath = await downloadUpdate(
      'https://x/api/version/download/desktop', '../../evil.exe', dir, undefined, fetchImplFor(body), body.length, sha256,
    );

    expect(path.dirname(destPath)).toBe(dir);
    expect(path.basename(destPath)).toBe('evil.exe');
  });
});
