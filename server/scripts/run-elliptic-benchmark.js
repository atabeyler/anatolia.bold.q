import path from 'node:path';
import { loadEllipticDataset, temporalHoldoutSplit } from '../src/benchmarks/ellipticCsv.js';
import { createElliptic5QScorer, createElliptic13QScorer, createRobustClassicalScorer } from '../src/benchmarks/ellipticScorers.js';
import { createBalancedLinearScorer } from '../src/benchmarks/supervisedLinearScorer.js';
import { createTemporalRegimeScorer } from '../src/benchmarks/temporalFeatureScorer.js';
import { runBlindAmlBenchmark } from '../src/benchmarks/amlBenchmark.js';
import { binaryMetrics } from '../src/benchmarks/benchmarkMetrics.js';
import { selectOrientationAndThreshold, applyOrientation } from '../src/benchmarks/thresholdSelection.js';
import { selectConstrainedThreshold } from '../src/benchmarks/constrainedThresholdSelection.js';
const dataDir=path.resolve(process.argv[2]||process.env.ELLIPTIC_DATA_DIR||'./data/elliptic');
const dataset=await loadEllipticDataset(dataDir),split=temporalHoldoutSplit(dataset);
const scorers={classical:createRobustClassicalScorer(split.train.samples),supervisedBalancedLinear:createBalancedLinearScorer(split.train),temporalRegime:createTemporalRegimeScorer(split.train),elliptic5DProxy:createElliptic5QScorer(split.train.samples),elliptic13DProxy:createElliptic13QScorer(split.train.samples)};
const labels=p=>p.samples.map(s=>p.labels.get(s.id)||'unknown'),validationLabels=labels(split.validation),devLabels=labels(split.developmentTest),holdoutLabels=labels(split.holdout);
const raw={validation:{},developmentTest:{},holdout:{}};
for(const [name,scorer] of Object.entries(scorers))for(const p of ['validation','developmentTest','holdout']){const r=await runBlindAmlBenchmark(split[p],{[name]:scorer},{threshold:.5});raw[p][name]=r.results[name].scores;}
const cSel=selectConstrainedThreshold(validationLabels,raw.validation.classical,{minRecall:1});
const voters=['supervisedBalancedLinear','temporalRegime','elliptic5DProxy','elliptic13DProxy'],orient={};for(const n of voters)orient[n]=selectOrientationAndThreshold(validationLabels,raw.validation[n],{objective:'f1'}).orientation;
const oriented={};for(const p of ['validation','developmentTest','holdout']){oriented[p]={classical:applyOrientation(raw[p].classical,cSel.orientation)};for(const n of voters)oriented[p][n]=applyOrientation(raw[p][n],orient[n]);}
function quantile(v,q){const a=v.filter(Number.isFinite).sort((x,y)=>x-y);return a.length?a[Math.floor(q*(a.length-1))]:-Infinity;}
const qs=[0,.01,.02,.03,.04,.05,.075,.10,.15],gates={};for(const n of voters){const il=oriented.validation[n].filter((_,i)=>validationLabels[i]==='illicit');gates[n]=[...new Set(qs.map(q=>quantile(il,q)))];}
function metricsFor(part,partLabels,need,gs){const pred=oriented[part].classical.map((c,i)=>{if(c<cSel.threshold)return 0;let low=0;for(let k=0;k<voters.length;k++)if(oriented[part][voters[k]][i]<gs[k])low++;return low>=need?0:1;});return binaryMetrics(partLabels,pred,.5);}
// Stage 1: policy candidates are created using validation only. Require zero FN there.
const candidates=[];for(const g0 of gates[voters[0]])for(const g1 of gates[voters[1]])for(const g2 of gates[voters[2]])for(const g3 of gates[voters[3]])for(const need of [4,3,2]){const gs=[g0,g1,g2,g3],v=metricsFor('validation',validationLabels,need,gs);if(v.fn===0)candidates.push({need,gs,validation:v});}
if(!candidates.length)throw new Error('No validation zero-FN candidate');
candidates.sort((a,b)=>a.validation.fp-b.validation.fp);
// Stage 2: development test is explicitly allowed only for model selection, never holdout.
// Prefer candidates that preserve zero FN across BOTH validation and development.
let stable=null;for(const c of candidates){const d=metricsFor('developmentTest',devLabels,c.need,c.gs);if(d.fn===0){stable={...c,developmentTest:d};break;}}
if(!stable){const pool=candidates.slice(0,Math.min(250,candidates.length)).map(c=>({...c,developmentTest:metricsFor('developmentTest',devLabels,c.need,c.gs)}));pool.sort((a,b)=>a.developmentTest.fn-b.developmentTest.fn||a.validation.fp-b.validation.fp||a.developmentTest.fp-b.developmentTest.fp);stable=pool[0];}
// Holdout is evaluated exactly once after the stable policy has been chosen.
const finalHoldout=metricsFor('holdout',holdoutLabels,stable.need,stable.gs);
const output={protocol:'TEMPORAL_FEATURE_STABILITY_SELECTION_FINAL_HOLDOUT',boundaries:split.boundaries,counts:Object.fromEntries(['train','validation','developmentTest','holdout'].map(n=>[n,{total:split[n].samples.length,known:split[n].knownSampleCount}])),selectedPolicy:{selectionData:'validation+development-stability; holdout excluded',classicalThreshold:cSel.threshold,classicalOrientation:cSel.orientation,minIndependentLowRiskVotesToVeto:stable.need,gates:Object.fromEntries(voters.map((n,i)=>[n,stable.gs[i]])),voterOrientations:orient,validation:stable.validation,developmentTest:stable.developmentTest,finalHoldout},candidateSummary:{validationZeroFnCandidates:candidates.length,selectedValidationRank:candidates.findIndex(c=>c.need===stable.need&&c.gs.every((g,i)=>g===stable.gs[i]))+1},integrity:{holdoutUsedForTraining:false,holdoutUsedForThresholdSelection:false,holdoutUsedForGateSelection:false,holdoutUsedForArchitectureSelection:false,developmentUsedForStabilitySelection:true}};
console.log(JSON.stringify(output,null,2));
