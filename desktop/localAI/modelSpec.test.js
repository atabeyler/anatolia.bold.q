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

  it('selects MID for a typical 4-11 GB desktop, regardless of core count', () => {
    expect(selectTierForDevice(4 * 1024 ** 3)).toBe(MODEL_TIERS.mid);
    expect(selectTierForDevice(8 * 1024 ** 3)).toBe(MODEL_TIERS.mid);
    expect(selectTierForDevice(11 * 1024 ** 3)).toBe(MODEL_TIERS.mid);
    // A low-core machine (e.g. a 2-core/4-thread laptop) with 4+ GB RAM
    // used to be forced onto the weak LOW/0.5B tier by a blanket
    // cpuCount<8 rule -- weak enough to fail real requests outright (see
    // llmProvider.js's isPromptEcho guard). Core count no longer gates
    // tier selection at all; RAM alone decides.
    expect(selectTierForDevice(4 * 1024 ** 3, 2)).toBe(MODEL_TIERS.mid);
  });

  it('selects HIGH whenever RAM meets its floor, regardless of core count', () => {
    expect(selectTierForDevice(12 * 1024 ** 3, 8)).toBe(MODEL_TIERS.high);
    expect(selectTierForDevice(32 * 1024 ** 3, 16)).toBe(MODEL_TIERS.high);
    // Core count used to gate HIGH (require >=8); a real 2-core/16 GB
    // machine now still qualifies on RAM alone -- generation is slower,
    // but that's a user-accepted tradeoff, not a hard block.
    expect(selectTierForDevice(16 * 1024 ** 3, 4)).toBe(MODEL_TIERS.high);
    expect(selectTierForDevice(12 * 1024 ** 3, 2)).toBe(MODEL_TIERS.high);
  });

  it('selects LOW when RAM is below MID\'s floor, regardless of core count', () => {
    expect(selectTierForDevice(2 * 1024 ** 3, 4)).toBe(MODEL_TIERS.low);
    expect(selectTierForDevice(2 * 1024 ** 3, 16)).toBe(MODEL_TIERS.low);
  });
});
