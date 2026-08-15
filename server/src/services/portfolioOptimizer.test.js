import { describe, it, expect } from 'vitest';
import { computeOptimalAllocation, mergeOptimizerResults } from './portfolioOptimizer.js';

describe('computeOptimalAllocation', () => {
  it('returns null without spawning a process for fewer than 2 items', async () => {
    expect(await computeOptimalAllocation([], 60)).toBeNull();
    expect(await computeOptimalAllocation([{ id: 'A', value: 1, cost: 1 }], 60)).toBeNull();
    expect(await computeOptimalAllocation(null, 60)).toBeNull();
  });
});

describe('mergeOptimizerResults', () => {
  it('returns null when there is no optimizer result', () => {
    expect(mergeOptimizerResults(null)).toBeNull();
    expect(mergeOptimizerResults({ items: [] })).toBeNull();
  });

  it('produces a verification note listing selected and rejected items', () => {
    const result = {
      backend: 'qiskit-aer-simulator',
      qubits: 11,
      circuitDepth: 20,
      circuitDiagram: 'q_0: ┤ H ├──■──',
      selected: ['A', 'C'],
      totalValue: 72,
      totalCost: 60,
      budgetPercent: 60,
      ibmHardwareAttempted: false,
      items: [
        { id: 'A', value: 35, cost: 30, selected: true },
        { id: 'B', value: 28, cost: 25, selected: false },
        { id: 'C', value: 15, cost: 10, selected: true },
      ],
    };

    const note = mergeOptimizerResults(result);

    expect(note).toContain('KUANTUM KAYNAK TAHSİSİ OPTİMİZASYONU (QAOA)');
    expect(note).toContain('11-kübitlik');
    expect(note).toContain('%60');
    expect(note).toContain('| A | 35 | 30 | ✅ Seçildi |');
    expect(note).toContain('| B | 28 | 25 | — |');
    expect(note).toContain('q_0: ┤ H ├──■──');
    expect(note).not.toContain('gerçek kuantum donanımında');
  });

  it('notes when the result came from real IBM hardware', () => {
    const result = {
      backend: 'ibm_torino',
      qubits: 11,
      circuitDepth: 20,
      circuitDiagram: '',
      selected: ['A'],
      totalValue: 35,
      totalCost: 30,
      budgetPercent: 60,
      ibmHardwareAttempted: true,
      items: [{ id: 'A', value: 35, cost: 30, selected: true }],
    };

    const note = mergeOptimizerResults(result);
    expect(note).toContain('gerçek kuantum donanımında');
    expect(note).toContain('ibm_torino');
  });

  it('notes when hardware was attempted but timed out back to the simulator', () => {
    const result = {
      backend: 'qiskit-aer-simulator',
      qubits: 11,
      circuitDepth: 20,
      circuitDiagram: '',
      selected: ['A'],
      totalValue: 35,
      totalCost: 30,
      budgetPercent: 60,
      ibmHardwareAttempted: true,
      items: [{ id: 'A', value: 35, cost: 30, selected: true }],
    };

    const note = mergeOptimizerResults(result);
    expect(note).toContain('kuyruk/zaman aşımı');
  });

  it('reports a matching optimality when QAOA equals the classical optimum', () => {
    const result = {
      backend: 'qiskit-aer-simulator', qubits: 11, circuitDepth: 20, circuitDiagram: '',
      selected: ['A'], totalValue: 35, totalCost: 30, budgetPercent: 60, ibmHardwareAttempted: false,
      items: [{ id: 'A', value: 35, cost: 30, selected: true }],
      classicalBenchmark: { totalValue: 35, totalCost: 30, selected: ['A'], optimalityGapPercent: 0, matchesOptimal: true },
    };
    const note = mergeOptimizerResults(result);
    expect(note).toContain('Klasik Optimum Karşılaştırması');
    expect(note).toContain('optimality gap: %0');
  });

  it('reports the gap when QAOA falls short of the classical optimum', () => {
    const result = {
      backend: 'qiskit-aer-simulator', qubits: 11, circuitDepth: 20, circuitDiagram: '',
      selected: ['A'], totalValue: 30, totalCost: 25, budgetPercent: 60, ibmHardwareAttempted: false,
      items: [{ id: 'A', value: 30, cost: 25, selected: true }],
      classicalBenchmark: { totalValue: 40, totalCost: 30, selected: ['A', 'B'], optimalityGapPercent: 25, matchesOptimal: false },
    };
    const note = mergeOptimizerResults(result);
    expect(note).toContain('%25 daha düşük değerli');
  });

  it('notes the hybrid decomposition when the item count exceeded one circuit', () => {
    const result = {
      backend: 'qiskit-aer-simulator', qubits: 14, circuitDepth: 20, circuitDiagram: '',
      selected: ['A'], totalValue: 30, totalCost: 25, budgetPercent: 60, ibmHardwareAttempted: false,
      hybrid: true, partitionCount: 3,
      items: Array.from({ length: 20 }, (_, i) => ({ id: `I${i}`, value: 10, cost: 10, selected: i === 0 })),
      classicalBenchmark: { totalValue: 30, totalCost: 25, selected: ['A'], optimalityGapPercent: 0, matchesOptimal: true },
    };
    const note = mergeOptimizerResults(result);
    expect(note).toContain('Hibrit çözüm');
    expect(note).toContain('3 gruba');
    expect(note).toContain('QAOA (hibrit)');
  });

  it('does not mention the hybrid decomposition for a single-circuit result', () => {
    const result = {
      backend: 'qiskit-aer-simulator', qubits: 11, circuitDepth: 20, circuitDiagram: '',
      selected: ['A'], totalValue: 30, totalCost: 25, budgetPercent: 60, ibmHardwareAttempted: false,
      items: [{ id: 'A', value: 30, cost: 25, selected: true }],
    };
    const note = mergeOptimizerResults(result);
    expect(note).not.toContain('Hibrit çözüm');
  });
});
