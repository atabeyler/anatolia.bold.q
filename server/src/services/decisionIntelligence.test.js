import { describe, expect, it } from 'vitest';
import { classifyData, publicModelRegistry } from './decisionIntelligence.js';
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
