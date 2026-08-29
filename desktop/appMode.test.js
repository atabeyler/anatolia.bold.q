import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createAppModeController } from './appMode.js';

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'aq-appmode-'));
}

function fakeConnectivity(state = 'cloud') {
  return {
    start: vi.fn(),
    stop: vi.fn(),
    checkOnce: vi.fn(async () => true),
    getState: vi.fn(() => state),
  };
}

function makeController(overrides = {}) {
  const userDataDir = overrides.userDataDir || tmpDir();
  const connectivity = overrides.connectivity || fakeConnectivity();
  const performSync = overrides.performSync || vi.fn(async () => ({ ok: true }));
  const getNeedsReauth = overrides.getNeedsReauth || vi.fn(() => false);
  const startTimers = overrides.startTimers || vi.fn();
  const stopTimers = overrides.stopTimers || vi.fn();
  const sendReauthRequired = overrides.sendReauthRequired || vi.fn();
  const broadcastConnectivity = overrides.broadcastConnectivity || vi.fn();
  const fetchImpl = overrides.fetchImpl || vi.fn(async () => ({ ok: true }));

  const controller = createAppModeController({
    userDataDir,
    connectivity,
    performSync,
    getNeedsReauth,
    startTimers,
    stopTimers,
    sendReauthRequired,
    broadcastConnectivity,
    apiBaseUrl: overrides.apiBaseUrl ?? 'https://api.test',
    fetchImpl,
  });

  return { controller, userDataDir, connectivity, performSync, getNeedsReauth, startTimers, stopTimers, sendReauthRequired, broadcastConnectivity, fetchImpl };
}

