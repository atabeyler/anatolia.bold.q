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
const output = { dataDir, boundaries: split.boundaries, counts: {}, models: {}, cascades: {}, diagnostics: {} };
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
const validationTimes = split.validation.samples.map((s) => s.timeStep);
const candidateGates = [...new Set([0, ...sVal])].sort((a, b) => a - b);
let bestRollingGate = null;
for (const gate of candidateGates) {
  const scores = cVal.map((c, i) => (c >= cSel.threshold && sVal[i] >= gate) ? 1 : 0);
  let robust = true;
  const byTime = {};
  for (let t = split.boundaries.trainEnd + 1; t <= split.boundaries.validationEnd; t++) {
    const labels = [], timeScores = [];
    for (let i = 0; i < validationTimes.length; i++) if (validationTimes[i] === t) { labels.push(validationLabels[i]); timeScores.push(scores[i]); }
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
  const q5Test = raw.test.elliptic5DProxy;
  const q13Test = raw.test.elliptic13DProxy;
  const testScores = cTest.map((c, i) => (c >= cSel.threshold && sTest[i] >= bestRollingGate.gate) ? 1 : 0);
  output.cascades.temporalRollingZeroFnGate = {
    selectionBasis: 'validation-time-step-zero-FN', classicalThreshold: cSel.threshold, classicalOrientation: cSel.orientation,
    supervisedOrientation: sOrient, supervisedGate: bestRollingGate.gate, validation: bestRollingGate.aggregate,
    validationByTimeStep: bestRollingGate.byTime, test: binaryMetrics(testLabels, testScores, 0.5),
  };

  // Diagnostic only: expose the blind-test false negatives after evaluation.
  // These values MUST NOT be consumed by threshold/gate selection above.
  const misses = [];
  for (let i = 0; i < testLabels.length; i++) {
    if (testLabels[i] !== 'illicit' || testScores[i] >= 0.5) continue;
    const sample = split.test.samples[i];
    misses.push({
      id: sample.id,
      timeStep: sample.timeStep,
      classicalScore: cTest[i],
      classicalMargin: cTest[i] - cSel.threshold,
      supervisedScore: sTest[i],
      supervisedGateMargin: sTest[i] - bestRollingGate.gate,
      elliptic5DProxyScore: q5Test[i],
      elliptic13DProxyScore: q13Test[i],
      featureHead: Array.isArray(sample.features) ? sample.features.slice(0, 12) : [],
    });
  }
  const byTimeStep = {};
  for (const miss of misses) byTimeStep[miss.timeStep] = (byTimeStep[miss.timeStep] || 0) + 1;
  output.diagnostics.cascadeFalseNegatives = {
    purpose: 'post-evaluation-error-analysis-only',
    prohibitedUse: 'do-not-select-or-tune-model-thresholds-from-test-labels',
    count: misses.length,
    byTimeStep,
    misses,
  };
}

for (const [name, part] of Object.entries(split)) if (name !== 'boundaries') output.counts[name] = { total: part.samples.length, known: part.knownSampleCount };
console.log(JSON.stringify(output, null, 2));
