import path from 'node:path';
import { loadEllipticDataset, temporalHoldoutSplit } from '../src/benchmarks/ellipticCsv.js';
import { createElliptic5QScorer, createElliptic13QScorer, createRobustClassicalScorer } from '../src/benchmarks/ellipticScorers.js';
import { createBalancedLinearScorer } from '../src/benchmarks/supervisedLinearScorer.js';
import { runBlindAmlBenchmark } from '../src/benchmarks/amlBenchmark.js';
import { binaryMetrics } from '../src/benchmarks/benchmarkMetrics.js';
import { selectOrientationAndThreshold, applyOrientation } from '../src/benchmarks/thresholdSelection.js';
import { selectConstrainedThreshold } from '../src/benchmarks/constrainedThresholdSelection.js';

const dataDir=path.resolve(process.argv[2]||process.env.ELLIPTIC_DATA_DIR||'./data/elliptic');
const dataset=await loadEllipticDataset(dataDir),split=temporalHoldoutSplit(dataset);
const scorers={classical:createRobustClassicalScorer(split.train.samples),supervisedBalancedLinear:createBalancedLinearScorer(split.train),elliptic5DProxy:createElliptic5QScorer(split.train.samples),elliptic13DProxy:createElliptic13QScorer(split.train.samples)};
const labels=p=>p.samples.map(s=>p.labels.get(s.id)||'unknown');
const validationLabels=labels(split.validation),devLabels=labels(split.developmentTest),holdoutLabels=labels(split.holdout);
const raw={validation:{},developmentTest:{},holdout:{}};
for(const [name,scorer] of Object.entries(scorers))for(const partName of ['validation','developmentTest','holdout']){const r=await runBlindAmlBenchmark(split[partName],{[name]:scorer},{threshold:.5});raw[partName][name]=r.results[name].scores;}
const cSel=selectConstrainedThreshold(validationLabels,raw.validation.classical,{minRecall:1});
const voters=['supervisedBalancedLinear','elliptic5DProxy','elliptic13DProxy'],orient={};
for(const n of voters)orient[n]=selectOrientationAndThreshold(validationLabels,raw.validation[n],{objective:'f1'}).orientation;
const oriented={};for(const p of ['validation','developmentTest','holdout']){oriented[p]={classical:applyOrientation(raw[p].classical,cSel.orientation)};for(const n of voters)oriented[p][n]=applyOrientation(raw[p][n],orient[n]);}
function q(values,x){const a=values.filter(Number.isFinite).sort((a,b)=>a-b);return a[Math.floor(x*(a.length-1))];}
// Reconstruct the frozen 3-voter policy strictly from validation, matching the
// previously accepted search family. Development test and holdout never select it.
const qs=[0,.01,.025,.05,.1],gates={};for(const n of voters){const illicit=oriented.validation[n].filter((_,i)=>validationLabels[i]==='illicit');gates[n]=[...new Set(qs.map(x=>q(illicit,x)))];}
let best=null;
for(const sg of gates[voters[0]])for(const g5 of gates[voters[1]])for(const g13 of gates[voters[2]])for(const need of [3,2]){const gs=[sg,g5,g13];const pred=oriented.validation.classical.map((c,i)=>{if(c<cSel.threshold)return 0;let low=0;for(let k=0;k<3;k++)if(oriented.validation[voters[k]][i]<gs[k])low++;return low>=need?0:1;});const m=binaryMetrics(validationLabels,pred,.5);if(m.fn===0&&(!best||m.fp<best.metrics.fp))best={need,gs,metrics:m};}
function evaluate(partName,partLabels){const pred=oriented[partName].classical.map((c,i)=>{if(c<cSel.threshold)return 0;let low=0;for(let k=0;k<3;k++)if(oriented[partName][voters[k]][i]<best.gs[k])low++;return low>=best.need?0:1;});return binaryMetrics(partLabels,pred,.5);}
const output={protocol:'FROZEN_POLICY_FINAL_HOLDOUT',boundaries:split.boundaries,counts:Object.fromEntries(['train','validation','developmentTest','holdout'].map(n=>[n,{total:split[n].samples.length,known:split[n].knownSampleCount}])),frozenPolicy:{selectionData:'validation-only',classicalThreshold:cSel.threshold,classicalOrientation:cSel.orientation,minIndependentLowRiskVotesToVeto:best.need,gates:Object.fromEntries(voters.map((n,i)=>[n,best.gs[i]])),voterOrientations:orient,validation:best.metrics,developmentTest:evaluate('developmentTest',devLabels),finalHoldout:evaluate('holdout',holdoutLabels)},integrity:{holdoutUsedForSelection:false,developmentTestUsedForSelection:false}};
console.log(JSON.stringify(output,null,2));
