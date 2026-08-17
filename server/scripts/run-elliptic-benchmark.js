import path from 'node:path';
import { loadEllipticDataset, temporalSplit } from '../src/benchmarks/ellipticCsv.js';
import { createElliptic5QScorer, createElliptic13QScorer, createRobustClassicalScorer } from '../src/benchmarks/ellipticScorers.js';
import { runBlindAmlBenchmark } from '../src/benchmarks/amlBenchmark.js';
import { binaryMetrics } from '../src/benchmarks/benchmarkMetrics.js';
import { selectOrientationAndThreshold, applyOrientation } from '../src/benchmarks/thresholdSelection.js';

const dataDir = path.resolve(process.argv[2] || process.env.ELLIPTIC_DATA_DIR || './data/elliptic');
const dataset = await loadEllipticDataset(dataDir);
const split = temporalSplit(dataset);

const factories = {
  classical: createRobustClassicalScorer,
  elliptic5DProxy: createElliptic5QScorer,
  elliptic13DProxy: createElliptic13QScorer,
};

const output = { dataDir, boundaries: split.boundaries, counts: {}, models: {} };
for (const [name, factory] of Object.entries(factories)) {
  const scorer = factory(split.train.samples);
  const validation = await runBlindAmlBenchmark(split.validation, { [name]: scorer }, { threshold: 0.5 });
  const validationLabels = split.validation.samples.map((s) => split.validation.labels.get(s.id) || 'unknown');
  // Some scorers end up anti-correlated with "illicit" on a given dataset
  // (see ellipticScorers.js) -- pick whichever orientation performs better on
  // validation only, never on test.
  const selected = selectOrientationAndThreshold(validationLabels, validation.results[name].scores, { objective: 'f1' });

  const test = await runBlindAmlBenchmark(split.test, { [name]: scorer }, { threshold: 0.5 });
  const testLabels = split.test.samples.map((s) => split.test.labels.get(s.id) || 'unknown');
  const testScores = applyOrientation(test.results[name].scores, selected.orientation);
  const testMetrics = binaryMetrics(testLabels, testScores, selected.threshold);

  output.models[name] = {
    orientation: selected.orientation,
    selectedThreshold: selected.threshold,
    validation: selected.metrics,
    test: testMetrics,
  };
}
for (const [name, part] of Object.entries(split)) {
  if (name !== 'boundaries') output.counts[name] = { total: part.samples.length, known: part.knownSampleCount };
}

console.log(JSON.stringify(output, null, 2));
