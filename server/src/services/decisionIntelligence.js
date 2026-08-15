import crypto from 'crypto';
import { query } from './database.js';
import { logger } from '../lib/logger.js';

export const ANALYSIS_PROMPT_VERSION = '2026-08-12-v1';
export const DEFAULT_RETENTION_DAYS = Number(process.env.DECISION_RETENTION_DAYS || 365);

/**
 * Deterministic hash of a JSON-shaped value: sorts object keys recursively
 * so the same logical content always hashes the same way regardless of key
 * insertion order, then sha256s the canonical string. Used to make
 * decision records, evidence and analysis inputs tamper-evident.
 */
function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((acc, key) => {
      acc[key] = canonicalize(value[key]);
      return acc;
    }, {});
  }
  return value;
}

export function hashRecord(value) {
  return crypto.createHash('sha256').update(JSON.stringify(canonicalize(value || {}))).digest('hex');
}

/**
 * Recomputes the input/evidence/record hashes from a stored decision_records
 * row and compares them against the hashes captured at write time. Returns
 * per-field ok flags plus an overall verdict — used to detect any
 * out-of-band modification of a record after it was saved.
 */
export function verifyDecisionRecordIntegrity(row) {
  if (!row) return { ok: false, reason: 'not-found' };
  const checks = {
    input: !row.input_hash || hashRecord(row.request_payload) === row.input_hash,
    evidence: !row.evidence_hash || hashRecord(row.evidence) === row.evidence_hash,
    record: !row.record_hash || hashRecord({
      analysisId: row.analysis_id,
      userCode: row.user_code,
      category: row.category,
      requestPayload: row.request_payload,
      provenance: row.provenance,
      dataQuality: row.data_quality,
      evidence: row.evidence,
      decisionTrace: row.decision_trace,
      aiProvider: row.ai_provider,
      promptVersion: row.prompt_version,
      dataClassification: row.data_classification,
    }) === row.record_hash,
  };
  return { ok: checks.input && checks.evidence && checks.record, checks };
}

