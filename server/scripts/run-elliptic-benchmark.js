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
const labels=p=>p.samples.map(s=>p.labels.get(s.id)||'unknown'),validationLabels=labels(split.validation),devLabels=labels(split.developmentTest),holdoutLabels=labels(split.holdout);
const raw={validation:{},developmentTest:{},holdout:{}};
for(const [name,scorer] of Object.entries(scorers))for(const p of ['validation','developmentTest','holdout']){const r=await runBlindAmlBenchmark(split[p],{[name]:scorer},{threshold:.5});raw[p][name]=r.results[name].scores;}
const cSel=selectConstrainedThreshold(validationLabels,raw.validation.classical,{minRecall:1}),voters=['supervisedBalancedLinear','elliptic5DProxy','elliptic13DProxy'],orient={};
for(const n of voters)orient[n]=selectOrientationAndThreshold(validationLabels,raw.validation[n],{objective:'f1'}).orientation;
const oriented={};for(const p of ['validation','developmentTest','holdout']){oriented[p]={classical:applyOrientation(raw[p].classical,cSel.orientation)};for(const n of voters)oriented[p][n]=applyOrientation(raw[p][n],orient[n]);}
function quantile(values,x){const a=values.filter(Number.isFinite).sort((a,b)=>a-b);return a.length?a[Math.floor(x*(a.length-1))]:-Infinity;}
function predict(p,need,gs){return oriented[p].classical.map((c,i)=>{if(c<cSel.threshold)return 0;let low=0;for(let k=0;k<3;k++)if(oriented[p][voters[k]][i]<gs[k])low++;return low>=need?0:1;});}
const qs=Array.from({length:41},(_,i)=>i*.005),gates={};for(const n of voters){const illicit=oriented.validation[n].filter((_,i)=>validationLabels[i]==='illicit');gates[n]=[...new Set(qs.map(x=>quantile(illicit,x)))];}
// Precompute validation low-risk masks for every gate. Inner search now performs
// integer additions only and aborts as soon as FN exceeds 10.
const known=[];for(let i=0;i<validationLabels.length;i++)if(validationLabels[i]!=='unknown')known.push(i);
const base=known.map(i=>oriented.validation.classical[i]>=cSel.threshold?1:0);
const masks=voters.map((n,k)=>gates[n].map(g=>known.map(i=>oriented.validation[n][i]<g?1:0)));
const bestByFn=new Map();
for(let a=0;a<gates[voters[0]].length;a++)for(let b=0;b<gates[voters[1]].length;b++)for(let c=0;c<gates[voters[2]].length;c++)for(const need of [3,2]){
 let tp=0,fp=0,fn=0,tn=0;for(let r=0;r<known.length;r++){const y=validationLabels[known[r]]==='illicit';let pred=base[r];if(pred&&(masks[0][a][r]+masks[1][b][r]+masks[2][c][r]>=need))pred=0;if(y){if(pred)tp++;else if(++fn>10)break;}else{if(pred)fp++;else tn++;}}
 if(fn>10)continue;const prev=bestByFn.get(fn);if(!prev||fp<prev.metrics.fp)bestByFn.set(fn,{need,gs:[gates[voters[0]][a],gates[voters[1]][b],gates[voters[2]][c]],metrics:{tp,fp,tn,fn,precision:tp+fp?tp/(tp+fp):0,recall:tp+fn?tp/(tp+fn):0,f1:2*tp+fp+fn?2*tp/(2*tp+fp+fn):0}});
}
const frontier=[...bestByFn.entries()].sort((a,b)=>a[0]-b[0]).map(([fn,p])=>({validationFn:fn,minIndependentLowRiskVotesToVeto:p.need,gates:Object.fromEntries(voters.map((n,i)=>[n,p.gs[i]])),validation:p.metrics}));
const frozen=bestByFn.get(0);if(!frozen)throw new Error('No validation zero-FN policy found');
const output={protocol:'FAST_VALIDATION_ONLY_PARETO_WITH_LOCKED_HOLDOUT',boundaries:split.boundaries,counts:Object.fromEntries(['train','validation','developmentTest','holdout'].map(n=>[n,{total:split[n].samples.length,known:split[n].knownSampleCount}])),zeroFnPolicy:{selectionData:'validation-only',classicalThreshold:cSel.threshold,classicalOrientation:cSel.orientation,minIndependentLowRiskVotesToVeto:frozen.need,gates:Object.fromEntries(voters.map((n,i)=>[n,frozen.gs[i]])),voterOrientations:orient,validation:frozen.metrics,developmentTest:binaryMetrics(devLabels,predict('developmentTest',frozen.need,frozen.gs),.5),finalHoldout:binaryMetrics(holdoutLabels,predict('holdout',frozen.need,frozen.gs),.5)},validationParetoFrontier:frontier,integrity:{paretoSelectionUsesValidationOnly:true,holdoutUsedForSelection:false,developmentTestUsedForSelection:false}};
console.log(JSON.stringify(output,null,2));
