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
  it('falls back to MID when there is no RAM signal', () => {
    expect(selectTierForDevice(undefined)).toBe(MODEL_TIERS.mid);
    expect(selectTierForDevice(null)).toBe(MODEL_TIERS.mid);
  });

  it('selects MID for a typical 4-12 GB desktop', () => {
    expect(selectTierForDevice(4 * 1024 ** 3)).toBe(MODEL_TIERS.mid);
    expect(selectTierForDevice(8 * 1024 ** 3)).toBe(MODEL_TIERS.mid);
    expect(selectTierForDevice(11 * 1024 ** 3)).toBe(MODEL_TIERS.mid);
  });

  it('selects HIGH only when a 12 GB+ desktop also has enough CPU cores', () => {
    expect(selectTierForDevice(12 * 1024 ** 3, 8)).toBe(MODEL_TIERS.high);
    expect(selectTierForDevice(32 * 1024 ** 3, 16)).toBe(MODEL_TIERS.high);
    expect(selectTierForDevice(16 * 1024 ** 3, 4)).toBe(MODEL_TIERS.low);
  });

  it('selects LOW on a low-core desktop so generation remains responsive', () => {
    expect(selectTierForDevice(16 * 1024 ** 3, 4)).toBe(MODEL_TIERS.low);
  });
});
