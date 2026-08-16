import path from 'node:path';
import { loadEllipticDataset, temporalSplit } from '../src/benchmarks/ellipticCsv.js';
import { createElliptic5QScorer, createElliptic13QScorer, createRobustClassicalScorer } from '../src/benchmarks/ellipticScorers.js';
import { runBlindAmlBenchmark } from '../src/benchmarks/amlBenchmark.js';
import { selectThreshold } from '../src/benchmarks/thresholdSelection.js';

const dataDir = path.resolve(process.argv[2] || process.env.ELLIPTIC_DATA_DIR || './data/elliptic');
const dataset = await loadEllipticDataset(dataDir);
const split = temporalSplit(dataset);

const factories = {
  classical: createRobustClassicalScorer,
  elliptic5DProxy: createElliptic5QScorer,
  elliptic13DProxy: createElliptic13QScorer,
};

const output = { dataDir, boundaries: split.boundaries, counts: {}, models: {} };
for (const [name, factory] of Object.entries(factories)) {
  const scorer = factory(split.train.samples);
  const validation = await runBlindAmlBenchmark(split.validation, { [name]: scorer }, { threshold: 0.5 });
  const v = validation.results[name];
  const validationLabels = split.validation.samples.map((s) => split.validation.labels.get(s.id) || 'unknown');
  const selected = selectThreshold(validationLabels, v.scores, { objective: 'f1' });
  const test = await runBlindAmlBenchmark(split.test, { [name]: scorer }, { threshold: selected.threshold });
  output.models[name] = {
    selectedThreshold: selected.threshold,
    validation: selected.metrics,
    test: test.results[name].metrics,
  };
}
for (const [name, part] of Object.entries(split)) {
  if (name !== 'boundaries') output.counts[name] = { total: part.samples.length, known: part.knownSampleCount };
}

console.log(JSON.stringify(output, null, 2));
