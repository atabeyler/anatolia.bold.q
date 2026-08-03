import { describe, it, expect } from 'vitest';
import { describeStructuredUpload } from './FileAttach.jsx';

describe('describeStructuredUpload', () => {
  it('returns an empty string for no file', () => {
    expect(describeStructuredUpload(null)).toBe('');
  });

  it('passes plain text through unchanged', () => {
    expect(describeStructuredUpload({ type: 'text', text: 'merhaba' })).toBe('merhaba');
  });

  it('formats transaction records into readable text (regression: ConsultChat used to assume every non-text file had a .url)', () => {
    const result = describeStructuredUpload({
      type: 'transactions',
      filename: 'islemler.csv',
      transactions: [
        { id: 'TXN-1', amount: 100, hour: 5, frequency: 1, newCounterparty: 1, crossBorder: 0 },
      ],
    });
    expect(result).toContain('islemler.csv');
    expect(result).toContain('TXN-1');
    expect(result).toContain('100 TL');
    expect(result).not.toContain('undefined');
  });

  it('formats scenario records into readable text', () => {
    const result = describeStructuredUpload({
      type: 'scenarios',
      filename: 'senaryolar.csv',
      scenarios: [{ title: 'Fiyat artar', probability: '%35', timeframe: '0-6 ay', trigger: 'Talep artışı' }],
    });
    expect(result).toContain('Fiyat artar');
    expect(result).toContain('%35');
    expect(result).not.toContain('undefined');
  });

  it('formats optimization records into readable text', () => {
    const result = describeStructuredUpload({
      type: 'optimization',
      filename: 'kalemler.csv',
      budgetPercent: 60,
      items: [{ id: 'Proje-A', value: 35, cost: 30 }],
    });
    expect(result).toContain('Proje-A');
    expect(result).toContain('%60');
    expect(result).not.toContain('undefined');
  });

  it('falls back to a download-link note for a generic file with a url', () => {
    const result = describeStructuredUpload({ type: 'file', filename: 'rapor.pdf', url: '/api/files/abc.pdf' });
    expect(result).toContain('rapor.pdf');
    expect(result).toContain('/api/files/abc.pdf');
  });
});
