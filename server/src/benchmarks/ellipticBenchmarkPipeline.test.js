import { describe, expect, it } from 'vitest';
import { orientAllScores, selectBaselinePolicy, selectGraphModel } from './ellipticBenchmarkPipeline.js';

function partition(name, entries) {
  return {
    name,
    samples: entries.map(([id]) => ({ id })),
    labels: new Map(entries),
  };
}

function makeScores() {
  const base = [0.1, 0.2, 0.8, 0.9];
  return {
    classical: base,
    linear: base,
    temporal: base,
    q5: base,
    q13: base,
    graph: base,
    fp: base,
  };
}

describe('ellipticBenchmarkPipeline', () => {
  it('does not touch holdout data while selecting thresholds and gates', () => {
    const validation = partition('validation', [['v1', 'licit'], ['v2', 'licit'], ['v3', 'illicit'], ['v4', 'illicit']]);
    const developmentTest = partition('developmentTest', [['d1', 'licit'], ['d2', 'licit'], ['d3', 'illicit'], ['d4', 'illicit']]);
    const holdout = {
      name: 'holdout',
      get samples() {
        throw new Error('holdout must not be read during selection');
      },
      labels: new Map([['h1', 'licit']]),
    };
    const partitions = { validation, developmentTest, holdout };
    const rawScores = {
      validation: makeScores(),
      developmentTest: makeScores(),
      holdout: makeScores(),
    };

    const orientedInfo = orientAllScores(partitions, rawScores);
    const baseline = selectBaselinePolicy(partitions, rawScores, orientedInfo);
    const graphModel = selectGraphModel(partitions, rawScores, orientedInfo, baseline, null);

    expect(baseline.validation.fn).toBe(0);
    expect(baseline.developmentTest.fn).toBe(0);
    expect(graphModel.winner).toBeTruthy();
  });
});
