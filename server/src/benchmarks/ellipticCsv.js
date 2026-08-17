import fs from 'node:fs';
import readline from 'node:readline';
import path from 'node:path';
import { normalizeEllipticLabel } from './ellipticAdapter.js';

function parseCsvLine(line) {
  const out = []; let cell = ''; let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (quoted && line[i + 1] === '"') { cell += '"'; i++; } else quoted = !quoted;
    } else if (c === ',' && !quoted) { out.push(cell); cell = ''; }
    else cell += c;
  }
  out.push(cell);
  return out;
}

/** Streams a CSV line-by-line (never buffers the whole file) so multi-hundred-MB
 * exports like the official Elliptic features CSV don't exceed Node's per-string
 * length ceiling (~512MB, buffer.constants.MAX_STRING_LENGTH). */
async function forEachCsvLine(filePath, onLine) {
  const rl = readline.createInterface({ input: fs.createReadStream(filePath, { encoding: 'utf8' }), crlfDelay: Infinity });
  let index = 0;
  for await (const line of rl) {
    if (line.length) onLine(parseCsvLine(line), index++);
  }
}

/** Headered CSV (e.g. elliptic_txs_classes.csv: "txId,class"). */
async function readHeaderedCsv(filePath) {
  const rows = [];
  let header = null;
  await forEachCsvLine(filePath, (values, i) => {
    if (i === 0) { header = values; return; }
    rows.push(Object.fromEntries(header.map((key, j) => [key, values[j]])));
  });
  return rows;
}

/** The official elliptic_txs_features.csv ships with NO header row: every line
 * (including the first) is txId, time_step, then 165 numeric features. Parses
 * straight into a Float32Array per sample -- boxed JS number arrays for
 * ~203k x 165 values plus the raw string rows they were built from was enough
 * to blow an 8GB heap; typed arrays skip that intermediate copy entirely. */
async function readFeatureSamples(filePath) {
  const samples = [];
  await forEachCsvLine(filePath, (values) => {
    const features = new Float32Array(values.length - 2);
    for (let i = 2; i < values.length; i++) {
      const n = Number(values[i]);
      features[i - 2] = Number.isFinite(n) ? n : 0;
    }
    samples.push({ id: values[0], source: 'elliptic', timeStep: Number(values[1]), features });
  });
  return samples;
}

export async function loadEllipticDataset(dataDir) {
  const featuresPath = path.join(dataDir, 'elliptic_txs_features.csv');
  const classesPath = path.join(dataDir, 'elliptic_txs_classes.csv');
  const [samples, classObjects] = await Promise.all([
    readFeatureSamples(featuresPath),
    readHeaderedCsv(classesPath),
  ]);

  const labels = new Map(
    classObjects.map((row) => [String(row.txId ?? row.txid), normalizeEllipticLabel(row.class ?? row.label)])
  );

  return {
    samples,
    labels,
    knownSampleCount: samples.reduce((n, s) => n + (labels.get(s.id) !== 'unknown' ? 1 : 0), 0),
  };
}

/** Chronological split: no future time step may enter reference/validation. */
export function temporalSplit(dataset, opts = {}) {
  const trainEnd = opts.trainEnd ?? 29;
  const validationEnd = opts.validationEnd ?? 39;
  if (trainEnd >= validationEnd) throw new Error('trainEnd must be below validationEnd');

  const subset = (predicate) => {
    const samples = dataset.samples.filter((s) => Number.isFinite(s.timeStep) && predicate(s.timeStep));
    const labels = new Map(samples.map((s) => [s.id, dataset.labels.get(s.id) || 'unknown']));
    return { samples, labels, knownSampleCount: samples.filter((s) => labels.get(s.id) !== 'unknown').length };
  };

  return {
    train: subset((t) => t <= trainEnd),
    validation: subset((t) => t > trainEnd && t <= validationEnd),
    test: subset((t) => t > validationEnd),
    boundaries: { trainEnd, validationEnd },
  };
}
