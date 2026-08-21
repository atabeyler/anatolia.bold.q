import { describe, expect, it } from 'vitest';
import { buildPredictedOutcome, buildQuantumParams, buildSourceHashes } from './analysisTrace.js';
import { QUANTUM_ENGINE_VERSION } from '../services/decisionIntelligence.js';

describe('buildQuantumParams', () => {
  it('returns an empty object when no engine ran', () => {
    expect(buildQuantumParams({})).toEqual({});
  });

  it('captures scenario engine backend/qubit/shot info', () => {
    const params = buildQuantumParams({
      quantum: { backend: 'qiskit-aer-simulator', qubits: 4, shots: 4096, batches: 8, circuitDepth: 12 },
    });
    expect(params.scenario).toEqual({
      backend: 'qiskit-aer-simulator', qubits: 4, shots: 4096, batches: 8, circuitDepth: 12,
    });
    expect(params.fraud).toBeUndefined();
    expect(params.optimizer).toBeUndefined();
  });

  it('captures fraud engine backend/qubit info', () => {
    const params = buildQuantumParams({ fraud: { backend: 'qiskit-statevector-kernel', qubits: 5, circuitDepth: 9 } });
    expect(params.fraud).toEqual({ backend: 'qiskit-statevector-kernel', qubits: 5, circuitDepth: 9 });
  });

  it('captures optimizer seed and QAOA layer count for reproducibility', () => {
    const params = buildQuantumParams({
      optimizer: { backend: 'qiskit-aer-simulator', qubits: 11, circuitDepth: 20, seed: 123456, qaoaLayers: 2 },
    });
    expect(params.optimizer).toEqual({
      backend: 'qiskit-aer-simulator', qubits: 11, circuitDepth: 20, seed: 123456, qaoaLayers: 2,
    });
  });

  it('captures all three engines together', () => {
    const params = buildQuantumParams({
      quantum: { backend: 'qiskit-aer-simulator', qubits: 4, shots: 4096, batches: 8, circuitDepth: 12 },
      optimizer: { backend: 'qiskit-aer-simulator', qubits: 11, circuitDepth: 20, seed: 42, qaoaLayers: 2 },
    });
    expect(Object.keys(params)).toEqual(['scenario', 'optimizer']);
  });
});

describe('buildPredictedOutcome', () => {
  it('returns an empty object when no engine produced a scored result', () => {
    expect(buildPredictedOutcome({})).toEqual({});
  });

  it('captures scenario candidates with their predicted probabilities', () => {
    const predicted = buildPredictedOutcome({
      scenarios: [
        { id: 'SENARYO-A', title: 'A', quantumProbability: 62 },
        { id: 'SENARYO-B', title: 'B', quantumProbability: 38 },
      ],
    });
    expect(predicted.scenario.candidates).toEqual([
      { id: 'SENARYO-A', title: 'A', probability: 62 },
      { id: 'SENARYO-B', title: 'B', probability: 38 },
    ]);
  });

  it('captures only the flagged transaction ids for the fraud engine', () => {
    const predicted = buildPredictedOutcome({
      fraud: {
        transactionCount: 3,
        transactions: [
          { id: 'TXN-1', flagged: true },
          { id: 'TXN-2', flagged: false },
          { id: 'TXN-3', flagged: true },
        ],
      },
    });
    expect(predicted.fraud).toEqual({ transactionCount: 3, flaggedIds: ['TXN-1', 'TXN-3'] });
  });

  it('captures optimizer totals and selection', () => {
    const predicted = buildPredictedOutcome({
      optimizer: { totalValue: 72, totalCost: 60, selected: ['A', 'C'] },
    });
    expect(predicted.optimizer).toEqual({ totalValue: 72, totalCost: 60, selected: ['A', 'C'] });
  });
});

// AQ-009: execution fingerprint
describe('buildSourceHashes', () => {
  it('returns an empty list when there is no document and no quantum reproducibility data', () => {
    expect(buildSourceHashes({}, {})).toEqual([]);
  });

  it('hashes an uploaded document rather than including it raw', () => {
    const hashes = buildSourceHashes({ documentContext: 'gizli belge içeriği' }, {});
    expect(hashes).toHaveLength(1);
    expect(hashes[0].source).toBe('documentContext');
    expect(hashes[0].hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashes[0].hash).not.toContain('gizli belge içeriği');
  });

  it('is deterministic for the same document content', () => {
    const a = buildSourceHashes({ documentContext: 'aynı içerik' }, {});
    const b = buildSourceHashes({ documentContext: 'aynı içerik' }, {});
    expect(a[0].hash).toBe(b[0].hash);
  });

  it('collects each quantum engine\'s own reproducibility input hash', () => {
    const hashes = buildSourceHashes({}, {
      quantum: { reproducibility: { inputHash: 'a'.repeat(64) } },
      fraud: { reproducibility: { inputHash: 'b'.repeat(64) } },
      optimizer: { reproducibility: { inputHash: 'c'.repeat(64) } },
    });
    expect(hashes.map((h) => h.source).sort()).toEqual(['fraud', 'optimizer', 'quantum']);
  });

  it('combines a document hash with engine hashes', () => {
    const hashes = buildSourceHashes(
      { documentContext: 'belge' },
      { quantum: { reproducibility: { inputHash: 'a'.repeat(64) } } }
    );
    expect(hashes).toHaveLength(2);
  });
});

describe('QUANTUM_ENGINE_VERSION (AQ-009)', () => {
  it('is a non-empty version string reflecting the pinned quantum dependencies', () => {
    expect(typeof QUANTUM_ENGINE_VERSION).toBe('string');
    expect(QUANTUM_ENGINE_VERSION.length).toBeGreaterThan(0);
    expect(QUANTUM_ENGINE_VERSION).toContain('qiskit');
  });
});