describe('createAppModeController', () => {
  it('defaults to auto when no app-mode.json exists yet', () => {
    const { controller } = makeController();
    expect(controller.get()).toBe('auto');
    expect(controller.isOffline()).toBe(false);
  });

  it('loads a previously persisted offline mode from disk', () => {
    const userDataDir = tmpDir();
    fs.writeFileSync(path.join(userDataDir, 'app-mode.json'), JSON.stringify({ mode: 'offline' }));
    const { controller } = makeController({ userDataDir });
    expect(controller.get()).toBe('offline');
    expect(controller.isOffline()).toBe(true);
  });

  it('treats a corrupt app-mode.json as auto rather than crashing', () => {
    const userDataDir = tmpDir();
    fs.writeFileSync(path.join(userDataDir, 'app-mode.json'), '{not json');
    const { controller } = makeController({ userDataDir });
    expect(controller.get()).toBe('auto');
  });

  describe('set(\'offline\')', () => {
    it('persists the mode, stops timers, and never touches connectivity or sync', async () => {
      const { controller, userDataDir, connectivity, performSync, stopTimers } = makeController();
      await controller.set('offline');

      expect(controller.get()).toBe('offline');
      expect(controller.isOffline()).toBe(true);
      expect(stopTimers).toHaveBeenCalledTimes(1);
      expect(connectivity.start).not.toHaveBeenCalled();
      expect(performSync).not.toHaveBeenCalled();

      const onDisk = JSON.parse(fs.readFileSync(path.join(userDataDir, 'app-mode.json'), 'utf8'));
      expect(onDisk.mode).toBe('offline');
    });

    it('survives a restart -- a new controller pointed at the same dir sees the persisted mode', async () => {
      const userDataDir = tmpDir();
      const { controller: first } = makeController({ userDataDir });
      await first.set('offline');

      const { controller: second } = makeController({ userDataDir });
      expect(second.get()).toBe('offline');
    });
  });

  describe('set(\'auto\')', () => {
    it('restarts connectivity, checks once, syncs, and restarts timers when no reauth is needed', async () => {
      const { controller, connectivity, performSync, startTimers, broadcastConnectivity, getNeedsReauth, sendReauthRequired } = makeController();
      await controller.set('offline');
      await controller.set('auto');

      expect(controller.get()).toBe('auto');
      expect(connectivity.start).toHaveBeenCalledTimes(1);
      expect(connectivity.checkOnce).toHaveBeenCalledTimes(1);
      expect(getNeedsReauth).toHaveBeenCalled();
      expect(performSync).toHaveBeenCalledTimes(1);
      expect(sendReauthRequired).not.toHaveBeenCalled();
      expect(startTimers).toHaveBeenCalledTimes(1);
      expect(broadcastConnectivity).toHaveBeenCalledWith('cloud');
    });

    it('sends auth:reauthRequired and skips performSync when the cached session needs reauth', async () => {
      const getNeedsReauth = vi.fn(() => true);
      const { controller, performSync, sendReauthRequired, startTimers } = makeController({ getNeedsReauth });
      await controller.set('auto');

      expect(sendReauthRequired).toHaveBeenCalledTimes(1);
      expect(performSync).not.toHaveBeenCalled();
      // Timers still restart even when reauth is needed -- otherwise the
      // app would stay silently paused forever once the user does
      // re-authenticate through the renderer's own reauth flow.
      expect(startTimers).toHaveBeenCalledTimes(1);
    });

    it('does not throw and still resolves when performSync rejects', async () => {
      const performSync = vi.fn(async () => { throw new Error('network down'); });
      const { controller, startTimers } = makeController({ performSync });
      await expect(controller.set('auto')).resolves.toBe('auto');
      expect(startTimers).toHaveBeenCalledTimes(1);
    });
  });

  describe('pending device revoke (item 11)', () => {
    it('does nothing when no revoke is pending', async () => {
      const { controller, fetchImpl } = makeController();
      await controller.set('auto');
      expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('flushes a pending revoke once app mode returns to auto, then clears the marker', async () => {
      const userDataDir = tmpDir();
      const fetchImpl = vi.fn(async () => ({ ok: true }));
      const { controller } = makeController({ userDataDir, fetchImpl, apiBaseUrl: 'https://api.test' });

      controller.setPendingRevoke({ deviceId: 'AQ-WIN-ABCD1234', jwt: 'jwt-token' });
      expect(fs.existsSync(path.join(userDataDir, 'pending-device-revoke.json'))).toBe(true);

      await controller.set('auto');

      expect(fetchImpl).toHaveBeenCalledWith('https://api.test/api/devices/AQ-WIN-ABCD1234', {
        method: 'DELETE',
        headers: { Authorization: 'Bearer jwt-token' },
      });
      expect(fs.existsSync(path.join(userDataDir, 'pending-device-revoke.json'))).toBe(false);
    });

    it('still clears the marker even if the DELETE request fails', async () => {
      const userDataDir = tmpDir();
      const fetchImpl = vi.fn(async () => { throw new Error('offline'); });
      const { controller } = makeController({ userDataDir, fetchImpl });

      controller.setPendingRevoke({ deviceId: 'AQ-WIN-ABCD1234', jwt: 'jwt-token' });
      await expect(controller.set('auto')).resolves.toBe('auto');

      expect(fs.existsSync(path.join(userDataDir, 'pending-device-revoke.json'))).toBe(false);
    });

    it('survives a restart -- a pending revoke written before a relaunch is still flushed', async () => {
      const userDataDir = tmpDir();
      const fetchImpl = vi.fn(async () => ({ ok: true }));
      const { controller: first } = makeController({ userDataDir });
      first.setPendingRevoke({ deviceId: 'AQ-MAC-DEADBEEF', jwt: 'stale-jwt' });

      const { controller: second } = makeController({ userDataDir, fetchImpl });
      await second.set('auto');

      expect(fetchImpl).toHaveBeenCalledWith('https://api.test/api/devices/AQ-MAC-DEADBEEF', {
        method: 'DELETE',
        headers: { Authorization: 'Bearer stale-jwt' },
      });
    });
  });

  it('ignores an invalid mode value', async () => {
    const { controller, stopTimers, connectivity } = makeController();
    const result = await controller.set('bogus');
    expect(result).toBe('auto');
    expect(controller.get()).toBe('auto');
    expect(stopTimers).not.toHaveBeenCalled();
    expect(connectivity.start).not.toHaveBeenCalled();
  });
});
