import { describe, it, expect } from 'vitest';
import { selectProvider, refreshInstalledState, getModelManager, getDeviceInfo } from './registry.js';
import { MODEL_TIERS } from './modelSpec.js';

describe('selectProvider', () => {
  it('selects offline-extractive today (no native LocalLLM plugin registered in this test env)', () => {
    const provider = selectProvider();
    expect(provider.capability).toBe('offline-extractive');
    expect(provider.isAvailable()).toBe(true);
  });

  it('createQuery returns a callable bound to the given db/userId', () => {
    const provider = selectProvider();
    const run = provider.createQuery({ db: {}, userId: 'BOLD-001' });
    expect(typeof run).toBe('function');
  });
});

// Real behavior in a Node/vitest environment: there is no window.Capacitor,
// so getNativeDeviceInfo() (llmRuntime.js) always resolves null here --
// refreshInstalledState() must still fail safe onto the MID tier (never
// throw, never leave modelManager undefined) rather than assume a tier.
describe('refreshInstalledState (device tiering)', () => {
  it('falls back to the MID tier when no native device-info signal exists', async () => {
    await refreshInstalledState();
    expect(getModelManager().spec.id).toBe(MODEL_TIERS.mid.id);
    expect(getDeviceInfo()).toBeNull();
  });
});
