import { describe, it, expect } from 'vitest';
import { MODEL_TIERS, MODEL_SPEC, selectTierForDevice } from './modelSpec.js';

describe('MODEL_TIERS', () => {
  it('MODEL_SPEC (backward-compat) is the MID tier, unchanged from before tiering existed', () => {
    expect(MODEL_SPEC).toBe(MODEL_TIERS.mid);
    expect(MODEL_SPEC.id).toBe('qwen2.5-1.5b-instruct-q4_k_m');
  });

  it('every tier has a real 64-char hex sha256 and a positive size', () => {
    for (const tier of Object.values(MODEL_TIERS)) {
      expect(tier.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(tier.sizeBytes).toBeGreaterThan(0);
    }
  });
});

describe('selectTierForDevice', () => {
  it('returns null (fail safe) when there is no RAM signal', () => {
    expect(selectTierForDevice(null)).toBeNull();
    expect(selectTierForDevice({})).toBeNull();
  });

  it('returns null for a device below the LOW floor', () => {
    expect(selectTierForDevice({ totalMemBytes: 2 * 1024 ** 3 })).toBeNull();
  });

  it('selects LOW for a 3-6 GB device', () => {
    expect(selectTierForDevice({ totalMemBytes: 4 * 1024 ** 3 })).toBe(MODEL_TIERS.low);
  });

  it('selects MID for a 6-8 GB device (matches the desktop model choice)', () => {
    expect(selectTierForDevice({ totalMemBytes: 6 * 1024 ** 3 })).toBe(MODEL_TIERS.mid);
    expect(selectTierForDevice({ totalMemBytes: 7 * 1024 ** 3 })).toBe(MODEL_TIERS.mid);
  });

  it('still caps an 8-12 GB device at MID -- below HIGH’s own 12 GB floor', () => {
    expect(selectTierForDevice({ totalMemBytes: 8 * 1024 ** 3 })).toBe(MODEL_TIERS.mid);
    expect(selectTierForDevice({ totalMemBytes: 11 * 1024 ** 3 })).toBe(MODEL_TIERS.mid);
  });

  it('selects HIGH for a 12 GB+ device', () => {
    expect(selectTierForDevice({ totalMemBytes: 12 * 1024 ** 3 })).toBe(MODEL_TIERS.high);
    expect(selectTierForDevice({ totalMemBytes: 16 * 1024 ** 3 })).toBe(MODEL_TIERS.high);
  });
});
