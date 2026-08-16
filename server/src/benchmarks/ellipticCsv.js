import fs from 'node:fs/promises';
import path from 'node:path';
import { adaptEllipticRows } from './ellipticAdapter.js';

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

async function readCsv(filePath) {
  const text = await fs.readFile(filePath, 'utf8');
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [];
  const header = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    return Object.fromEntries(header.map((key, i) => [key, values[i]]));
  });
}

export async function loadEllipticDataset(dataDir) {
  const featuresPath = path.join(dataDir, 'elliptic_txs_features.csv');
  const classesPath = path.join(dataDir, 'elliptic_txs_classes.csv');
  const [featureObjects, classObjects] = await Promise.all([readCsv(featuresPath), readCsv(classesPath)]);

  // Official features CSV: txId, time_step, 165 remaining numeric features.
  const featureRows = featureObjects.map((row) => {
    const txId = row.txId ?? row.txid ?? Object.values(row)[0];
    const entries = Object.entries(row).filter(([key]) => !['txId', 'txid'].includes(key));
    const timeStepEntry = entries.find(([key]) => /time.?step/i.test(key)) || entries[0];
    return {
      txId,
      timeStep: Number(timeStepEntry?.[1]),
      ...Object.fromEntries(entries),
    };
  });
  const classRows = classObjects.map((row) => ({
    txId: row.txId ?? row.txid ?? Object.values(row)[0],
    class: row.class ?? row.label ?? Object.values(row)[1],
  }));

  const adapted = adaptEllipticRows(featureRows, classRows);
  const timeById = new Map(featureRows.map((row) => [String(row.txId), Number(row.timeStep)]));
  adapted.samples = adapted.samples.map((sample) => ({ ...sample, timeStep: timeById.get(sample.id) }));
  return adapted;
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
