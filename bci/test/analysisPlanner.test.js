import { describe, it, expect } from 'vitest';
import { planEngines, candidateEnginesForTargetType, availableCapabilitiesForTargetType } from '../src/services/analysisPlanner.js';
import { getCapability, listCapabilities, registerCapability } from '../src/engines/capabilities.js';

describe('planEngines (pure)', () => {
  it('plans the full passive repository triad', () => {
    expect(planEngines('REPOSITORY', 'PASSIVE').map((p) => p.engineId).sort()).toEqual(['osv-scanner', 'semgrep', 'trivy']);
  });
  it('withholds active web engines at PASSIVE', () => {
    expect(planEngines('DOMAIN', 'PASSIVE')).toEqual([]);
  });
  it('plans safe-active web engines when SAFE_ACTIVE is selected', () => {
    expect(planEngines('DOMAIN', 'SAFE_ACTIVE').map((p) => p.engineId).sort()).toEqual(['http-fuzz', 'nuclei']);
  });
  it('filters by real engine capability metadata', () => {
    expect(planEngines('DOMAIN', 'SAFE_ACTIVE', 'SAFE_ACTIVE').map((p) => p.engineId)).toEqual(['nuclei']);
    expect(planEngines('DOMAIN', 'SAFE_ACTIVE', 'FUZZ').map((p) => p.engineId)).toEqual(['http-fuzz']);
    expect(planEngines('DOMAIN', 'RESTRICTED', 'INTRUSIVE')).toEqual([]);
    expect(planEngines('DOMAIN', 'RESTRICTED', 'DOS')).toEqual([]);
  });
  it('returns no plan for an unknown capability', () => {
    expect(planEngines('DOMAIN', 'RESTRICTED', 'DOES_NOT_EXIST')).toEqual([]);
  });
  it('keeps honest zero coverage for target types without adapters', () => {
    expect(planEngines('CLOUD_ACCOUNT', 'RESTRICTED')).toEqual([]);
    expect(planEngines('KUBERNETES_CLUSTER', 'RESTRICTED')).toEqual([]);
  });
});

describe('dynamic capability registry', () => {
  it('ships FUZZ, INTRUSIVE and DOS as first-class capabilities', () => {
    expect(listCapabilities().map((c) => c.id)).toEqual(expect.arrayContaining(['FUZZ', 'INTRUSIVE', 'DOS']));
  });
  it('accepts future capabilities without planner rewrites', () => {
    registerCapability({ id: 'CUSTOM_ANALYSIS', name: 'Custom Analysis' });
    expect(getCapability('CUSTOM_ANALYSIS')?.name).toBe('Custom Analysis');
    expect(planEngines('DOMAIN', 'RESTRICTED', 'CUSTOM_ANALYSIS')).toEqual([]);
  });
  it('reports actual target support separately from registry presence', () => {
    const caps = availableCapabilitiesForTargetType('DOMAIN');
    expect(caps.find((c) => c.id === 'SAFE_ACTIVE')?.supported).toBe(true);
    expect(caps.find((c) => c.id === 'FUZZ')?.supported).toBe(true);
    expect(caps.find((c) => c.id === 'INTRUSIVE')?.supported).toBe(false);
    expect(caps.find((c) => c.id === 'DOS')?.supported).toBe(false);
  });
});

describe('candidateEnginesForTargetType', () => {
  it('lists both safe-active web engines for DOMAIN', () => {
    expect(candidateEnginesForTargetType('DOMAIN').map((p) => p.engineId).sort()).toEqual(['http-fuzz', 'nuclei']);
  });
});
