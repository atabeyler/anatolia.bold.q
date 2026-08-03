import { describe, it, expect } from 'vitest';
import { toNumber, parseScenarios, parseTransactions, parseOptimizationProblem } from './analysis.js';

describe('toNumber', () => {
  it('parses plain integers and decimals', () => {
    expect(toNumber('35')).toBe(35);
    expect(toNumber('0.5')).toBe(0.5);
  });

  it('parses Turkish-formatted amounts ("." thousands, "," decimal)', () => {
    expect(toNumber('15.000,50')).toBe(15000.5);
    expect(toNumber('125.500,75 TL')).toBe(125500.75);
  });

  it('parses a bare Turkish decimal comma without a thousands separator', () => {
    expect(toNumber('60,5')).toBe(60.5);
  });

  it('treats a pure digit-grouped amount as thousands, not a decimal', () => {
    expect(toNumber('15.000')).toBe(15000);
    expect(toNumber('1.234.567')).toBe(1234567);
  });

  it('returns 0 for unparseable input', () => {
    expect(toNumber('')).toBe(0);
    expect(toNumber('—')).toBe(0);
    expect(toNumber(undefined)).toBe(0);
  });
});

describe('parseScenarios', () => {
  it('returns null when the matrix heading is missing', () => {
    expect(parseScenarios('no matrix here')).toBeNull();
  });

  it('parses scenario rows out of the quantum probability matrix table', () => {
    const content = `## KUANTUM OLASILIK MATRİSİ
| Senaryo | Olasılık | Zaman | Tetikleyici |
|---|---|---|---|
| SENARYO A (Birincil) | %42 | 6 ay | Örnek tetikleyici |
| SENARYO B | %31 | 12 ay | Diğer tetikleyici |
`;
    const scenarios = parseScenarios(content);
    expect(scenarios).toHaveLength(2);
    expect(scenarios[0]).toMatchObject({ title: 'SENARYO A (Birincil)', probability: '%42', timeframe: '6 ay' });
    expect(scenarios[1].title).toBe('SENARYO B');
  });
});

describe('parseTransactions', () => {
  it('returns null when the transaction table heading is missing', () => {
    expect(parseTransactions('no table here')).toBeNull();
  });

  it('parses transaction rows with Turkish-formatted amounts', () => {
    const content = `## İŞLEM KAYITLARI
| ID | Tutar | Saat | Sıklık | Yeni Taraf | Sınır Ötesi |
|---|---|---|---|---|---|
| TXN-001 | 15.000,50 | 3 | 4 | 1 | 0 |
| TXN-002 | 250 | 14 | 1 | 0 | 1 |
`;
    const transactions = parseTransactions(content);
    expect(transactions).toHaveLength(2);
    expect(transactions[0]).toMatchObject({ id: 'TXN-001', amount: 15000.5, hour: 3, frequency: 4, newCounterparty: 1, crossBorder: 0 });
    expect(transactions[1].amount).toBe(250);
  });
});

describe('parseOptimizationProblem', () => {
  it('returns null when the heading is missing', () => {
    expect(parseOptimizationProblem('no problem section here')).toBeNull();
  });

  it('picks the percentage next to "bütçe" rather than an unrelated one', () => {
    const content = `## OPTIMIZASYON PROBLEMİ
Hedef: %80 verimlilik ile %60 bütçe kısıtı altında en yüksek değeri seç.
| Kalem | Değer | Maliyet |
|---|---|---|
| A | 35 | 30 |
| B | 28 | 25 |
`;
    const problem = parseOptimizationProblem(content);
    expect(problem.budgetPercent).toBe(60);
    expect(problem.items).toEqual([
      { id: 'A', value: 35, cost: 30 },
      { id: 'B', value: 28, cost: 25 },
    ]);
  });

  it('parses Turkish-formatted item values and costs', () => {
    const content = `## OPTIMIZASYON PROBLEMİ
Bütçe: %60
| Kalem | Değer | Maliyet |
|---|---|---|
| A | 1.500 | 30 |
| B | 28 | 25 |
`;
    const problem = parseOptimizationProblem(content);
    expect(problem.items[0]).toEqual({ id: 'A', value: 1500, cost: 30 });
  });
});
