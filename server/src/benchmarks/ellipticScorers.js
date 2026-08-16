/**
 * Scorers for Elliptic's 166 numeric transaction features.
 * These are benchmark-specific adapters; they do not pretend Elliptic exposes
 * bank-account behavioral fields required by the production 13Q AML service.
 */

function sigmoid(x) { return 1 / (1 + Math.exp(-x)); }

export function createRobustClassicalScorer(referenceSamples) {
  const matrix = referenceSamples.map((s) => s.features);
  const width = Math.max(0, ...matrix.map((r) => r.length));
  const stats = Array.from({ length: width }, (_, j) => {
    const xs = matrix.map((r) => Number(r[j])).filter(Number.isFinite).sort((a, b) => a - b);
    if (!xs.length) return { median: 0, mad: 1 };
    const median = xs[Math.floor(xs.length / 2)];
    const dev = xs.map((x) => Math.abs(x - median)).sort((a, b) => a - b);
    const mad = dev[Math.floor(dev.length / 2)] || 1;
    return { median, mad };
  });

  return async (sample) => {
    const zs = sample.features.map((value, j) => Math.abs((Number(value) - stats[j].median) / (1.4826 * stats[j].mad || 1)));
    if (!zs.length) return 0;
    zs.sort((a, b) => b - a);
    const top = zs.slice(0, Math.min(8, zs.length));
    const robustOutlier = top.reduce((a, b) => a + Math.min(b, 12), 0) / top.length;
    return sigmoid((robustOutlier - 2.5) / 1.5);
  };
}

/** Deterministic nonlinear 5D feature-map proxy for the existing 5Q kernel. */
export function createElliptic5QScorer(referenceSamples) {
  const classical = createRobustClassicalScorer(referenceSamples);
  return async (sample) => {
    const base = await classical(sample);
    const f = sample.features;
    if (!f.length) return base;
    const projected = [0, 1, 2, 3, 4].map((q) => {
      let sum = 0;
      for (let i = q; i < f.length; i += 5) sum += Math.sin(Number(f[i]) * (q + 1)) + Math.cos(Number(f[i]) * 0.5);
      return sum / Math.ceil(f.length / 5);
    });
    const coherence = projected.reduce((s, x) => s + Math.abs(Math.sin(x)), 0) / 5;
    return Math.max(0, Math.min(1, 0.75 * base + 0.25 * coherence));
  };
}

/** Deterministic nonlinear 13D proxy used only to test feature-map dimensionality on Elliptic. */
export function createElliptic13QScorer(referenceSamples) {
  const classical = createRobustClassicalScorer(referenceSamples);
  return async (sample) => {
    const base = await classical(sample);
    const f = sample.features;
    if (!f.length) return base;
    const projected = Array.from({ length: 13 }, (_, q) => {
      let sum = 0; let n = 0;
      for (let i = q; i < f.length; i += 13) { sum += Math.sin(Number(f[i]) * (q + 1) / 3) + Math.cos(Number(f[i]) * (q + 2) / 7); n++; }
      return n ? sum / n : 0;
    });
    const coherence = projected.reduce((s, x) => s + Math.abs(Math.sin(x)), 0) / 13;
    return Math.max(0, Math.min(1, 0.7 * base + 0.3 * coherence));
  };
}
