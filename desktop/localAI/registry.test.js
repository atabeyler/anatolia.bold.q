import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { selectProvider, configureLocalLLM, getModelManager, setModelTier, listModelTiers } from './registry.js';

describe('selectProvider', () => {
  it('selects offline-extractive today (the only registered, always-available provider)', () => {
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

// Settings > Local AI's manual tier picker (see registry.js's setModelTier
// comment for why a saved choice must outlive a restart). Uses a temp dir
// via configureLocalLLM rather than the module's real ~/.anatolia-q
// fallback so these tests never touch the machine's actual home directory.
describe('model tier picker', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aq-tier-'));
    configureLocalLLM({ modelsDir: path.join(tmpDir, 'models') });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('lists every pinned tier with picker-relevant fields', () => {
    const tiers = listModelTiers();
    expect(tiers.map((t) => t.tier)).toEqual(['low', 'mid', 'high']);
    expect(tiers.every((t) => typeof t.sizeBytes === 'number' && t.displayLabel)).toBe(true);
  });

  it('repoints modelManager at the chosen tier', () => {
    setModelTier('high');
    expect(getModelManager().spec.tier).toBe('high');
  });

  it('rejects an unknown tier key instead of silently keeping the old one', () => {
    expect(() => setModelTier('ultra')).toThrow('unknown_model_tier');
    expect(getModelManager().spec.tier).not.toBe('ultra');
  });

  it('persists the choice to a preference file next to modelsDir, so it survives a restart', () => {
    setModelTier('high');
    const saved = JSON.parse(fs.readFileSync(path.join(tmpDir, 'model-tier-preference.json'), 'utf-8'));
    expect(saved.tier).toBe('high');
  });
});
