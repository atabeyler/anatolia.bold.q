import { describe, expect, it } from 'vitest';
import { buildPredictedOutcome, buildQuantumParams } from './analysisTrace.js';

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
