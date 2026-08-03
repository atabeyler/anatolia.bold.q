import { describe, it, expect } from 'vitest';
import { parseTransactionFile } from './transactionSource.js';

function csv(text) {
  return Buffer.from(text, 'utf-8');
}

describe('parseTransactionFile', () => {
  it('returns null for a non-CSV/XLSX filename', () => {
    expect(parseTransactionFile(csv('irrelevant'), 'report.pdf')).toBeNull();
  });

  it('returns null when required columns (amount + hour/date) are missing', () => {
    const buf = csv('Kalem,Deger,Maliyet\nA,10,20\nB,15,25\nC,5,5\n');
    expect(parseTransactionFile(buf, 'data.csv')).toBeNull();
  });

  it('parses a well-formed transaction CSV with all columns', () => {
    const buf = csv(
      'Islem ID,Tutar,Saat,Siklik,Yeni Taraf,Sinir Otesi\n' +
      'TXN-1,12500,14,1,0,0\n' +
      'TXN-2,48000,3,6,1,1\n' +
      'TXN-3,900,10,2,0,0\n'
    );
    const result = parseTransactionFile(buf, 'islemler.csv');
    expect(result).not.toBeNull();
    expect(result.transactions).toHaveLength(3);
    expect(result.transactions[1]).toEqual({
      id: 'TXN-2', amount: 48000, hour: 3, frequency: 6, newCounterparty: 1, crossBorder: 1,
    });
    expect(result.warnings).toEqual([]);
  });

  it('fills in defaults and warns when optional columns are absent', () => {
    const buf = csv('Tutar,Saat\n1000,9\n2000,15\n3000,22\n');
    const result = parseTransactionFile(buf, 'basit.csv');
    expect(result).not.toBeNull();
    expect(result.transactions[0]).toEqual({
      id: 'TXN-1', amount: 1000, hour: 9, frequency: 1, newCounterparty: 0, crossBorder: 0,
    });
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('derives the hour from a date/timestamp column when no explicit hour column exists', () => {
    const buf = csv('Tutar,Tarih\n500,2026-01-15T14:30:00\n600,2026-01-15T03:10:00\n700,2026-01-15T22:00:00\n');
    const result = parseTransactionFile(buf, 'tarihli.csv');
    expect(result).not.toBeNull();
    expect(result.transactions[0].hour).toBe(14);
    expect(result.transactions[1].hour).toBe(3);
  });

  it('recognizes English column aliases', () => {
    const buf = csv('id,amount,hour,frequency,new counterparty,cross border\nT1,100,5,1,1,0\nT2,200,6,2,0,1\nT3,300,7,3,0,0\n');
    const result = parseTransactionFile(buf, 'english.csv');
    expect(result).not.toBeNull();
    expect(result.transactions[0]).toEqual({
      id: 'T1', amount: 100, hour: 5, frequency: 1, newCounterparty: 1, crossBorder: 0,
    });
  });
});
