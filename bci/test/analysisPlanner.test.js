import { describe, it, expect } from 'vitest';
import { planEngines, candidateEnginesForTargetType, availableCapabilitiesForTargetType } from '../src/services/analysisPlanner.js';
import { getCapability, listCapabilities, registerCapability } from '../src/engines/capabilities.js';

describe('planEngines (pure)', () => {
  it('plans the full passive repository triad', () => {
    expect(planEngines('REPOSITORY', 'PASSIVE').map((p) => p.engineId).sort()).toEqual(['osv-scanner', 'semgrep', 'trivy']);
  });
  it('plans Trivy in image mode for a CONTAINER', () => {
    expect(planEngines('CONTAINER', 'PASSIVE')).toEqual([{ engineId: 'trivy', intrusiveness: 'PASSIVE', mode: 'image' }]);
  });
  it('withholds Nuclei for DOMAIN at PASSIVE and plans it at SAFE_ACTIVE', () => {
    expect(planEngines('DOMAIN', 'PASSIVE')).toEqual([]);
    expect(planEngines('DOMAIN', 'SAFE_ACTIVE').map((p) => p.engineId)).toEqual(['nuclei']);
  });
  it('filters by real engine capability metadata', () => {
    expect(planEngines('DOMAIN', 'SAFE_ACTIVE', 'SAFE_ACTIVE').map((p) => p.engineId)).toEqual(['nuclei']);
    expect(planEngines('DOMAIN', 'RESTRICTED', 'FUZZ')).toEqual([]);
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
    const ids = listCapabilities().map((c) => c.id);
    expect(ids).toEqual(expect.arrayContaining(['FUZZ', 'INTRUSIVE', 'DOS']));
  });
  it('accepts future capabilities without changing planner control flow', () => {
    registerCapability({ id: 'CUSTOM_ANALYSIS', name: 'Custom Analysis' });
    expect(getCapability('CUSTOM_ANALYSIS')?.name).toBe('Custom Analysis');
    expect(planEngines('DOMAIN', 'RESTRICTED', 'CUSTOM_ANALYSIS')).toEqual([]);
  });
  it('reports target support separately from registry presence', () => {
    const caps = availableCapabilitiesForTargetType('DOMAIN');
    expect(caps.find((c) => c.id === 'SAFE_ACTIVE')?.supported).toBe(true);
    expect(caps.find((c) => c.id === 'FUZZ')?.supported).toBe(false);
  });
});

describe('candidateEnginesForTargetType', () => {
  it('lists nuclei for DOMAIN independent of requested class', () => {
    expect(candidateEnginesForTargetType('DOMAIN').map((p) => p.engineId)).toEqual(['nuclei']);
  });
});
