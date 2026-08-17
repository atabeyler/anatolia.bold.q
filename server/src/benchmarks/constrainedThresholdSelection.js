import { binaryMetrics } from './benchmarkMetrics.js';
import { applyOrientation } from './thresholdSelection.js';

function knownPairs(labels, scores) {
  const out = [];
  for (let i = 0; i < labels.length; i++) {
    if (labels[i] === 'unknown') continue;
    out.push({ label: labels[i], score: Number(scores[i]) });
  }
  return out.filter((x) => Number.isFinite(x.score));
}

/**
 * Select a threshold on validation data subject to a minimum illicit recall.
 * Orientation uses the same numeric convention as applyOrientation():
 *   +1 = normal score, -1 = inverted score.
 *
 * The primary ANATOLIA-Q AML objective is no missed known-illicit samples
 * (minRecall=1). Among feasible thresholds, precision is maximized; F1 then
 * breaks ties. Test labels must never be passed to this function.
 */
export function selectConstrainedThreshold(labels, scores, opts = {}) {
  const minRecall = opts.minRecall ?? 1;
  const orientations = opts.orientations ?? [1, -1];
  let best = null;

  for (const orientation of orientations) {
    const oriented = applyOrientation(scores, orientation);
    const pairs = knownPairs(labels, oriented);
    const thresholds = [...new Set([0, 1, ...pairs.map((x) => x.score)])].sort((a, b) => a - b);

    for (const threshold of thresholds) {
      const metrics = binaryMetrics(labels, oriented, threshold);
      if (!Number.isFinite(metrics.recall) || metrics.recall + 1e-12 < minRecall) continue;
      const candidate = { orientation, threshold, metrics };
      if (!best ||
          metrics.precision > best.metrics.precision + 1e-12 ||
          (Math.abs(metrics.precision - best.metrics.precision) <= 1e-12 && metrics.f1 > best.metrics.f1 + 1e-12) ||
          (Math.abs(metrics.precision - best.metrics.precision) <= 1e-12 && Math.abs(metrics.f1 - best.metrics.f1) <= 1e-12 && threshold > best.threshold)) {
        best = candidate;
      }
    }
  }

  if (!best) throw new Error(`no validation threshold satisfies minRecall=${minRecall}`);
  return best;
}
