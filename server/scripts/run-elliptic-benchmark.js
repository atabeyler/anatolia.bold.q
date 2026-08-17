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
const output = { dataDir, boundaries: split.boundaries, counts: {}, models: {}, cascades: {} };
const raw = { validation: {}, test: {} };
const validationLabels = split.validation.samples.map((s) => split.validation.labels.get(s.id) || 'unknown');
const testLabels = split.test.samples.map((s) => split.test.labels.get(s.id) || 'unknown');

for (const [name, scorer] of Object.entries(scorers)) {
  const validation = await runBlindAmlBenchmark(split.validation, { [name]: scorer }, { threshold: 0.5 });
  raw.validation[name] = validation.results[name].scores;
  const f1Selected = selectOrientationAndThreshold(validationLabels, raw.validation[name], { objective: 'f1' });
  const constrainedSelected = selectConstrainedThreshold(validationLabels, raw.validation[name], { minRecall: 1 });
  const test = await runBlindAmlBenchmark(split.test, { [name]: scorer }, { threshold: 0.5 });
  raw.test[name] = test.results[name].scores;
  output.models[name] = {
    f1Optimal: { orientation: f1Selected.orientation, selectedThreshold: f1Selected.threshold, validation: f1Selected.metrics, test: binaryMetrics(testLabels, applyOrientation(raw.test[name], f1Selected.orientation), f1Selected.threshold) },
    zeroFnConstrained: { minValidationRecall: 1, orientation: constrainedSelected.orientation, selectedThreshold: constrainedSelected.threshold, validation: constrainedSelected.metrics, test: binaryMetrics(testLabels, applyOrientation(raw.test[name], constrainedSelected.orientation), constrainedSelected.threshold) },
  };
}

const cSel = selectConstrainedThreshold(validationLabels, raw.validation.classical, { minRecall: 1 });
const cVal = applyOrientation(raw.validation.classical, cSel.orientation);
const sOrient = selectOrientationAndThreshold(validationLabels, raw.validation.supervisedBalancedLinear, { objective: 'f1' }).orientation;
const sVal = applyOrientation(raw.validation.supervisedBalancedLinear, sOrient);

// Rolling temporal robustness: a gate is eligible only if it preserves zero FN
// independently in EVERY validation time step (30..39), not merely in aggregate.
// Among eligible gates, minimize aggregate validation FP. This explicitly guards
// against temporal drift while keeping test labels completely blind.
const validationTimes = split.validation.samples.map((s) => s.timeStep);
const candidateGates = [...new Set([0, ...sVal])].sort((a, b) => a - b);
let bestRollingGate = null;
for (const gate of candidateGates) {
  const scores = cVal.map((c, i) => (c >= cSel.threshold && sVal[i] >= gate) ? 1 : 0);
  let robust = true;
  const byTime = {};
  for (let t = split.boundaries.trainEnd + 1; t <= split.boundaries.validationEnd; t++) {
    const labels = [];
    const timeScores = [];
    for (let i = 0; i < validationTimes.length; i++) {
      if (validationTimes[i] !== t) continue;
      labels.push(validationLabels[i]);
      timeScores.push(scores[i]);
    }
    const m = binaryMetrics(labels, timeScores, 0.5);
    byTime[t] = m;
    if (m.fn !== 0) { robust = false; break; }
  }
  if (!robust) continue;
  const aggregate = binaryMetrics(validationLabels, scores, 0.5);
  if (!bestRollingGate || aggregate.fp < bestRollingGate.aggregate.fp) bestRollingGate = { gate, aggregate, byTime };
}

if (bestRollingGate) {
  const cTest = applyOrientation(raw.test.classical, cSel.orientation);
  const sTest = applyOrientation(raw.test.supervisedBalancedLinear, sOrient);
  const testScores = cTest.map((c, i) => (c >= cSel.threshold && sTest[i] >= bestRollingGate.gate) ? 1 : 0);
  output.cascades.temporalRollingZeroFnGate = {
    selectionBasis: 'validation-time-step-zero-FN', classicalThreshold: cSel.threshold, classicalOrientation: cSel.orientation,
    supervisedOrientation: sOrient, supervisedGate: bestRollingGate.gate, validation: bestRollingGate.aggregate,
    validationByTimeStep: bestRollingGate.byTime, test: binaryMetrics(testLabels, testScores, 0.5),
  };
}

for (const [name, part] of Object.entries(split)) if (name !== 'boundaries') output.counts[name] = { total: part.samples.length, known: part.knownSampleCount };
console.log(JSON.stringify(output, null, 2));
