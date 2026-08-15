import { describe, expect, it } from 'vitest';
import { classifyData, hashRecord, publicModelRegistry, verifyDecisionRecordIntegrity } from './decisionIntelligence.js';
import { getMetricsSnapshot, recordRequestMetric } from '../lib/requestMetrics.js';

describe('decision intelligence', () => {
  it('defaults sensitive operational categories to confidential', () => {
    expect(classifyData('savunma')).toBe('CONFIDENTIAL');
    expect(classifyData('bddk')).toBe('CONFIDENTIAL');
    expect(classifyData('ekonomi')).toBe('INTERNAL');
  });

  it('honors a valid explicit classification', () => {
    expect(classifyData('ekonomi', 'restricted')).toBe('RESTRICTED');
    expect(classifyData('ekonomi', 'invalid')).toBe('INTERNAL');
  });

  it('publishes the configured model registry without credentials', () => {
    const models = publicModelRegistry();
    expect(models.length).toBeGreaterThan(0);
    expect(models.some((item) => item.model === 'claude-sonnet-4-6')).toBe(true);
    expect(JSON.stringify(models)).not.toContain('API_KEY');
  });
});

describe('decision record integrity', () => {
  it('produces the same hash regardless of key order', () => {
    expect(hashRecord({ a: 1, b: 2 })).toBe(hashRecord({ b: 2, a: 1 }));
  });

  it('produces a different hash when content changes', () => {
    expect(hashRecord({ a: 1 })).not.toBe(hashRecord({ a: 2 }));
  });

  it('verifies an untampered record as ok', () => {
    const requestPayload = { category: 'ekonomi', prompt: 'test' };
    const evidence = { provider: 'Claude' };
    const row = {
      analysis_id: 1, user_code: 'u1', category: 'ekonomi',
      request_payload: requestPayload, provenance: {}, data_quality: {},
      evidence, decision_trace: {}, ai_provider: 'Claude',
      prompt_version: 'v1', data_classification: 'INTERNAL',
    };
    row.input_hash = hashRecord(row.request_payload);
    row.evidence_hash = hashRecord(row.evidence);
    row.record_hash = hashRecord({
      analysisId: row.analysis_id, userCode: row.user_code, category: row.category,
      requestPayload: row.request_payload, provenance: row.provenance, dataQuality: row.data_quality,
      evidence: row.evidence, decisionTrace: row.decision_trace, aiProvider: row.ai_provider,
      promptVersion: row.prompt_version, dataClassification: row.data_classification,
    });
    expect(verifyDecisionRecordIntegrity(row).ok).toBe(true);
  });

  it('flags a tampered request payload', () => {
    const row = {
      analysis_id: 1, user_code: 'u1', category: 'ekonomi',
      request_payload: { prompt: 'original' }, provenance: {}, data_quality: {},
      evidence: {}, decision_trace: {}, ai_provider: 'Claude',
      prompt_version: 'v1', data_classification: 'INTERNAL',
    };
    row.input_hash = hashRecord({ prompt: 'original' });
    row.request_payload = { prompt: 'tampered' };
    const result = verifyDecisionRecordIntegrity(row);
    expect(result.ok).toBe(false);
    expect(result.checks.input).toBe(false);
  });

  it('reports not-found for a missing record', () => {
    expect(verifyDecisionRecordIntegrity(null)).toEqual({ ok: false, reason: 'not-found' });
  });
});

describe('request metrics', () => {
  it('records counts, failures and percentiles', () => {
    const name = `unit-${Date.now()}`;
    recordRequestMetric(name, 10, 200);
    recordRequestMetric(name, 30, 500);
    const item = getMetricsSnapshot().find((entry) => entry.name === name);
    expect(item.count).toBe(2);
    expect(item.errors).toBe(1);
    expect(item.p50Ms).toBe(10);
    expect(item.p95Ms).toBe(30);
  });
});
