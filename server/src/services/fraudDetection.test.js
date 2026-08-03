import { describe, it, expect } from 'vitest';
import { computeFraudRiskScores, mergeFraudResults } from './fraudDetection.js';

describe('computeFraudRiskScores', () => {
  it('returns null without spawning a process for fewer than 3 transactions', async () => {
    expect(await computeFraudRiskScores([])).toBeNull();
    expect(await computeFraudRiskScores([{ id: 'TXN-001' }])).toBeNull();
    expect(await computeFraudRiskScores(null)).toBeNull();
  });
});

describe('mergeFraudResults', () => {
  it('returns null when there is no fraud result', () => {
    expect(mergeFraudResults(null)).toBeNull();
    expect(mergeFraudResults({ transactions: [] })).toBeNull();
  });

  it('produces a verification note listing flagged and normal transactions', () => {
    const result = {
      backend: 'qiskit-statevector-kernel',
      qubits: 5,
      circuitDepth: 12,
      circuitDiagram: 'q_0: ┤ RY ├──■──',
      transactionCount: 2,
      flaggedCount: 1,
      transactions: [
        { id: 'TXN-001', amount: 15000.5, hour: 3, frequency: 4, newCounterparty: 1, crossBorder: 0, riskScore: 88.5, flagged: true },
        { id: 'TXN-002', amount: 250, hour: 14, frequency: 1, newCounterparty: 0, crossBorder: 1, riskScore: 12.1, flagged: false },
      ],
    };

    const note = mergeFraudResults(result);

    expect(note).toContain('KUANTUM ANOMALİ TESPİTİ DOĞRULAMASI');
    expect(note).toContain('5-kübitlik');
    expect(note).toContain('1 / 2 kayıt işaretlendi');
    expect(note).toContain('| TXN-001 | 15000.5 | 3 | 4 | Evet | Hayır | 88.5 | 🚩 İŞARETLENDİ |');
    expect(note).toContain('| TXN-002 | 250 | 14 | 1 | Hayır | Evet | 12.1 | — |');
    expect(note).toContain('q_0: ┤ RY ├──■──');
  });
});
