import path from 'node:path';
import { loadEllipticDataset, temporalSplit } from '../src/benchmarks/ellipticCsv.js';
import { createElliptic5QScorer, createElliptic13QScorer, createRobustClassicalScorer } from '../src/benchmarks/ellipticScorers.js';
import { createBalancedLinearScorer } from '../src/benchmarks/supervisedLinearScorer.js';
import { createBalancedSubspaceScorer } from '../src/benchmarks/supervisedSubspaceScorer.js';
import { runBlindAmlBenchmark } from '../src/benchmarks/amlBenchmark.js';
import { binaryMetrics } from '../src/benchmarks/benchmarkMetrics.js';
import { selectOrientationAndThreshold, applyOrientation } from '../src/benchmarks/thresholdSelection.js';
import { selectConstrainedThreshold } from '../src/benchmarks/constrainedThresholdSelection.js';

const dataDir=path.resolve(process.argv[2]||process.env.ELLIPTIC_DATA_DIR||'./data/elliptic');
const dataset=await loadEllipticDataset(dataDir), split=temporalSplit(dataset);
const scorers={classical:createRobustClassicalScorer(split.train.samples),elliptic5DProxy:createElliptic5QScorer(split.train.samples),elliptic13DProxy:createElliptic13QScorer(split.train.samples),supervisedBalancedLinear:createBalancedLinearScorer(split.train),supervisedSubspace:createBalancedSubspaceScorer(split.train)};
const output={dataDir,boundaries:split.boundaries,counts:{},models:{},cascades:{}},raw={validation:{},test:{}};
const validationLabels=split.validation.samples.map(s=>split.validation.labels.get(s.id)||'unknown'),testLabels=split.test.samples.map(s=>split.test.labels.get(s.id)||'unknown');
for(const [name,scorer] of Object.entries(scorers)){
 const v=await runBlindAmlBenchmark(split.validation,{[name]:scorer},{threshold:.5}); raw.validation[name]=v.results[name].scores;
 const f=selectOrientationAndThreshold(validationLabels,raw.validation[name],{objective:'f1'}),z=selectConstrainedThreshold(validationLabels,raw.validation[name],{minRecall:1});
 const t=await runBlindAmlBenchmark(split.test,{[name]:scorer},{threshold:.5}); raw.test[name]=t.results[name].scores;
 output.models[name]={f1Optimal:{orientation:f.orientation,selectedThreshold:f.threshold,validation:f.metrics,test:binaryMetrics(testLabels,applyOrientation(raw.test[name],f.orientation),f.threshold)},zeroFnConstrained:{orientation:z.orientation,selectedThreshold:z.threshold,validation:z.metrics,test:binaryMetrics(testLabels,applyOrientation(raw.test[name],z.orientation),z.threshold)}};
}
const cSel=selectConstrainedThreshold(validationLabels,raw.validation.classical,{minRecall:1}),cVal=applyOrientation(raw.validation.classical,cSel.orientation),cTest=applyOrientation(raw.test.classical,cSel.orientation);
const voters=['supervisedBalancedLinear','supervisedSubspace','elliptic5DProxy','elliptic13DProxy'],oriented={validation:{},test:{}},selections={};
for(const n of voters){const s=selectOrientationAndThreshold(validationLabels,raw.validation[n],{objective:'f1'});selections[n]=s;oriented.validation[n]=applyOrientation(raw.validation[n],s.orientation);oriented.test[n]=applyOrientation(raw.test[n],s.orientation);}
function quantile(values,q){const xs=values.filter(Number.isFinite).sort((a,b)=>a-b);return xs.length?xs[Math.floor(q*(xs.length-1))]:-Infinity;}
// 11 points/voter => 14,641 gate tuples, dramatically faster than previous 41^3.
const qs=Array.from({length:11},(_,i)=>i*.01),gates={};
for(const n of voters){const illicit=oriented.validation[n].filter((_,i)=>validationLabels[i]==='illicit');gates[n]=[...new Set(qs.map(q=>quantile(illicit,q)))];}
let best=null;
for(const g0 of gates[voters[0]])for(const g1 of gates[voters[1]])for(const g2 of gates[voters[2]])for(const g3 of gates[voters[3]]){
 const gs=[g0,g1,g2,g3];
 for(const need of [4,3,2]){
  let tp=0,fp=0,fn=0,tn=0;
  for(let i=0;i<validationLabels.length;i++){if(validationLabels[i]==='unknown')continue;let pred=0;if(cVal[i]>=cSel.threshold){let low=0;for(let k=0;k<4;k++)if(oriented.validation[voters[k]][i]<gs[k])low++;pred=low>=need?0:1;}if(validationLabels[i]==='illicit'){if(pred)tp++;else fn++;}else{if(pred)fp++;else tn++;}if(fn)break;}
  if(fn)continue; const m=binaryMetrics(validationLabels,cVal.map((c,i)=>{if(c<cSel.threshold)return 0;let low=0;for(let k=0;k<4;k++)if(oriented.validation[voters[k]][i]<gs[k])low++;return low>=need?0:1;}),.5);
  if(!best||m.fp<best.metrics.fp)best={need,gs:[...gs],metrics:m};
 }
}
if(best){const scores=cTest.map((c,i)=>{if(c<cSel.threshold)return 0;let low=0;for(let k=0;k<4;k++)if(oriented.test[voters[k]][i]<best.gs[k])low++;return low>=best.need?0:1;});output.cascades.fourVoterConsensusZeroFn={selectionBasis:'validation-only-zero-FN',minIndependentLowRiskVotesToVeto:best.need,gates:Object.fromEntries(voters.map((n,i)=>[n,best.gs[i]])),voterOrientations:Object.fromEntries(voters.map(n=>[n,selections[n].orientation])),validation:best.metrics,test:binaryMetrics(testLabels,scores,.5)};}
for(const [n,p] of Object.entries(split))if(n!=='boundaries')output.counts[n]={total:p.samples.length,known:p.knownSampleCount};
console.log(JSON.stringify(output,null,2));
