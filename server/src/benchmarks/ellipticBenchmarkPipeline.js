import { runBlindAmlBenchmark } from './amlBenchmark.js';
import { binaryMetrics } from './benchmarkMetrics.js';
import { selectConstrainedThreshold } from './constrainedThresholdSelection.js';
import { createFpDiscriminator } from './fpDiscriminator.js';
import { createElliptic5QScorer, createElliptic13QScorer, createRobustClassicalScorer } from './ellipticScorers.js';
import { createGraphAwareScorer } from './ellipticGraphScorer.js';
import { applyOrientation } from './thresholdSelection.js';
import { labelsFor, orientScoresForSplits, searchConsensusPolicy, selectFpVetoPolicy, selectGraphOnlyPolicy } from './ellipticBenchmarkStages.js';

function predictConsensus(scoresByName, classicalThreshold, gateThresholds, voterNames, need) {
  return scoresByName.classical.map((score, index) => {
    if (score < classicalThreshold) return 0;
    let low = 0;
    for (const name of voterNames) if (scoresByName[name][index] < gateThresholds[name]) low++;
    return low >= need ? 0 : 1;
  });
}

function splitView(orientedInfo, rawScores, splitName, classicalOrientation, voterNames) {
  const view = {
    classical: applyOrientation(rawScores[splitName].classical, classicalOrientation),
  };
  for (const name of voterNames) {
    view[name] = orientedInfo.oriented[name][splitName];
  }
  return view;
}

export async function buildBenchmarkScorers(trainPart, graphContext, opts = {}) {
  const [{ createBalancedLinearScorer }, { createTemporalRegimeScorer }] = await Promise.all([
    import('./supervisedLinearScorer.js'),
    import('./temporalFeatureScorer.js'),
  ]);
  return {
    classical: createRobustClassicalScorer(trainPart.samples),
    linear: createBalancedLinearScorer(trainPart),
    temporal: createTemporalRegimeScorer(trainPart),
    q5: createElliptic5QScorer(trainPart.samples),
    q13: createElliptic13QScorer(trainPart.samples),
    graph: createGraphAwareScorer(trainPart, graphContext, {
      allSamples: opts.allSamples || graphContext?.samples || trainPart.samples,
      propagation: opts.graphPropagation,
    }),
  };
}

export async function scorePartitions(partitions, scorers) {
  const raw = {};
  for (const [splitName, partition] of Object.entries(partitions)) {
    raw[splitName] = {};
    for (const [name, scorer] of Object.entries(scorers)) {
      if (typeof scorer !== 'function') continue;
      const result = await runBlindAmlBenchmark(partition, { [name]: scorer });
      raw[splitName][name] = result.results[name].scores;
    }
  }
  return raw;
}

export function labelsBySplit(partitions) {
  const out = {};
  for (const [name, partition] of Object.entries(partitions)) out[name] = labelsFor(partition);
  return out;
}

export function orientAllScores(partitions, rawScores) {
  const labels = { validation: labelsFor(partitions.validation) };
  const scorerNames = Object.keys(rawScores.validation || {});
  return orientScoresForSplits(labels, rawScores, scorerNames);
}

export function selectBaselinePolicy(partitions, rawScores, orientedInfo) {
  const validationLabels = labelsFor(partitions.validation);
  const classicalThreshold = selectConstrainedThreshold(validationLabels, rawScores.validation.classical, { minRecall: 1 });
  const consensusScores = {
    validation: splitView(orientedInfo, rawScores, 'validation', classicalThreshold.orientation, ['linear', 'temporal', 'q5', 'q13']),
    developmentTest: splitView(orientedInfo, rawScores, 'developmentTest', classicalThreshold.orientation, ['linear', 'temporal', 'q5', 'q13']),
  };
  const policy = searchConsensusPolicy({
    validation: partitions.validation,
    development: partitions.developmentTest,
    classicalThreshold: classicalThreshold.threshold,
    scoresByName: {
      validation: consensusScores.validation,
      development: consensusScores.developmentTest,
    },
    voterNames: ['linear', 'temporal', 'q5', 'q13'],
    needs: [4, 3, 2],
  });
  if (!policy) throw new Error('no stable zero-FN baseline policy found');
  return {
    kind: 'baseline-consensus',
    classicalOrientation: classicalThreshold.orientation,
    classicalThreshold: classicalThreshold.threshold,
    validationClassical: classicalThreshold.metrics,
    ...policy,
  };
}

