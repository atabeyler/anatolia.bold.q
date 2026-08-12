import express from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { query } from '../services/database.js';
import { getStatus as getAiStatus } from '../services/ai.js';
import { isIbmHardwareConfigured } from '../services/quantum.js';
import { isS3Configured } from '../lib/objectStorage.js';
import { getConnectorStatuses, listConnectors } from '../services/connectors.js';
import { getMetricsSnapshot } from '../lib/requestMetrics.js';
import {
  ANALYSIS_PROMPT_VERSION,
  DEFAULT_RETENTION_DAYS,
  getDecisionByAnalysisId,
  getDecisionOverview,
  getRiskOverview,
  publicModelRegistry,
  updateDecisionOutcome,
} from '../services/decisionIntelligence.js';

const router = express.Router();
const asyncRoute = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

function requireAdmin(req, res, next) {
  if (!req.user?.isAdmin) return res.status(403).json({ error: 'Yetkisiz' });
  next();
}

async function databaseHealth() {
  if (!process.env.DATABASE_URL) return { configured: false, ok: false };
  try {
    await query('SELECT 1');
    return { configured: true, ok: true };
  } catch (err) {
    return { configured: true, ok: false, error: err?.message || String(err) };
  }
}

router.get('/health/live', (req, res) => {
  res.json({ ok: true, uptime: process.uptime(), timestamp: Date.now() });
});

router.get('/health/ready', asyncRoute(async (req, res) => {
  const db = await databaseHealth();
  const ai = getAiStatus();
  const aiReady = Object.values(ai).some(Boolean);
  const ready = aiReady && (!process.env.DATABASE_URL || db.ok);
  res.status(ready ? 200 : 503).json({
    ready,
    database: db,
    ai: { configured: aiReady },
    quantum: { simulatorExpected: true, ibmConfigured: isIbmHardwareConfigured() },
    storage: { persistentObjectStorageConfigured: isS3Configured() },
    redis: { configured: !!process.env.REDIS_URL },
  });
}));

router.use(authMiddleware);

router.get('/models', (req, res) => {
  res.json({ promptVersion: ANALYSIS_PROMPT_VERSION, models: publicModelRegistry() });
});

router.get('/connectors', requireAdmin, asyncRoute(async (req, res) => {
  const statuses = await getConnectorStatuses();
  res.json({ registered: listConnectors(), statuses });
}));

router.get('/metrics', requireAdmin, (req, res) => {
  res.json({ metrics: getMetricsSnapshot() });
});

router.get('/retention', requireAdmin, (req, res) => {
  res.json({ decisionRetentionDays: DEFAULT_RETENTION_DAYS });
});

router.get('/overview', requireAdmin, asyncRoute(async (req, res) => {
  const [database, connectors, decisions, risks] = await Promise.all([
    databaseHealth(),
    getConnectorStatuses(),
    getDecisionOverview(),
    getRiskOverview(10),
  ]);
  res.json({
    health: {
      database,
      ai: getAiStatus(),
      ibmQuantumConfigured: isIbmHardwareConfigured(),
      storageConfigured: isS3Configured(),
      redisConfigured: !!process.env.REDIS_URL,
    },
    connectors,
    decisions,
    recentRisks: risks,
    metrics: getMetricsSnapshot(),
  });
}));

router.get('/risk', requireAdmin, asyncRoute(async (req, res) => {
  res.json({ items: await getRiskOverview(req.query.limit) });
}));

router.get('/decisions/:analysisId', asyncRoute(async (req, res) => {
  const record = await getDecisionByAnalysisId(Number(req.params.analysisId), req.user);
  if (!record) return res.status(404).json({ error: 'Karar izi bulunamadı' });
  res.json({ record });
}));

router.post('/decisions/:analysisId/outcome', asyncRoute(async (req, res) => {
  const analysisId = Number(req.params.analysisId);
  const { status, summary, score, notes } = req.body || {};
  if (!status && !summary && score === undefined && !notes) {
    return res.status(400).json({ error: 'Sonuç bilgisi gerekli' });
  }
  const record = await updateDecisionOutcome(analysisId, req.user, {
    status: status || null,
    summary: summary || null,
    score: Number.isFinite(Number(score)) ? Number(score) : null,
    notes: notes || null,
    recordedBy: req.user.userCode,
    recordedAt: new Date().toISOString(),
  });
  if (!record) return res.status(404).json({ error: 'Karar izi bulunamadı' });
  res.json({ success: true, record });
}));

router.post('/decisions/:analysisId/replay', asyncRoute(async (req, res) => {
  const analysisId = Number(req.params.analysisId);
  const record = await getDecisionByAnalysisId(analysisId, req.user);
  if (!record?.request_payload) return res.status(404).json({ error: 'Yeniden çalıştırılabilir analiz bulunamadı' });

  const port = process.env.PORT || 10000;
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/analysis/generate`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: req.headers.authorization,
        'x-anatolia-replay-of': String(record.id),
      },
      body: JSON.stringify({ ...record.request_payload, ...req.body }),
      signal: AbortSignal.timeout(180000),
    });
    const payload = await response.json();
    return res.status(response.status).json({ ...payload, replayOfAnalysisId: analysisId });
  } catch (err) {
    return res.status(502).json({ error: 'Analiz yeniden çalıştırılamadı', detail: err?.message || String(err) });
  }
}));

export default router;
