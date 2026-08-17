import { describe, it, expect } from 'vitest';
import { selectProvider } from './registry.js';

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
