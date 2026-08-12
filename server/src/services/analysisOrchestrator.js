import { logger } from '../lib/logger.js';

/**
 * Central orchestration primitives for ANATOLIA-Q analysis flows.
 *
 * The user should not have to choose or compare internal engines. This layer
 * keeps provenance, quality checks and execution stages behind the scenes so
 * routes can return one clear decision-support result while the platform
 * retains an auditable execution trace.
 */

export const DATA_SOURCE_TYPES = Object.freeze({
  AI_GENERATED: 'ai-generated',
  UPLOADED: 'uploaded',
  INSTITUTIONAL_API: 'institutional-api',
  MANUAL: 'manual',
});

export function resolveDataProvenance({
  hasUploadedDocument = false,
  hasRealTransactions = false,
  hasRealScenarios = false,
  hasRealOptimization = false,
  institutionalSource = null,
} = {}) {
  if (institutionalSource) {
    return {
      type: DATA_SOURCE_TYPES.INSTITUTIONAL_API,
      source: institutionalSource,
      verifiedInput: true,
    };
  }

  if (hasRealTransactions || hasRealScenarios || hasRealOptimization || hasUploadedDocument) {
    return {
      type: DATA_SOURCE_TYPES.UPLOADED,
      source: 'user-upload',
      verifiedInput: hasRealTransactions || hasRealScenarios || hasRealOptimization,
    };
  }

  return {
    type: DATA_SOURCE_TYPES.AI_GENERATED,
    source: 'model-generated',
    verifiedInput: false,
  };
}

export function assessDataQuality({ provenance, recordCount = 0, warnings = [] } = {}) {
  let score = provenance?.verifiedInput ? 85 : 55;
  if (provenance?.type === DATA_SOURCE_TYPES.INSTITUTIONAL_API) score = 95;
  if (recordCount > 0) score += Math.min(5, Math.floor(recordCount / 20));
  score -= Math.min(25, (warnings?.length || 0) * 5);
  score = Math.max(0, Math.min(100, score));

  return {
    score,
    level: score >= 85 ? 'high' : score >= 65 ? 'medium' : 'limited',
    warningCount: warnings?.length || 0,
  };
}

export function createDecisionTrace({ category, quantumMode, provenance, dataQuality } = {}) {
  const startedAt = new Date().toISOString();
  return {
    version: 1,
    startedAt,
    category: category || null,
    quantumRequested: !!quantumMode,
    provenance: provenance || null,
    dataQuality: dataQuality || null,
    stages: [
      { stage: 'ingest', status: 'completed', at: startedAt },
      { stage: 'validate', status: 'completed', at: startedAt },
      { stage: 'normalize', status: 'completed', at: startedAt },
    ],
  };
}

export function markDecisionStage(trace, stage, status = 'completed', metadata = null) {
  if (!trace?.stages) return trace;
  trace.stages.push({
    stage,
    status,
    at: new Date().toISOString(),
    ...(metadata ? { metadata } : {}),
  });
  return trace;
}

export function buildEvidenceSummary({ provenance, dataQuality, provider, quantum, fraud, optimizer } = {}) {
  return {
    source: provenance?.type || DATA_SOURCE_TYPES.AI_GENERATED,
    sourceName: provenance?.source || null,
    dataQuality: dataQuality || null,
    aiProvider: provider || null,
    quantum: quantum
      ? { backend: quantum.backend || null, shots: quantum.shots || null, dataSource: quantum.dataSource || null }
      : null,
    fraud: fraud
      ? { backend: fraud.backend || null, transactionCount: fraud.transactionCount || 0, flaggedCount: fraud.flaggedCount || 0, dataSource: fraud.dataSource || null }
      : null,
    optimizer: optimizer
      ? { backend: optimizer.backend || null, dataSource: optimizer.dataSource || null }
      : null,
  };
}

/**
 * Executes named stages sequentially and records their outcome. It is kept
 * deliberately generic so generation, replay and future institutional
 * connector flows can share the same orchestration contract.
 */
export async function runAnalysisStages(trace, stages = []) {
  const results = {};
  for (const entry of stages) {
    const name = entry?.name;
    if (!name || typeof entry.run !== 'function') continue;
    const started = Date.now();
    try {
      results[name] = await entry.run(results);
      markDecisionStage(trace, name, 'completed', { durationMs: Date.now() - started });
    } catch (err) {
      markDecisionStage(trace, name, 'failed', { durationMs: Date.now() - started, error: err?.message || String(err) });
      logger.error({ err, stage: name }, '[AnalysisOrchestrator] stage failed');
      throw err;
    }
  }
  return results;
}
