import { describe, it, expect } from 'vitest';
import { validateEnv } from '../src/lib/validateEnv.js';

describe('validateEnv', () => {
  it('passes in development even without BCI_DATABASE_URL', () => {
    expect(() => validateEnv({ NODE_ENV: 'development' })).not.toThrow();
  });

  it('fails closed in production when BCI_DATABASE_URL is missing', () => {
    expect(() => validateEnv({ NODE_ENV: 'production' })).toThrow(/BCI_DATABASE_URL/);
  });

  it('passes in production when required vars are present', () => {
    expect(() =>
      validateEnv({ NODE_ENV: 'production', BCI_DATABASE_URL: 'postgres://x' })
    ).not.toThrow();
  });
});
