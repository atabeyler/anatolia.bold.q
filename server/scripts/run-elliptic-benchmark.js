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
const output = { dataDir, boundaries: split.boundaries, counts: {}, models: {}, ensembles: {}, cascades: {} };
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

let bestEnsemble = null;
for (let i = 0; i <= 20; i++) {
  const supervisedWeight = i / 20;
  const classicalWeight = 1 - supervisedWeight;
  const scores = raw.validation.classical.map((s, idx) => classicalWeight * s + supervisedWeight * raw.validation.supervisedBalancedLinear[idx]);
  const selected = selectConstrainedThreshold(validationLabels, scores, { minRecall: 1 });
  if (!bestEnsemble || selected.metrics.precision > bestEnsemble.selected.metrics.precision) bestEnsemble = { classicalWeight, supervisedWeight, selected };
}
const ensembleTestRaw = raw.test.classical.map((s, idx) => bestEnsemble.classicalWeight * s + bestEnsemble.supervisedWeight * raw.test.supervisedBalancedLinear[idx]);
output.ensembles.classicalSupervisedZeroFn = {
  selectionBasis: 'validation-only', classicalWeight: bestEnsemble.classicalWeight, supervisedWeight: bestEnsemble.supervisedWeight,
  orientation: bestEnsemble.selected.orientation, selectedThreshold: bestEnsemble.selected.threshold, validation: bestEnsemble.selected.metrics,
  test: binaryMetrics(testLabels, applyOrientation(ensembleTestRaw, bestEnsemble.selected.orientation), bestEnsemble.selected.threshold),
};

// Cascade: stage 1 is the classical validation-selected zero-FN safety net.
// Stage 2 may remove a stage-1 alert only when supervised evidence is below a
// validation-selected gate. We choose the most aggressive gate that STILL has
// zero validation FN. Test labels are not used for gate selection.
const cSel = selectConstrainedThreshold(validationLabels, raw.validation.classical, { minRecall: 1 });
const cVal = applyOrientation(raw.validation.classical, cSel.orientation);
const sOrient = selectOrientationAndThreshold(validationLabels, raw.validation.supervisedBalancedLinear, { objective: 'f1' }).orientation;
const sVal = applyOrientation(raw.validation.supervisedBalancedLinear, sOrient);
const candidateGates = [...new Set([0, 1, ...sVal])].sort((a, b) => a - b);
let bestGate = null;
for (const gate of candidateGates) {
  const cascadeScores = cVal.map((c, i) => (c >= cSel.threshold && sVal[i] >= gate) ? 1 : 0);
  const m = binaryMetrics(validationLabels, cascadeScores, 0.5);
  if (m.fn !== 0) continue;
  if (!bestGate || m.fp < bestGate.metrics.fp || (m.fp === bestGate.metrics.fp && m.precision > bestGate.metrics.precision)) bestGate = { gate, metrics: m };
}
if (bestGate) {
  const cTest = applyOrientation(raw.test.classical, cSel.orientation);
  const sTest = applyOrientation(raw.test.supervisedBalancedLinear, sOrient);
  const cascadeTestScores = cTest.map((c, i) => (c >= cSel.threshold && sTest[i] >= bestGate.gate) ? 1 : 0);
  output.cascades.classicalSafetySupervisedGate = {
    selectionBasis: 'validation-only', classicalThreshold: cSel.threshold, classicalOrientation: cSel.orientation,
    supervisedOrientation: sOrient, supervisedGate: bestGate.gate, validation: bestGate.metrics,
    test: binaryMetrics(testLabels, cascadeTestScores, 0.5),
  };
}

for (const [name, part] of Object.entries(split)) if (name !== 'boundaries') output.counts[name] = { total: part.samples.length, known: part.knownSampleCount };
console.log(JSON.stringify(output, null, 2));
