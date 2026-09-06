import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeRaw, supportsEngine } from '../src/normalization/normalize.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const load = (name) => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/normalization', name), 'utf8'));

describe('normalization (pure functions over captured real tool output, no binaries needed)', () => {
  it('rejects an engine id with no registered normalizer', () => {
    expect(supportsEngine('nonexistent-engine')).toBe(false);
    expect(() => normalizeRaw('nonexistent-engine', {})).toThrow();
  });

  it('normalizes real Trivy vulnerability findings', () => {
    const observations = normalizeRaw('trivy', load('trivy.json'));
    expect(observations.length).toBeGreaterThan(0);
    expect(observations.every((o) => o.category === 'SCA' && o.component === 'lodash')).toBe(true);
    const known = observations.find((o) => o.cveIds.includes('CVE-2019-10744'));
    expect(known).toBeDefined();
    expect(known.componentVersion).toBe('4.17.4');
    expect(known.engineSeverity).toBe('CRITICAL');
    expect(known.cweIds).toContain('CWE-1321');
    expect(known.capabilityId).toBe('SCA');
  });

  it('normalizes real OSV-Scanner findings', () => {
    const observations = normalizeRaw('osv-scanner', load('osv-scanner.json'));
    expect(observations.length).toBeGreaterThan(0);
    expect(observations.every((o) => o.category === 'SCA' && o.component === 'lodash')).toBe(true);
    expect(observations.every((o) => o.cveIds.every((id) => id.startsWith('CVE-')))).toBe(true);
    expect(observations[0].location).toContain('package-lock.json');
    expect(observations[0].capabilityId).toBe('SCA');
  });

  it('normalizes a real Semgrep finding', () => {
    const [obs] = normalizeRaw('semgrep', load('semgrep.json'));
    expect(obs.category).toBe('SAST');
    expect(obs.ruleId).toBe('tmp.test-eval-detected');
    expect(obs.cweIds).toEqual(['CWE-95']);
    expect(obs.location).toMatch(/app\.js:7$/);
    expect(obs.capabilityId).toBe('SAST');
  });

  it('normalizes a Nuclei finding AND redacts Authorization/Set-Cookie from evidence', () => {
    const [obs] = normalizeRaw('nuclei', load('nuclei.json'));
    expect(obs.category).toBe('WEB');
    expect(obs.ruleId).toBe('bci-web-missing-hsts');
    expect(obs.evidence.request).not.toContain('super-secret-token');
    expect(obs.evidence.request).toContain('[REDACTED]');
    expect(obs.evidence.response).not.toContain('abc123');
    expect(obs.capabilityId).toBe('WEB');
  });

  it('normalizes a naabu open-port finding as NETWORK_DISCOVERY, not a vulnerability', () => {
    const [obs] = normalizeRaw('naabu', load('naabu.json'));
    expect(obs.category).toBe('NETWORK_DISCOVERY');
    expect(obs.location).toBe('127.0.0.1:40091');
    expect(obs.cveIds).toBeUndefined();
    expect(obs.capabilityId).toBe('NETWORK_DISCOVERY');
  });

  it('normalizes only real advanced-adapter anomalies with capability provenance', () => {
    const fuzz = normalizeRaw('http-fuzz', { raw: [{ anomalous: true, parameter: 'q', case: '-1', status: 500 }] });
    const intrusive = normalizeRaw('intrusive-validation', { raw: [{ anomalous: true, method: 'TRACE', status: 200 }] });
    const availability = normalizeRaw('availability-probe', { raw: [{ anomalous: true, sample: 1, status: 503, latencyMs: 20 }] });
    expect(fuzz[0].capabilityId).toBe('FUZZ');
    expect(intrusive[0].capabilityId).toBe('INTRUSIVE');
    expect(availability[0].capabilityId).toBe('DOS');
    expect(normalizeRaw('http-fuzz', { raw: [{ anomalous: false, status: 200 }] })).toEqual([]);
  });
});
