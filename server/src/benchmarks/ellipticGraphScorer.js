import { buildAdjacency, graphFeatureVector, knownLabelMap, propagateIllicitRisk } from './ellipticGraph.js';
import { createTemporalGraphContext, lookupSampleTime } from './ellipticGraphLoader.js';

function sigmoid(x) { return 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, x)))); }

function resolveGraphContext(trainPart, graphInput, opts = {}) {
  if (graphInput && typeof graphInput === 'object' && !Array.isArray(graphInput) && graphInput.adjacency) {
    return graphInput;
  }
  const edges = Array.isArray(graphInput) ? graphInput : [];
  const samples = opts.allSamples || trainPart.samples;
  const temporalContext = createTemporalGraphContext(samples, edges);
  return {
    adjacency: buildAdjacency(edges),
    ...temporalContext,
  };
}

/**
 * Supervised voter fit purely on Elliptic transaction-graph topology.
 * Neighbor-label ratios and diffusion fields are computed from TRAIN-known
 * labels only, regardless of which split the queried node belongs to.
 */
export function createGraphAwareScorer(trainPart, graphInput, opts = {}) {
  const context = resolveGraphContext(trainPart, graphInput, opts);
  const trainLabelMap = knownLabelMap(trainPart);
  const propagationOpts = opts.propagation || {};
  const riskFieldCache = new Map();

  const getRiskField = (cutoffTime) => {
    const key = Number.isFinite(cutoffTime) ? cutoffTime : 'all';
    if (!riskFieldCache.has(key)) {
      const { field, prior } = propagateIllicitRisk(context.adjacency, trainLabelMap, {
        ...propagationOpts,
        timeById: context.timeById,
        cutoffTime,
      });
      riskFieldCache.set(key, { field, prior });
    }
    return riskFieldCache.get(key);
  };

  const featureVector = (id) => {
    const cutoffTime = lookupSampleTime(context, id);
    const { field: riskField, prior: riskPrior } = getRiskField(cutoffTime);
    return [
      ...graphFeatureVector(id, context.adjacency, trainLabelMap, {
        timeById: context.timeById,
        cutoffTime,
      }),
      riskField.has(id) ? riskField.get(id) : riskPrior,
    ];
  };

  const rows = [];
  for (const sample of trainPart.samples) {
    const label = trainPart.labels.get(sample.id) || 'unknown';
    if (label === 'unknown') continue;
    rows.push({ x: featureVector(sample.id), y: label === 'illicit' ? 1 : 0 });
  }
  if (!rows.length) throw new Error('no known labeled training rows');

  const width = rows[0].x.length;
  const mean = new Float64Array(width);
  const variance = new Float64Array(width);
  for (const r of rows) for (let j = 0; j < width; j++) mean[j] += r.x[j];
  for (let j = 0; j < width; j++) mean[j] /= rows.length;
  for (const r of rows) for (let j = 0; j < width; j++) { const d = r.x[j] - mean[j]; variance[j] += d * d; }
  const scale = new Float64Array(width);
  for (let j = 0; j < width; j++) scale[j] = Math.sqrt(variance[j] / Math.max(1, rows.length - 1)) || 1;

  const positives = rows.reduce((n, r) => n + r.y, 0);
  const negatives = rows.length - positives;
  const posWeight = positives ? rows.length / (2 * positives) : 1;
  const negWeight = negatives ? rows.length / (2 * negatives) : 1;
  const weights = new Float64Array(width);
  let bias = 0;
  const epochs = opts.epochs ?? 60;
  const lr = opts.learningRate ?? 0.08;
  const l2 = opts.l2 ?? 1e-4;

  for (let epoch = 0; epoch < epochs; epoch++) {
    const grad = new Float64Array(width);
    let gradBias = 0;
    for (const r of rows) {
      let z = bias;
      for (let j = 0; j < width; j++) z += weights[j] * ((r.x[j] - mean[j]) / scale[j]);
      const p = sigmoid(z);
      const cw = r.y ? posWeight : negWeight;
      const err = cw * (p - r.y);
      gradBias += err;
      for (let j = 0; j < width; j++) grad[j] += err * ((r.x[j] - mean[j]) / scale[j]);
    }
    const step = lr / rows.length;
    bias -= step * gradBias;
    for (let j = 0; j < width; j++) weights[j] -= step * (grad[j] + l2 * rows.length * weights[j]);
  }

  return async (sample) => {
    const x = featureVector(sample.id);
    let z = bias;
    for (let j = 0; j < width; j++) z += weights[j] * ((x[j] - mean[j]) / scale[j]);
    return sigmoid(z);
  };
}