export async function ensureDecisionTables() {
  if (!process.env.DATABASE_URL) return;
  await query(`
    CREATE TABLE IF NOT EXISTS decision_records (
      id SERIAL PRIMARY KEY,
      analysis_id INTEGER,
      replay_of INTEGER,
      user_code VARCHAR(50) NOT NULL,
      category VARCHAR(50),
      title TEXT,
      prompt TEXT,
      request_payload JSONB,
      provenance JSONB,
      data_quality JSONB,
      evidence JSONB,
      decision_trace JSONB,
      ai_provider VARCHAR(100),
      model_name VARCHAR(100),
      prompt_version VARCHAR(50),
      data_classification VARCHAR(30) DEFAULT 'INTERNAL',
      duration_ms INTEGER,
      outcome JSONB,
      outcome_updated_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
  await query(`ALTER TABLE decision_records ADD COLUMN IF NOT EXISTS input_hash VARCHAR(64);`);
  await query(`ALTER TABLE decision_records ADD COLUMN IF NOT EXISTS evidence_hash VARCHAR(64);`);
  await query(`ALTER TABLE decision_records ADD COLUMN IF NOT EXISTS record_hash VARCHAR(64);`);
  await query(`CREATE INDEX IF NOT EXISTS idx_decision_records_analysis ON decision_records(analysis_id);`);
  await query(`CREATE INDEX IF NOT EXISTS idx_decision_records_user ON decision_records(user_code, created_at DESC);`);
  await query(`CREATE INDEX IF NOT EXISTS idx_decision_records_category ON decision_records(category, created_at DESC);`);
  logger.info('Decision intelligence tables ready');
}

function modelForProvider(provider = '') {
  if (provider.includes('Claude')) return 'claude-sonnet-4-6';
  if (provider.includes('Gemini')) return 'gemini-3.5-flash';
  if (provider.includes('GPT-4o')) return 'gpt-4o';
  return null;
}

export function classifyData(category, requested = null) {
  const allowed = new Set(['PUBLIC', 'INTERNAL', 'CONFIDENTIAL', 'RESTRICTED']);
  if (requested && allowed.has(String(requested).toUpperCase())) return String(requested).toUpperCase();
  if (['savunma', 'saldiri', 'bddk', 'btk', 'cok-alanli'].includes(category)) return 'CONFIDENTIAL';
  return 'INTERNAL';
}

export function publicModelRegistry() {
  return [
    { provider: 'Anthropic', model: 'claude-sonnet-4-6', purpose: 'analysis' },
    { provider: 'Google', model: 'gemini-3.5-flash', purpose: 'fallback-analysis' },
    { provider: 'OpenAI', model: 'gpt-4o', purpose: 'fallback-analysis' },
    { provider: 'Anthropic', model: 'claude-haiku-4-5-20251001', purpose: 'voice-intent' },
  ];
}

export async function saveDecisionRecord({
  analysisId = null,
  replayOf = null,
  userCode,
  category,
  title,
  prompt,
  requestPayload,
  provenance,
  dataQuality,
  evidence,
  decisionTrace,
  aiProvider,
  dataClassification,
  durationMs,
}) {
  if (!process.env.DATABASE_URL || !userCode) return null;
  try {
    const resolvedClassification = dataClassification || classifyData(category);
    const inputHash = hashRecord(requestPayload);
    const evidenceHash = hashRecord(evidence);
    const recordHash = hashRecord({
      analysisId, userCode, category: category || null, requestPayload: requestPayload || {},
      provenance: provenance || {}, dataQuality: dataQuality || {}, evidence: evidence || {},
      decisionTrace: decisionTrace || {}, aiProvider: aiProvider || null,
      promptVersion: ANALYSIS_PROMPT_VERSION, dataClassification: resolvedClassification,
    });
    const { rows } = await query(
      `INSERT INTO decision_records
       (analysis_id, replay_of, user_code, category, title, prompt, request_payload,
        provenance, data_quality, evidence, decision_trace, ai_provider, model_name,
        prompt_version, data_classification, duration_ms, input_hash, evidence_hash, record_hash)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb,$10::jsonb,$11::jsonb,$12,$13,$14,$15,$16,$17,$18,$19)
       RETURNING id`,
      [
        analysisId, replayOf, userCode, category || null, title || null, prompt || null,
        JSON.stringify(requestPayload || {}), JSON.stringify(provenance || {}),
        JSON.stringify(dataQuality || {}), JSON.stringify(evidence || {}),
        JSON.stringify(decisionTrace || {}), aiProvider || null, modelForProvider(aiProvider),
        ANALYSIS_PROMPT_VERSION, resolvedClassification, durationMs || null,
        inputHash, evidenceHash, recordHash,
      ]
    );
    return rows[0]?.id || null;
  } catch (err) {
    logger.warn({ err }, '[DecisionIntelligence] record write failed');
    return null;
  }
}

export async function getDecisionByAnalysisId(analysisId, user) {
  if (!process.env.DATABASE_URL) return null;
  const params = [analysisId];
  let sql = 'SELECT * FROM decision_records WHERE analysis_id = $1';
  if (!user?.isAdmin) {
    params.push(user?.userCode || '');
    sql += ' AND user_code = $2';
  }
  sql += ' ORDER BY created_at DESC LIMIT 1';
  const { rows } = await query(sql, params);
  return rows[0] || null;
}

export async function updateDecisionOutcome(analysisId, user, outcome) {
  if (!process.env.DATABASE_URL) return null;
  const existing = await getDecisionByAnalysisId(analysisId, user);
  if (!existing) return null;
  const { rows } = await query(
    `UPDATE decision_records SET outcome = $1::jsonb, outcome_updated_at = NOW()
     WHERE id = $2 RETURNING *`,
    [JSON.stringify(outcome || {}), existing.id]
  );
  return rows[0] || null;
}

export async function getDecisionOverview() {
  if (!process.env.DATABASE_URL) {
    return { totalDecisions: 0, recentDecisions: 0, outcomesRecorded: 0, pendingApprovals: 0 };
  }
  const [decisionCounts, approvals] = await Promise.all([
    query(`SELECT COUNT(*)::int AS total,
                  COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours')::int AS recent,
                  COUNT(*) FILTER (WHERE outcome IS NOT NULL)::int AS outcomes
           FROM decision_records`),
    query(`SELECT COUNT(*)::int AS count FROM approval_tokens
           WHERE approved = FALSE AND expires_at > NOW()`),
  ]);
  return {
    totalDecisions: decisionCounts.rows[0]?.total || 0,
    recentDecisions: decisionCounts.rows[0]?.recent || 0,
    outcomesRecorded: decisionCounts.rows[0]?.outcomes || 0,
    pendingApprovals: approvals.rows[0]?.count || 0,
  };
}

export async function getRiskOverview(limit = 25) {
  if (!process.env.DATABASE_URL) return [];
  const safeLimit = Math.max(1, Math.min(100, Number(limit) || 25));
  const { rows } = await query(
    `SELECT id, user_code, category, title, ai_provider,
            fraud_transaction_count, fraud_flagged_count, created_at
     FROM analyses
     WHERE fraud_flagged_count IS NOT NULL OR category IN ('savunma','saldiri','bddk','btk','cok-alanli')
     ORDER BY created_at DESC LIMIT $1`,
    [safeLimit]
  );
  return rows.map((row) => ({
    ...row,
    flagRate: row.fraud_transaction_count
      ? Math.round((row.fraud_flagged_count / row.fraud_transaction_count) * 1000) / 10
      : null,
  }));
}

export async function purgeExpiredDecisionRecords() {
  if (!process.env.DATABASE_URL || !Number.isFinite(DEFAULT_RETENTION_DAYS) || DEFAULT_RETENTION_DAYS <= 0) return 0;
  const { rowCount } = await query(
    `DELETE FROM decision_records
     WHERE created_at < NOW() - ($1::text || ' days')::interval`,
    [String(DEFAULT_RETENTION_DAYS)]
  );
  return rowCount || 0;
}
