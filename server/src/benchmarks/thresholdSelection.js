import { binaryMetrics } from './benchmarkMetrics.js';

/** Select threshold on validation data only. Never pass test labels here. */
export function selectThreshold(validationLabels, validationScores, opts = {}) {
  const objective = opts.objective || 'f1';
  const minRecall = opts.minRecall ?? 0;
  let best = null;
  for (let i = 1; i < 100; i++) {
    const threshold = i / 100;
    const metrics = binaryMetrics(validationLabels, validationScores, threshold);
    if (metrics.recall < minRecall) continue;
    const value = Number(metrics[objective] ?? metrics.f1);
    if (!best || value > best.value || (value === best.value && threshold > best.threshold)) {
      best = { threshold, value, metrics };
    }
  }
  return best || { threshold: 0.5, value: 0, metrics: binaryMetrics(validationLabels, validationScores, 0.5) };
}
