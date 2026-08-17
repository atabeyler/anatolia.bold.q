import { binaryMetrics } from './benchmarkMetrics.js';
import { applyOrientation, selectConstrainedThreshold, selectOrientationAndThreshold } from './thresholdSelection.js';

const DEFAULT_QUANTILES = [0, 0.01, 0.02, 0.03, 0.05, 0.075, 0.1, 0.15];

export function labelsFor(partition) {
  return partition.samples.map((sample) => partition.labels.get(sample.id) || 'unknown');
}

export function assertSelectionPartition(partition, allowedNames) {
  if (!partition || typeof partition !== 'object') throw new TypeError('invalid partition');
  if (!allowedNames.includes(partition.name)) {
    throw new Error(`selection is not allowed to read ${partition.name ?? 'unknown'} data`);
  }
}

export function quantile(values, q) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const index = Math.floor(q * (sorted.length - 1));
  return sorted[Math.max(0, Math.min(sorted.length - 1, index))];
}

export function buildThresholdGrid(labels, scores, quantiles = DEFAULT_QUANTILES) {
  const illicit = scores.filter((_, index) => labels[index] === 'illicit');
  return [...new Set(quantiles.map((q) => quantile(illicit, q)))];
}

function predictConsensus(scoresByName, thresholdsByName, classicalThreshold, voterNames, need) {
  const scores = scoresByName.classical;
  return scores.map((score, index) => {
    if (score < classicalThreshold) return 0;
    let low = 0;
    for (const name of voterNames) if (scoresByName[name][index] < thresholdsByName[name]) low++;
    return low >= need ? 0 : 1;
  });
}

export function searchConsensusPolicy({
  validation,
  development,
  classicalThreshold,
  scoresByName,
  voterNames,
  needs,
  quantiles = DEFAULT_QUANTILES,
}) {
  assertSelectionPartition(validation, ['validation']);
  assertSelectionPartition(development, ['developmentTest']);
  const validationLabels = labelsFor(validation);
  const developmentLabels = labelsFor(development);
  const thresholdsByName = Object.fromEntries(voterNames.map((name) => [name, buildThresholdGrid(validationLabels, scoresByName.validation[name], quantiles)]));
  const candidates = [];

  for (const need of needs) {
    for (const thresholds of cartesianThresholds(voterNames.map((name) => thresholdsByName[name]))) {
      const gateThresholds = Object.fromEntries(voterNames.map((name, index) => [name, thresholds[index]]));
      const validationPred = predictConsensus(scoresByName.validation, gateThresholds, classicalThreshold, voterNames, need);
      const validationMetrics = binaryMetrics(validationLabels, validationPred.map((x) => x ? 1 : 0), 0.5);
      if (validationMetrics.fn !== 0) continue;
      const developmentPred = predictConsensus(scoresByName.development, gateThresholds, classicalThreshold, voterNames, need);
      const developmentMetrics = binaryMetrics(developmentLabels, developmentPred.map((x) => x ? 1 : 0), 0.5);
      if (developmentMetrics.fn !== 0) continue;
      candidates.push({ need, gateThresholds, validation: validationMetrics, developmentTest: developmentMetrics });
    }
  }

  candidates.sort((a, b) =>
    (a.validation.fp + a.developmentTest.fp) - (b.validation.fp + b.developmentTest.fp) ||
    a.validation.f1 - b.validation.f1 ||
    a.need - b.need);

  return candidates[0] || null;
}

function cartesianThresholds(arrays) {
  if (!arrays.length) return [[]];
  const [head, ...tail] = arrays;
  const rest = cartesianThresholds(tail);
  const out = [];
  for (const value of head) for (const combo of rest) out.push([value, ...combo]);
  return out;
}

export function selectGraphOnlyPolicy({ validation, development, scoresBySplit }) {
  assertSelectionPartition(validation, ['validation']);
  assertSelectionPartition(development, ['developmentTest']);
  const validationLabels = labelsFor(validation);
  const developmentLabels = labelsFor(development);
  const orientation = selectOrientationAndThreshold(validationLabels, scoresBySplit.validation, { objective: 'f1', minRecall: 1 });
  const validationScores = applyOrientation(scoresBySplit.validation, orientation.orientation);
  const developmentScores = applyOrientation(scoresBySplit.developmentTest, orientation.orientation);
  const thresholds = buildThresholdGrid(validationLabels, validationScores);
  const candidates = [];
  for (const threshold of thresholds) {
    const validationMetrics = binaryMetrics(validationLabels, validationScores, threshold);
    if (validationMetrics.fn !== 0) continue;
    const developmentMetrics = binaryMetrics(developmentLabels, developmentScores, threshold);
    if (developmentMetrics.fn !== 0) continue;
    candidates.push({ orientation: orientation.orientation, threshold, validation: validationMetrics, developmentTest: developmentMetrics });
  }
  candidates.sort((a, b) => (a.validation.fp + a.developmentTest.fp) - (b.validation.fp + b.developmentTest.fp) || a.threshold - b.threshold);
  return candidates[0] || null;
}

export function selectFpVetoPolicy({
  validation,
  development,
  basePredictions,
  discriminatorScores,
  thresholds = DEFAULT_QUANTILES,
}) {
  assertSelectionPartition(validation, ['validation']);
  assertSelectionPartition(development, ['developmentTest']);
  const validationLabels = labelsFor(validation);
  const developmentLabels = labelsFor(development);
  const illicit = discriminatorScores.validation.filter((_, index) => validationLabels[index] === 'illicit');
  const candidates = [...new Set(thresholds.map((q) => quantile(illicit, q)))];
  const selected = [];

  for (const threshold of candidates) {
    const validationPred = basePredictions.validation.map((pred, index) => pred && discriminatorScores.validation[index] >= threshold ? 1 : 0);
    const validationMetrics = binaryMetrics(validationLabels, validationPred, 0.5);
    if (validationMetrics.fn !== 0) continue;
    const developmentPred = basePredictions.development.map((pred, index) => pred && discriminatorScores.development[index] >= threshold ? 1 : 0);
    const developmentMetrics = binaryMetrics(developmentLabels, developmentPred, 0.5);
    if (developmentMetrics.fn !== 0) continue;
    selected.push({ threshold, validation: validationMetrics, developmentTest: developmentMetrics });
  }

  selected.sort((a, b) => (a.validation.fp + a.developmentTest.fp) - (b.validation.fp + b.developmentTest.fp) || a.threshold - b.threshold);
  return selected[0] || null;
}

export function evaluateScores(partition, scores, threshold = 0.5) {
  const labels = labelsFor(partition);
  return binaryMetrics(labels, scores, threshold);
}

export function orientScoresForSplits(labelsBySplit, rawScoresBySplit, scorerNames, objective = 'f1') {
  const oriented = {};
  const orientations = {};
  const thresholds = {};
  for (const name of scorerNames) {
    const selection = selectOrientationAndThreshold(labelsBySplit.validation, rawScoresBySplit.validation[name], { objective });
    orientations[name] = selection.orientation;
    thresholds[name] = selection.threshold;
    oriented[name] = {};
    for (const split of Object.keys(rawScoresBySplit)) {
      oriented[name][split] = applyOrientation(rawScoresBySplit[split][name], selection.orientation);
    }
  }
  return { oriented, orientations, thresholds };
}

export function selectClassicalThreshold(validation) {
  assertSelectionPartition(validation, ['validation']);
  const labels = labelsFor(validation);
  return selectConstrainedThreshold(labels, validation.scores, { minRecall: 1 });
}
