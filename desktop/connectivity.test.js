import { describe, it, expect, vi } from 'vitest';
import { createConnectivityMonitor } from './connectivity.js';

describe('createConnectivityMonitor', () => {
  it('reports cloud when the health endpoint responds ok', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true }));
    const monitor = createConnectivityMonitor({ apiBaseUrl: 'https://api.test', fetchImpl });
    await monitor.checkOnce();
    expect(monitor.getState()).toBe('cloud');
  });

  it('reports local on network failure, without throwing', async () => {
    const fetchImpl = vi.fn(async () => { throw new Error('ENOTFOUND'); });
    const monitor = createConnectivityMonitor({ apiBaseUrl: 'https://api.test', fetchImpl });
    await expect(monitor.checkOnce()).resolves.toBe(false);
    expect(monitor.getState()).toBe('local');
  });

  it('emits a change event only when the state actually changes', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true }));
    const monitor = createConnectivityMonitor({ apiBaseUrl: 'https://api.test', fetchImpl });
    const seen = [];
    monitor.onChange((s) => seen.push(s));

    await monitor.checkOnce();
    await monitor.checkOnce(); // still cloud -- no duplicate event
    expect(seen).toEqual(['cloud']);
  });

  it('markSyncing sets a transient sync state', () => {
    const monitor = createConnectivityMonitor({ apiBaseUrl: 'https://api.test' });
    monitor.markSyncing();
    expect(monitor.getState()).toBe('sync');
  });
});
