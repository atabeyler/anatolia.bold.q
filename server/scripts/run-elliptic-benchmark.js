import path from 'node:path';
import { loadEllipticDataset, loadEllipticEdges, temporalHoldoutSplit } from '../src/benchmarks/ellipticCsv.js';
import { createTemporalGraphContext } from '../src/benchmarks/ellipticGraphLoader.js';
import { buildBenchmarkScorers, orientAllScores, scorePartitions, scoreFpDiscriminator, selectBaselinePolicy, selectGraphModel } from '../src/benchmarks/ellipticBenchmarkPipeline.js';
import { binaryMetrics } from '../src/benchmarks/benchmarkMetrics.js';
import { applyOrientation } from '../src/benchmarks/thresholdSelection.js';
import { labelsFor } from '../src/benchmarks/ellipticBenchmarkStages.js';

function predictConsensus(scoresByName, classicalThreshold, gateThresholds, voterNames, need) {
  return scoresByName.classical.map((score, index) => {
    if (score < classicalThreshold) return 0;
    let low = 0;
    for (const name of voterNames) if (scoresByName[name][index] < gateThresholds[name]) low++;
    return low >= need ? 0 : 1;
  });
}

function predictGraphOnly(scores, policy) {
  const oriented = applyOrientation(scores, policy.orientation);
  return oriented.map((score) => (score >= policy.threshold ? 1 : 0));
}

function predictFpVeto(basePredictions, discriminatorScores, threshold) {
  return basePredictions.map((pred, index) => (pred && discriminatorScores[index] >= threshold ? 1 : 0));
}

function evaluatePartition(partition, predictions) {
  return binaryMetrics(labelsFor(partition), predictions, 0.5);
}

function buildConsensusScoresForSplit(rawScores, orientedInfo, splitName, classicalOrientation, voterNames) {
  const view = {
    classical: applyOrientation(rawScores[splitName].classical, classicalOrientation),
  };
  for (const name of voterNames) {
    if (orientedInfo.oriented[name]?.[splitName]) view[name] = orientedInfo.oriented[name][splitName];
  }
  return view;
}

function explainDelta(next, baseline) {
  return {
    tp: next.tp - baseline.tp,
    tn: next.tn - baseline.tn,
    fp: next.fp - baseline.fp,
    fn: next.fn - baseline.fn,
  };
}

const dataDir = path.resolve(process.argv[2] || process.env.ELLIPTIC_DATA_DIR || './data/elliptic');
const dataset = await loadEllipticDataset(dataDir);
const edges = await loadEllipticEdges(dataDir);
const split = temporalHoldoutSplit(dataset);
const partitions = {
  validation: split.validation,
  developmentTest: split.developmentTest,
  holdout: split.holdout,
};

const graphContext = createTemporalGraphContext(dataset.samples, edges);
graphContext.samples = dataset.samples;

const scorers = await buildBenchmarkScorers(split.train, graphContext, { allSamples: dataset.samples });
const rawScores = await scorePartitions(partitions, scorers);
const orientedInfo = orientAllScores(partitions, rawScores);
const baselinePolicy = selectBaselinePolicy(partitions, rawScores, orientedInfo);
const fpScores = await scoreFpDiscriminator(partitions, split.train, scorers);
const graphModel = selectGraphModel(partitions, rawScores, orientedInfo, baselinePolicy, fpScores);
const baselineConsensusScores = {
  validation: buildConsensusScoresForSplit(rawScores, orientedInfo, 'validation', baselinePolicy.classicalOrientation, ['linear', 'temporal', 'q5', 'q13']),
  developmentTest: buildConsensusScoresForSplit(rawScores, orientedInfo, 'developmentTest', baselinePolicy.classicalOrientation, ['linear', 'temporal', 'q5', 'q13']),
  holdout: buildConsensusScoresForSplit(rawScores, orientedInfo, 'holdout', baselinePolicy.classicalOrientation, ['linear', 'temporal', 'q5', 'q13']),
};
const graphConsensusScores = {
  validation: buildConsensusScoresForSplit(rawScores, orientedInfo, 'validation', baselinePolicy.classicalOrientation, ['linear', 'temporal', 'q5', 'q13', 'graph']),
  developmentTest: buildConsensusScoresForSplit(rawScores, orientedInfo, 'developmentTest', baselinePolicy.classicalOrientation, ['linear', 'temporal', 'q5', 'q13', 'graph']),
  holdout: buildConsensusScoresForSplit(rawScores, orientedInfo, 'holdout', baselinePolicy.classicalOrientation, ['linear', 'temporal', 'q5', 'q13', 'graph']),
};

const baselinePredictions = {
  validation: predictConsensus(baselineConsensusScores.validation, baselinePolicy.classicalThreshold, baselinePolicy.gateThresholds, ['linear', 'temporal', 'q5', 'q13'], baselinePolicy.need),
  developmentTest: predictConsensus(baselineConsensusScores.developmentTest, baselinePolicy.classicalThreshold, baselinePolicy.gateThresholds, ['linear', 'temporal', 'q5', 'q13'], baselinePolicy.need),
  holdout: predictConsensus(baselineConsensusScores.holdout, baselinePolicy.classicalThreshold, baselinePolicy.gateThresholds, ['linear', 'temporal', 'q5', 'q13'], baselinePolicy.need),
};

