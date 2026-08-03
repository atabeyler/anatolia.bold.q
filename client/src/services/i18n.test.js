import { describe, it, expect } from 'vitest';
import { t } from './i18n.js';

describe('t (translation function)', () => {
  it('returns a key defined for tr', () => {
    expect(t('tr', 'quantumMode')).toBe('KUANTUM OLASILIK MODU');
  });

  it('returns a key defined for en', () => {
    expect(t('en', 'quantumMode')).toBe('QUANTUM PROBABILITY MODE');
  });

  it('falls back to tr for an unsupported language', () => {
    expect(t('xx', 'quantumMode')).toBe(t('tr', 'quantumMode'));
  });

  it('returns a key defined for de', () => {
    expect(t('de', 'quantumMode')).toBe('QUANTENWAHRSCHEINLICHKEITSMODUS');
  });

  it('returns a key defined for fr', () => {
    expect(t('fr', 'quantumMode')).toBe('MODE DE PROBABILITÉ QUANTIQUE');
  });

  it('returns a key defined for ar', () => {
    expect(t('ar', 'quantumMode')).toBe('وضع الاحتمالية الكمية');
  });

  it('returns the key itself when undefined in every language', () => {
    expect(t('tr', 'no-such-key')).toBe('no-such-key');
  });
});
