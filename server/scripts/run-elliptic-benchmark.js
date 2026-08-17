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
function quantile(values,x){const a=values.filter(Number.isFinite).sort((a,b)=>a-b);return a.length?a[Math.floor(x*(a.length-1))]:-Infinity;}
function predict(partName,need,gs){return oriented[partName].classical.map((c,i)=>{if(c<cSel.threshold)return 0;let low=0;for(let k=0;k<3;k++)if(oriented[partName][voters[k]][i]<gs[k])low++;return low>=need?0:1;});}
// Search ONLY validation. Dense enough to expose the FN/FP trade-off, but neither
// development-test nor holdout can influence policy selection.
const qs=Array.from({length:41},(_,i)=>i*.005); // 0..20% in 0.5% steps
const gates={};for(const n of voters){const illicit=oriented.validation[n].filter((_,i)=>validationLabels[i]==='illicit');gates[n]=[...new Set(qs.map(x=>quantile(illicit,x)))];}
const bestByFn=new Map();
for(const sg of gates[voters[0]])for(const g5 of gates[voters[1]])for(const g13 of gates[voters[2]])for(const need of [3,2]){
 const gs=[sg,g5,g13],m=binaryMetrics(validationLabels,predict('validation',need,gs),.5);
 if(m.fn>10)continue; const prev=bestByFn.get(m.fn); if(!prev||m.fp<prev.metrics.fp)bestByFn.set(m.fn,{need,gs,metrics:m});
}
const frontier=[...bestByFn.entries()].sort((a,b)=>a[0]-b[0]).map(([fn,p])=>({validationFn:fn,minIndependentLowRiskVotesToVeto:p.need,gates:Object.fromEntries(voters.map((n,i)=>[n,p.gs[i]])),validation:p.metrics}));
const frozen=bestByFn.get(0); if(!frozen)throw new Error('No validation zero-FN policy found');
const output={protocol:'VALIDATION_ONLY_PARETO_WITH_LOCKED_HOLDOUT',boundaries:split.boundaries,counts:Object.fromEntries(['train','validation','developmentTest','holdout'].map(n=>[n,{total:split[n].samples.length,known:split[n].knownSampleCount}])),zeroFnPolicy:{selectionData:'validation-only',classicalThreshold:cSel.threshold,classicalOrientation:cSel.orientation,minIndependentLowRiskVotesToVeto:frozen.need,gates:Object.fromEntries(voters.map((n,i)=>[n,frozen.gs[i]])),voterOrientations:orient,validation:frozen.metrics,developmentTest:binaryMetrics(devLabels,predict('developmentTest',frozen.need,frozen.gs),.5),finalHoldout:binaryMetrics(holdoutLabels,predict('holdout',frozen.need,frozen.gs),.5)},validationParetoFrontier:frontier,integrity:{paretoSelectionUsesValidationOnly:true,holdoutUsedForSelection:false,developmentTestUsedForSelection:false,holdoutPolicyChangedFromPreviousRun:false}};
console.log(JSON.stringify(output,null,2));
