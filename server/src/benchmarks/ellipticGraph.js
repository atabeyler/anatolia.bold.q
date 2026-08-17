/**
 * Elliptic transaction-flow graph structure.
 * Edge topology (who paid whom) is public/static and carries no ground-truth
 * label information, so it is built from the full edge list. Any *label*
 * pulled into a neighbor-aggregate feature, however, must come only from
 * known TRAIN labels -- never from validation/development/holdout labels --
 * otherwise a node's score would be built partly from another split's
 * ground truth, which is leakage even when it never touches threshold or
 * architecture selection.
 */

const EMPTY = new Set();

function nodeTime(timeById, id) {
  if (!(timeById instanceof Map)) return Number.POSITIVE_INFINITY;
  const value = Number(timeById.get(id));
  return Number.isFinite(value) ? value : Number.POSITIVE_INFINITY;
}

function cutoffTimeFor(id, opts) {
  if (Number.isFinite(opts.cutoffTime)) return Number(opts.cutoffTime);
  if (opts.timeById instanceof Map) {
    const t = Number(opts.timeById.get(id));
    if (Number.isFinite(t)) return t;
  }
  return Number.POSITIVE_INFINITY;
}

function historicalNeighbors(map, id, timeById, cutoff) {
  const neighbors = map.get(id);
  if (!neighbors || !neighbors.size) return EMPTY;
  if (!Number.isFinite(cutoff) && !(timeById instanceof Map)) return neighbors;
  const out = new Set();
  for (const neighbor of neighbors) {
    if (nodeTime(timeById, neighbor) <= cutoff) out.add(neighbor);
  }
  return out;
}

function degreeStats(ids, adjacency, timeById, cutoff) {
  if (!ids.length) return { mean: 0, min: 0, max: 0, std: 0 };
  let sum = 0;
  let sumSq = 0;
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const id of ids) {
    const inDegree = historicalNeighbors(adjacency.inn, id, timeById, cutoff).size;
    const outDegree = historicalNeighbors(adjacency.out, id, timeById, cutoff).size;
    const degree = inDegree + outDegree;
    sum += degree;
    sumSq += degree * degree;
    if (degree < min) min = degree;
    if (degree > max) max = degree;
  }
  const mean = sum / ids.length;
  const variance = Math.max(0, sumSq / ids.length - mean * mean);
  return { mean, min, max, std: Math.sqrt(variance) };
}

export function buildAdjacency(edges) {
  const out = new Map();
  const inn = new Map();
  const undirected = new Map();
  const add = (map, a, b) => {
    let set = map.get(a);
    if (!set) { set = new Set(); map.set(a, set); }
    set.add(b);
  };
  for (const [a, b] of edges) {
    if (!a || !b) continue;
    add(out, a, b);
    add(inn, b, a);
    add(undirected, a, b);
    add(undirected, b, a);
  }
  return { out, inn, undirected };
}

/** Known-label lookup restricted to one dataset part (illicit=1, licit=0). */
export function knownLabelMap(part) {
  const map = new Map();
  for (const sample of part.samples) {
    const label = part.labels.get(sample.id) || 'unknown';
    if (label === 'unknown') continue;
    map.set(sample.id, label === 'illicit' ? 1 : 0);
  }
  return map;
}

function oneHopStats(id, adjacency, trainLabelMap, timeById, cutoff) {
  const neighbors = historicalNeighbors(adjacency.undirected, id, timeById, cutoff);
  if (!neighbors.size) {
    return { count: 0, known: 0, illicit: 0, licit: 0, meanDegree: 0, stdDegree: 0, minDegree: 0, maxDegree: 0 };
  }
  let known = 0;
  let illicit = 0;
  let licit = 0;
  const neighborIds = [];
  for (const n of neighbors) {
    neighborIds.push(n);
    const y = trainLabelMap.get(n);
    if (y === undefined) continue;
    known++;
    if (y === 1) illicit++;
    else licit++;
  }
  const stats = degreeStats(neighborIds, adjacency, timeById, cutoff);
  return {
    count: neighbors.size,
    known,
    illicit,
    licit,
    meanDegree: stats.mean,
    stdDegree: stats.std,
    minDegree: stats.min,
    maxDegree: stats.max,
  };
}

