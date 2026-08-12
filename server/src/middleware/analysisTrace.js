import {
  assessDataQuality,
  buildEvidenceSummary,
  createDecisionTrace,
  markDecisionStage,
  resolveDataProvenance,
} from '../services/analysisOrchestrator.js';
import {
  classifyData,
  saveDecisionRecord,
} from '../services/decisionIntelligence.js';
import { recordRequestMetric } from '../lib/requestMetrics.js';

function recordCountFromRequest(body = {}) {
  if (Array.isArray(body.realTransactions)) return body.realTransactions.length;
  if (Array.isArray(body.realScenarios)) return body.realScenarios.length;
  if (Array.isArray(body.realOptimization?.items)) return body.realOptimization.items.length;
  return 0;
}

function sanitizeRequest(body = {}) {
  return {
    category: body.category || null,
    title: body.title || null,
    prompt: body.prompt || null,
    quantumMode: !!body.quantumMode,
    lang: body.lang || 'tr',
    documentContext: body.documentContext || null,
    realTransactions: body.realTransactions || null,
    realScenarios: body.realScenarios || null,
    realOptimization: body.realOptimization || null,
    dataClassification: body.dataClassification || null,
  };
}

export function analysisTraceMiddleware(req, res, next) {
  if (req.method !== 'POST' || req.path !== '/generate') return next();

  const startedAt = Date.now();
  const originalJson = res.json.bind(res);

  res.json = (body) => {
    const durationMs = Date.now() - startedAt;
    recordRequestMetric('analysis.generate', durationMs, res.statusCode || 200);

    if (body?.success) {
      const requestBody = req.body || {};
      const hasRealTransactions = Array.isArray(requestBody.realTransactions) && requestBody.realTransactions.length > 0;
      const hasRealScenarios = Array.isArray(requestBody.realScenarios) && requestBody.realScenarios.length > 0;
      const hasRealOptimization = Array.isArray(requestBody.realOptimization?.items) && requestBody.realOptimization.items.length > 0;
      const provenance = resolveDataProvenance({
        hasUploadedDocument: !!requestBody.documentContext,
        hasRealTransactions,
        hasRealScenarios,
        hasRealOptimization,
        institutionalSource: requestBody.institutionalSource || null,
      });
      const warnings = body.quantumWarning ? [body.quantumWarning] : [];
      const dataQuality = assessDataQuality({
        provenance,
        recordCount: recordCountFromRequest(requestBody),
        warnings,
      });
      const trace = createDecisionTrace({
        category: requestBody.category,
        quantumMode: requestBody.quantumMode,
        provenance,
        dataQuality,
      });
      markDecisionStage(trace, 'research', 'completed');
      markDecisionStage(trace, 'ai-analysis', body.provider ? 'completed' : 'failed', { provider: body.provider || null });
      if (requestBody.quantumMode) {
        markDecisionStage(
          trace,
          'quantum-verification',
          body.quantum || body.fraud || body.optimizer ? 'completed' : 'limited',
          { warning: body.quantumWarning || null }
        );
      }
      markDecisionStage(trace, 'report', 'completed');

      const evidence = buildEvidenceSummary({
        provenance,
        dataQuality,
        provider: body.provider,
        quantum: body.quantum,
        fraud: body.fraud,
        optimizer: body.optimizer,
      });
      const dataClassification = classifyData(requestBody.category, requestBody.dataClassification);
      const replayOf = Number(req.headers['x-anatolia-replay-of']) || null;

      saveDecisionRecord({
        analysisId: body.analysisId || null,
        replayOf,
        userCode: req.user?.userCode,
        category: requestBody.category,
        title: requestBody.title || requestBody.prompt?.slice(0, 80),
        prompt: requestBody.prompt,
        requestPayload: sanitizeRequest(requestBody),
        provenance,
        dataQuality,
        evidence,
        decisionTrace: trace,
        aiProvider: body.provider,
        dataClassification,
        durationMs,
      }).catch(() => {});

      body.decisionMeta = {
        source: provenance.type,
        dataQuality: dataQuality.level,
        classification: dataClassification,
        traceRecorded: true,
      };
    }

    return originalJson(body);
  };

  next();
}
