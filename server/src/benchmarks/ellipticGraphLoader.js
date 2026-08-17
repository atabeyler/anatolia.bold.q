import { buildAdjacency } from './ellipticGraph.js';

export function createTransactionIndex(samples) {
  const timeById = new Map();
  const sampleById = new Map();
  const idsByTime = new Map();
  let minTime = Number.POSITIVE_INFINITY;
  let maxTime = Number.NEGATIVE_INFINITY;

  for (const sample of samples || []) {
    const id = String(sample.id);
    const timeStep = Number(sample.timeStep);
    if (Number.isFinite(timeStep)) {
      timeById.set(id, timeStep);
      minTime = Math.min(minTime, timeStep);
      maxTime = Math.max(maxTime, timeStep);
      let bucket = idsByTime.get(timeStep);
      if (!bucket) {
        bucket = [];
        idsByTime.set(timeStep, bucket);
      }
      bucket.push(id);
    }
    sampleById.set(id, sample);
  }

  return {
    timeById,
    sampleById,
    idsByTime,
    minTime: Number.isFinite(minTime) ? minTime : 0,
    maxTime: Number.isFinite(maxTime) ? maxTime : 0,
  };
}

export function createTemporalGraphContext(samples, edges) {
  const index = createTransactionIndex(samples);
  return {
    adjacency: buildAdjacency(edges),
    ...index,
    cutoffForId(id) {
      const timeStep = Number(index.timeById.get(String(id)));
      return Number.isFinite(timeStep) ? timeStep : Number.POSITIVE_INFINITY;
    },
  };
}

export function lookupSampleTime(context, id) {
  const timeStep = Number(context?.timeById?.get(String(id)));
  return Number.isFinite(timeStep) ? timeStep : Number.POSITIVE_INFINITY;
}
