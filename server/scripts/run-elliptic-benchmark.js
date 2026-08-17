import path from 'node:path';
import { loadEllipticDataset, temporalSplit } from '../src/benchmarks/ellipticCsv.js';
import { createElliptic5QScorer, createElliptic13QScorer, createRobustClassicalScorer } from '../src/benchmarks/ellipticScorers.js';
import { runBlindAmlBenchmark } from '../src/benchmarks/amlBenchmark.js';
import { binaryMetrics } from '../src/benchmarks/benchmarkMetrics.js';
import { selectOrientationAndThreshold, applyOrientation } from '../src/benchmarks/thresholdSelection.js';
import { selectConstrainedThreshold } from '../src/benchmarks/constrainedThresholdSelection.js';

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
  const validationScores = validation.results[name].scores;

  // Baseline: maximize F1 using validation only.
  const f1Selected = selectOrientationAndThreshold(validationLabels, validationScores, { objective: 'f1' });

  // Safety-constrained policy: require zero validation false negatives, then
  // maximize precision (F1 breaks ties). Test labels never influence selection.
  const constrainedSelected = selectConstrainedThreshold(validationLabels, validationScores, { minRecall: 1 });

  const test = await runBlindAmlBenchmark(split.test, { [name]: scorer }, { threshold: 0.5 });
  const testLabels = split.test.samples.map((s) => split.test.labels.get(s.id) || 'unknown');

  const f1TestScores = applyOrientation(test.results[name].scores, f1Selected.orientation);
  const constrainedTestScores = applyOrientation(test.results[name].scores, constrainedSelected.orientation);

  output.models[name] = {
    f1Optimal: {
      orientation: f1Selected.orientation,
      selectedThreshold: f1Selected.threshold,
      validation: f1Selected.metrics,
      test: binaryMetrics(testLabels, f1TestScores, f1Selected.threshold),
    },
    zeroFnConstrained: {
      minValidationRecall: 1,
      orientation: constrainedSelected.orientation,
      selectedThreshold: constrainedSelected.threshold,
      validation: constrainedSelected.metrics,
      test: binaryMetrics(testLabels, constrainedTestScores, constrainedSelected.threshold),
    },
  };
}
for (const [name, part] of Object.entries(split)) {
  if (name !== 'boundaries') output.counts[name] = { total: part.samples.length, known: part.knownSampleCount };
}

console.log(JSON.stringify(output, null, 2));
