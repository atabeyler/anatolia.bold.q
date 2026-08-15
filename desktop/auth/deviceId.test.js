import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getOrCreateDeviceId } from './deviceId.js';

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'aq-device-'));
}

describe('getOrCreateDeviceId', () => {
  it('generates an AQ-WIN-XXXXXXXX id on win32', () => {
    const id = getOrCreateDeviceId(tmpDir(), 'win32');
    expect(id).toMatch(/^AQ-WIN-[0-9A-F]{8}$/);
  });

  it('generates an AQ-MAC-XXXXXXXX id on darwin', () => {
    const id = getOrCreateDeviceId(tmpDir(), 'darwin');
    expect(id).toMatch(/^AQ-MAC-[0-9A-F]{8}$/);
  });

  it('generates an AQ-LINUX-XXXXXXXX id on linux', () => {
    const id = getOrCreateDeviceId(tmpDir(), 'linux');
    expect(id).toMatch(/^AQ-LINUX-[0-9A-F]{8}$/);
  });

  it('falls back to AQ-DESKTOP-XXXXXXXX for an unrecognized platform', () => {
    const id = getOrCreateDeviceId(tmpDir(), 'freebsd');
    expect(id).toMatch(/^AQ-DESKTOP-[0-9A-F]{8}$/);
  });

  it('is stable across repeated calls (same install)', () => {
    const dir = tmpDir();
    const first = getOrCreateDeviceId(dir, 'win32');
    const second = getOrCreateDeviceId(dir, 'win32');
    expect(second).toBe(first);
  });

  it('generates a different id for a different install', () => {
    const a = getOrCreateDeviceId(tmpDir(), 'win32');
    const b = getOrCreateDeviceId(tmpDir(), 'win32');
    expect(a).not.toBe(b);
  });
});
