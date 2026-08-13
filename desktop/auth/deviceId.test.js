import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getOrCreateDeviceId } from './deviceId.js';

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'aq-device-'));
}

describe('getOrCreateDeviceId', () => {
  it('generates an AQ-WIN-XXXXXXXX id', () => {
    const id = getOrCreateDeviceId(tmpDir());
    expect(id).toMatch(/^AQ-WIN-[0-9A-F]{8}$/);
  });

  it('is stable across repeated calls (same install)', () => {
    const dir = tmpDir();
    const first = getOrCreateDeviceId(dir);
    const second = getOrCreateDeviceId(dir);
    expect(second).toBe(first);
  });

  it('generates a different id for a different install', () => {
    const a = getOrCreateDeviceId(tmpDir());
    const b = getOrCreateDeviceId(tmpDir());
    expect(a).not.toBe(b);
  });
});