/**
 * Deterministic graph feature vector for one node id. Every ratio is
 * computed against TRAIN-only known labels so the same feature function is
 * safe to call on train, validation, development, or holdout nodes without
 * leaking their own split's ground truth back into their score.
 */
export function graphFeatureVector(id, adjacency, trainLabelMap, opts = {}) {
  const cutoff = cutoffTimeFor(id, opts);
  const timeById = opts.timeById instanceof Map ? opts.timeById : null;
  const outNeighbors = historicalNeighbors(adjacency.out, id, timeById, cutoff);
  const inNeighbors = historicalNeighbors(adjacency.inn, id, timeById, cutoff);
  const allNeighbors = historicalNeighbors(adjacency.undirected, id, timeById, cutoff);
  const oneHop = oneHopStats(id, adjacency, trainLabelMap, timeById, cutoff);
  const historicalNeighborCount = oneHop.count;
  return [
    inNeighbors.size,
    outNeighbors.size,
    inNeighbors.size + outNeighbors.size,
    inNeighbors.size,
    outNeighbors.size,
    historicalNeighborCount,
    oneHop.known,
    oneHop.known ? oneHop.illicit / oneHop.known : 0,
    oneHop.known ? oneHop.licit / oneHop.known : 0,
    oneHop.meanDegree,
    oneHop.stdDegree,
    oneHop.minDegree,
    oneHop.maxDegree,
    allNeighbors.size,
  ];
}

/**
 * Personalized-PageRank-style label diffusion, seeded ONLY with TRAIN-known
 * labels. Every non-seed node's risk value is repeatedly re-averaged over its
 * current neighbor values, damped toward the train base rate each round, so
 * influence reaches many hops away without enumerating explicit k-hop
 * neighborhoods. Seed nodes stay pinned to their TRAIN label on every
 * iteration. The graph can optionally be truncated by time step so future
 * edges never contribute to a historical score.
 */
export function propagateIllicitRisk(adjacency, trainLabelMap, opts = {}) {
  const iterations = opts.iterations ?? 8;
  const restart = opts.restart ?? 0.15;
  const cutoff = Number.isFinite(opts.cutoffTime) ? Number(opts.cutoffTime) : Number.POSITIVE_INFINITY;
  const timeById = opts.timeById instanceof Map ? opts.timeById : null;
  let seedSum = 0;
  for (const y of trainLabelMap.values()) seedSum += y;
  const prior = trainLabelMap.size ? seedSum / trainLabelMap.size : 0.5;

  const nodes = new Set();
  for (const id of adjacency.undirected.keys()) {
    if (nodeTime(timeById, id) <= cutoff) nodes.add(id);
  }
  for (const id of trainLabelMap.keys()) {
    if (nodeTime(timeById, id) <= cutoff) nodes.add(id);
  }

  let field = new Map();
  for (const id of nodes) field.set(id, trainLabelMap.has(id) ? trainLabelMap.get(id) : prior);

  for (let iter = 0; iter < iterations; iter++) {
    const next = new Map();
    for (const id of nodes) {
      if (trainLabelMap.has(id)) { next.set(id, trainLabelMap.get(id)); continue; }
      const neighbors = historicalNeighbors(adjacency.undirected, id, timeById, cutoff);
      if (!neighbors || !neighbors.size) { next.set(id, field.get(id)); continue; }
      let sum = 0;
      for (const n of neighbors) sum += field.has(n) ? field.get(n) : prior;
      next.set(id, restart * prior + (1 - restart) * (sum / neighbors.size));
    }
    field = next;
  }
  return { field, prior };
}