const baseline = {
  kind: baselinePolicy.kind,
  classical: {
    orientation: baselinePolicy.classicalOrientation,
    threshold: baselinePolicy.classicalThreshold,
    validation: baselinePolicy.validationClassical,
  },
  policy: {
    need: baselinePolicy.need,
    gateThresholds: baselinePolicy.gateThresholds,
  },
  validation: evaluatePartition(partitions.validation, baselinePredictions.validation),
  developmentTest: evaluatePartition(partitions.developmentTest, baselinePredictions.developmentTest),
  holdout: evaluatePartition(partitions.holdout, baselinePredictions.holdout),
};

const graphAblations = {
  graphOnly: graphModel.graphOnly
    ? {
        policy: graphModel.graphOnly,
        validation: graphModel.graphOnly.validation,
        developmentTest: graphModel.graphOnly.developmentTest,
      }
    : { policy: null, validation: null, developmentTest: null },
  graphConsensus: graphModel.graphConsensus
    ? {
        policy: graphModel.graphConsensus,
        validation: graphModel.graphConsensus.validation,
        developmentTest: graphModel.graphConsensus.developmentTest,
      }
    : { policy: null, validation: null, developmentTest: null },
  graphFpVeto: graphModel.graphFp
    ? {
        policy: graphModel.graphFp,
        validation: graphModel.graphFp.validation,
        developmentTest: graphModel.graphFp.developmentTest,
      }
    : { policy: null, validation: null, developmentTest: null },
};

let selectedGraphPolicy = graphModel.winner;
if (!selectedGraphPolicy) {
  selectedGraphPolicy = {
    kind: 'baseline-retained',
    classicalThreshold: baselinePolicy.classicalThreshold,
    gateThresholds: baselinePolicy.gateThresholds,
    need: baselinePolicy.need,
  };
}

let graphPredictions;
if (selectedGraphPolicy.kind === 'graph-only') {
  graphPredictions = {
    validation: predictGraphOnly(rawScores.validation.graph, selectedGraphPolicy),
    developmentTest: predictGraphOnly(rawScores.developmentTest.graph, selectedGraphPolicy),
    holdout: predictGraphOnly(rawScores.holdout.graph, selectedGraphPolicy),
  };
  } else if (selectedGraphPolicy.kind === 'graph-consensus') {
  graphPredictions = {
    validation: predictConsensus(graphConsensusScores.validation, baselinePolicy.classicalThreshold, selectedGraphPolicy.gateThresholds, ['linear', 'temporal', 'q5', 'q13', 'graph'], selectedGraphPolicy.need),
    developmentTest: predictConsensus(graphConsensusScores.developmentTest, baselinePolicy.classicalThreshold, selectedGraphPolicy.gateThresholds, ['linear', 'temporal', 'q5', 'q13', 'graph'], selectedGraphPolicy.need),
    holdout: predictConsensus(graphConsensusScores.holdout, baselinePolicy.classicalThreshold, selectedGraphPolicy.gateThresholds, ['linear', 'temporal', 'q5', 'q13', 'graph'], selectedGraphPolicy.need),
  };
} else if (selectedGraphPolicy.kind === 'graph-fp-veto') {
  const consensusBase = {
    validation: predictConsensus(graphConsensusScores.validation, baselinePolicy.classicalThreshold, graphModel.graphConsensus.gateThresholds, ['linear', 'temporal', 'q5', 'q13', 'graph'], graphModel.graphConsensus.need),
    developmentTest: predictConsensus(graphConsensusScores.developmentTest, baselinePolicy.classicalThreshold, graphModel.graphConsensus.gateThresholds, ['linear', 'temporal', 'q5', 'q13', 'graph'], graphModel.graphConsensus.need),
    holdout: predictConsensus(graphConsensusScores.holdout, baselinePolicy.classicalThreshold, graphModel.graphConsensus.gateThresholds, ['linear', 'temporal', 'q5', 'q13', 'graph'], graphModel.graphConsensus.need),
  };
  graphPredictions = {
    validation: predictFpVeto(consensusBase.validation, fpScores.validation, selectedGraphPolicy.threshold),
    developmentTest: predictFpVeto(consensusBase.developmentTest, fpScores.developmentTest, selectedGraphPolicy.threshold),
    holdout: predictFpVeto(consensusBase.holdout, fpScores.holdout, selectedGraphPolicy.threshold),
  };
} else {
  graphPredictions = {
    validation: baselinePredictions.validation,
    developmentTest: baselinePredictions.developmentTest,
    holdout: baselinePredictions.holdout,
  };
}

const graphSelected = {
  kind: selectedGraphPolicy.kind,
  policy: selectedGraphPolicy,
  validation: evaluatePartition(partitions.validation, graphPredictions.validation),
  developmentTest: evaluatePartition(partitions.developmentTest, graphPredictions.developmentTest),
  holdout: evaluatePartition(partitions.holdout, graphPredictions.holdout),
  deltaFromBaseline: explainDelta(evaluatePartition(partitions.holdout, graphPredictions.holdout), baseline.holdout),
};

console.log(JSON.stringify({
  protocol: 'ELLIPTIC_GRAPH_AML_V1',
  version: dataset.version || 'unknown',
  boundaries: split.boundaries,
  baseline,
  graphAblations,
  graphSelected,
  integrity: {
    holdoutUsedForTraining: false,
    holdoutUsedForSelection: false,
    selectionPartitions: ['validation', 'developmentTest'],
    temporalLeakageGuard: true,
    graphNeighborLabelsRestrictedToTrain: true,
  },
}, null, 2));
