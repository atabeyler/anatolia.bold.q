import path from 'node:path';
import { loadEllipticDataset, temporalSplit } from '../src/benchmarks/ellipticCsv.js';
import { createElliptic5QScorer, createElliptic13QScorer, createRobustClassicalScorer } from '../src/benchmarks/ellipticScorers.js';
import { createBalancedLinearScorer } from '../src/benchmarks/supervisedLinearScorer.js';
import { runBlindAmlBenchmark } from '../src/benchmarks/amlBenchmark.js';
import { binaryMetrics } from '../src/benchmarks/benchmarkMetrics.js';
import { selectOrientationAndThreshold, applyOrientation } from '../src/benchmarks/thresholdSelection.js';
import { selectConstrainedThreshold } from '../src/benchmarks/constrainedThresholdSelection.js';

const dataDir = path.resolve(process.argv[2] || process.env.ELLIPTIC_DATA_DIR || './data/elliptic');
const dataset = await loadEllipticDataset(dataDir);
const split = temporalSplit(dataset);

const scorers = {
  classical: createRobustClassicalScorer(split.train.samples),
  elliptic5DProxy: createElliptic5QScorer(split.train.samples),
  elliptic13DProxy: createElliptic13QScorer(split.train.samples),
  supervisedBalancedLinear: createBalancedLinearScorer(split.train),
};

const output = { dataDir, boundaries: split.boundaries, counts: {}, models: {}, ensembles: {} };
const raw = { validation: {}, test: {} };
const validationLabels = split.validation.samples.map((s) => split.validation.labels.get(s.id) || 'unknown');
const testLabels = split.test.samples.map((s) => split.test.labels.get(s.id) || 'unknown');

for (const [name, scorer] of Object.entries(scorers)) {
  const validation = await runBlindAmlBenchmark(split.validation, { [name]: scorer }, { threshold: 0.5 });
  const validationScores = validation.results[name].scores;
  raw.validation[name] = validationScores;
  const f1Selected = selectOrientationAndThreshold(validationLabels, validationScores, { objective: 'f1' });
  const constrainedSelected = selectConstrainedThreshold(validationLabels, validationScores, { minRecall: 1 });

  const test = await runBlindAmlBenchmark(split.test, { [name]: scorer }, { threshold: 0.5 });
  raw.test[name] = test.results[name].scores;
  const f1TestScores = applyOrientation(raw.test[name], f1Selected.orientation);
  const constrainedTestScores = applyOrientation(raw.test[name], constrainedSelected.orientation);

  output.models[name] = {
    f1Optimal: { orientation: f1Selected.orientation, selectedThreshold: f1Selected.threshold, validation: f1Selected.metrics, test: binaryMetrics(testLabels, f1TestScores, f1Selected.threshold) },
    zeroFnConstrained: { minValidationRecall: 1, orientation: constrainedSelected.orientation, selectedThreshold: constrainedSelected.threshold, validation: constrainedSelected.metrics, test: binaryMetrics(testLabels, constrainedTestScores, constrainedSelected.threshold) },
  };
}

// Ensemble weights are selected ONLY on validation. Test is evaluated once with
// the winning validation policy. This prevents test-label tuning/leakage.
let bestEnsemble = null;
for (let i = 0; i <= 20; i++) {
  const supervisedWeight = i / 20;
  const classicalWeight = 1 - supervisedWeight;
  const validationScores = raw.validation.classical.map((score, idx) =>
    classicalWeight * score + supervisedWeight * raw.validation.supervisedBalancedLinear[idx]);
  const selected = selectConstrainedThreshold(validationLabels, validationScores, { minRecall: 1 });
  const candidate = { classicalWeight, supervisedWeight, selected };
  if (!bestEnsemble ||
      selected.metrics.precision > bestEnsemble.selected.metrics.precision + 1e-12 ||
      (Math.abs(selected.metrics.precision - bestEnsemble.selected.metrics.precision) <= 1e-12 && selected.metrics.f1 > bestEnsemble.selected.metrics.f1)) {
    bestEnsemble = candidate;
  }
}

const ensembleTestRaw = raw.test.classical.map((score, idx) =>
  bestEnsemble.classicalWeight * score + bestEnsemble.supervisedWeight * raw.test.supervisedBalancedLinear[idx]);
const ensembleTestScores = applyOrientation(ensembleTestRaw, bestEnsemble.selected.orientation);
output.ensembles.classicalSupervisedZeroFn = {
  selectionBasis: 'validation-only',
  classicalWeight: bestEnsemble.classicalWeight,
  supervisedWeight: bestEnsemble.supervisedWeight,
  orientation: bestEnsemble.selected.orientation,
  selectedThreshold: bestEnsemble.selected.threshold,
  validation: bestEnsemble.selected.metrics,
  test: binaryMetrics(testLabels, ensembleTestScores, bestEnsemble.selected.threshold),
};

for (const [name, part] of Object.entries(split)) {
  if (name !== 'boundaries') output.counts[name] = { total: part.samples.length, known: part.knownSampleCount };
}
console.log(JSON.stringify(output, null, 2));
