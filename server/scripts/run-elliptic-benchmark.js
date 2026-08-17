import path from 'node:path';
import { loadEllipticDataset, temporalSplit } from '../src/benchmarks/ellipticCsv.js';
import { createElliptic5QScorer, createElliptic13QScorer, createRobustClassicalScorer } from '../src/benchmarks/ellipticScorers.js';
import { createBalancedLinearScorer } from '../src/benchmarks/supervisedLinearScorer.js';
import { runBlindAmlBenchmark } from '../src/benchmarks/amlBenchmark.js';
import { binaryMetrics } from '../src/benchmarks/benchmarkMetrics.js';
import { selectOrientationAndThreshold, applyOrientation } from '../src/benchmarks/thresholdSelection.js';
import { selectConstrainedThreshold } from '../src/benchmarks/constrainedThresholdSelection.js';

const dataDir = path.resolve(process.argv[2] || process.env.ELLIPTIC_DATA_DIR || './data/elliptic');
const dataset = await loadEllipticDataset(dataDir);
const split = temporalSplit(dataset);
const scorers = { classical: createRobustClassicalScorer(split.train.samples), elliptic5DProxy: createElliptic5QScorer(split.train.samples), elliptic13DProxy: createElliptic13QScorer(split.train.samples), supervisedBalancedLinear: createBalancedLinearScorer(split.train) };
const output = { dataDir, boundaries: split.boundaries, counts: {}, models: {}, cascades: {} };
const raw = { validation: {}, test: {} };
const validationLabels = split.validation.samples.map((s) => split.validation.labels.get(s.id) || 'unknown');
const testLabels = split.test.samples.map((s) => split.test.labels.get(s.id) || 'unknown');

for (const [name, scorer] of Object.entries(scorers)) {
  const validation = await runBlindAmlBenchmark(split.validation, { [name]: scorer }, { threshold: 0.5 });
  raw.validation[name] = validation.results[name].scores;
  const f1Selected = selectOrientationAndThreshold(validationLabels, raw.validation[name], { objective: 'f1' });
  const constrainedSelected = selectConstrainedThreshold(validationLabels, raw.validation[name], { minRecall: 1 });
  const test = await runBlindAmlBenchmark(split.test, { [name]: scorer }, { threshold: 0.5 });
  raw.test[name] = test.results[name].scores;
  output.models[name] = { f1Optimal: { orientation: f1Selected.orientation, selectedThreshold: f1Selected.threshold, validation: f1Selected.metrics, test: binaryMetrics(testLabels, applyOrientation(raw.test[name], f1Selected.orientation), f1Selected.threshold) }, zeroFnConstrained: { minValidationRecall: 1, orientation: constrainedSelected.orientation, selectedThreshold: constrainedSelected.threshold, validation: constrainedSelected.metrics, test: binaryMetrics(testLabels, applyOrientation(raw.test[name], constrainedSelected.orientation), constrainedSelected.threshold) } };
}

const cSel = selectConstrainedThreshold(validationLabels, raw.validation.classical, { minRecall: 1 });
const cVal = applyOrientation(raw.validation.classical, cSel.orientation), cTest = applyOrientation(raw.test.classical, cSel.orientation);
const voters = ['supervisedBalancedLinear', 'elliptic5DProxy', 'elliptic13DProxy'];
const oriented = { validation: {}, test: {} }, voterSelections = {};
for (const name of voters) { const sel = selectOrientationAndThreshold(validationLabels, raw.validation[name], { objective: 'f1' }); voterSelections[name] = sel; oriented.validation[name] = applyOrientation(raw.validation[name], sel.orientation); oriented.test[name] = applyOrientation(raw.test[name], sel.orientation); }

// Dense validation-only search. We deliberately stay in the lower 10% of the
// illicit validation distribution for each voter. The final policy is still
// required to produce exactly zero validation FN before it is eligible.
const quantiles = Array.from({ length: 41 }, (_, i) => i * 0.0025); // 0..10%, 0.25% steps
function quantile(values, q) { const xs = values.filter(Number.isFinite).sort((a,b)=>a-b); if (!xs.length) return -Infinity; return xs[Math.floor(q * (xs.length - 1))]; }
const gatesByVoter = {};
for (const name of voters) { const illicit = oriented.validation[name].filter((_,i)=>validationLabels[i]==='illicit'); gatesByVoter[name] = [...new Set(quantiles.map(q=>quantile(illicit,q)))]; }

let best = null;
for (const minLowVotes of [3,2]) for (const sg of gatesByVoter.supervisedBalancedLinear) for (const g5 of gatesByVoter.elliptic5DProxy) for (const g13 of gatesByVoter.elliptic13DProxy) {
  const gates = { supervisedBalancedLinear: sg, elliptic5DProxy: g5, elliptic13DProxy: g13 };
  const scores = cVal.map((c,i)=>{ if(c<cSel.threshold)return 0; let n=0; for(const name of voters) if(oriented.validation[name][i] < gates[name]) n++; return n>=minLowVotes?0:1; });
  const metrics = binaryMetrics(validationLabels,scores,0.5); if(metrics.fn!==0) continue;
  if(!best || metrics.fp<best.metrics.fp || (metrics.fp===best.metrics.fp && minLowVotes>best.minLowVotes)) best={minLowVotes,gates,metrics};
}
if(best){
  const scores=cTest.map((c,i)=>{if(c<cSel.threshold)return 0;let n=0;for(const name of voters)if(oriented.test[name][i]<best.gates[name])n++;return n>=best.minLowVotes?0:1;});
  output.cascades.consensusVetoZeroFn={selectionBasis:'dense-validation-only-zero-FN',quantileStep:0.0025,quantileMax:0.10,classicalThreshold:cSel.threshold,classicalOrientation:cSel.orientation,minIndependentLowRiskVotesToVeto:best.minLowVotes,gates:best.gates,voterOrientations:Object.fromEntries(voters.map(n=>[n,voterSelections[n].orientation])),validation:best.metrics,test:binaryMetrics(testLabels,scores,0.5)};
}
for(const [name,part] of Object.entries(split))if(name!=='boundaries')output.counts[name]={total:part.samples.length,known:part.knownSampleCount};
console.log(JSON.stringify(output,null,2));