export function selectGraphModel(partitions, rawScores, orientedInfo, baselinePolicy, fpScores) {
  const consensusScores = {
    validation: splitView(orientedInfo, rawScores, 'validation', baselinePolicy.classicalOrientation, ['linear', 'temporal', 'q5', 'q13', 'graph']),
    developmentTest: splitView(orientedInfo, rawScores, 'developmentTest', baselinePolicy.classicalOrientation, ['linear', 'temporal', 'q5', 'q13', 'graph']),
  };
  const graphOnly = selectGraphOnlyPolicy({
    validation: partitions.validation,
    development: partitions.developmentTest,
    scoresBySplit: {
      validation: rawScores.validation.graph,
      developmentTest: rawScores.developmentTest.graph,
    },
  });

  const graphConsensus = searchConsensusPolicy({
    validation: partitions.validation,
    development: partitions.developmentTest,
    classicalThreshold: baselinePolicy.classicalThreshold,
    scoresByName: {
      validation: consensusScores.validation,
      development: consensusScores.developmentTest,
    },
    voterNames: ['linear', 'temporal', 'q5', 'q13', 'graph'],
    needs: [5, 4, 3, 2],
  });

  const graphFp = fpScores && graphConsensus
      ? selectFpVetoPolicy({
        validation: partitions.validation,
        development: partitions.developmentTest,
        basePredictions: {
          validation: predictConsensus(consensusScores.validation, baselinePolicy.classicalThreshold, graphConsensus.gateThresholds, ['linear', 'temporal', 'q5', 'q13', 'graph'], graphConsensus.need),
          development: predictConsensus(consensusScores.developmentTest, baselinePolicy.classicalThreshold, graphConsensus.gateThresholds, ['linear', 'temporal', 'q5', 'q13', 'graph'], graphConsensus.need),
        },
        discriminatorScores: {
          validation: fpScores.validation,
          development: fpScores.developmentTest,
        },
      })
    : null;

  const candidates = [
    graphOnly && { ...graphOnly, kind: 'graph-only' },
    graphConsensus && { ...graphConsensus, kind: 'graph-consensus' },
    graphFp && { ...graphFp, kind: 'graph-fp-veto' },
  ].filter(Boolean);
  candidates.sort((a, b) =>
    (a.validation.fp + a.developmentTest.fp) - (b.validation.fp + b.developmentTest.fp) ||
    a.validation.fn - b.validation.fn ||
    a.developmentTest.fn - b.developmentTest.fn);

  return {
    graphOnly,
    graphConsensus,
    graphFp,
    winner: candidates[0] || null,
  };
}

export async function scoreFpDiscriminator(partitions, trainPart, scorers) {
  if (!scorers) return null;
  const baseScorers = ['linear', 'temporal', 'q5', 'q13', 'graph']
    .filter((name) => typeof scorers[name] === 'function')
    .map((name) => scorers[name]);
  if (!baseScorers.length) return null;
  const fp = await createFpDiscriminator(trainPart, baseScorers);
  const fpScores = {};
  for (const [splitName, partition] of Object.entries(partitions)) {
    fpScores[splitName] = [];
    for (const sample of partition.samples) fpScores[splitName].push(await fp(sample));
  }
  return fpScores;
}

export function evaluatePartition(partition, scores, threshold = 0.5) {
  return binaryMetrics(labelsFor(partition), scores, threshold);
}
