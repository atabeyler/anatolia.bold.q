import { describe, it, expect } from 'vitest';
import { planEngines, candidateEnginesForTargetType } from '../src/services/analysisPlanner.js';

describe('planEngines (pure)', () => {
  it('plans the full SAST/SCA/secrets triad for a REPOSITORY, even at PASSIVE', () => {
    const plan = planEngines('REPOSITORY', 'PASSIVE');
    expect(plan.map((p) => p.engineId).sort()).toEqual(['osv-scanner', 'semgrep', 'trivy']);
  });

  it('plans Trivy in image mode for a CONTAINER', () => {
    const plan = planEngines('CONTAINER', 'PASSIVE');
    expect(plan).toEqual([{ engineId: 'trivy', intrusiveness: 'PASSIVE', mode: 'image' }]);
  });

  it('withholds Nuclei for a DOMAIN target at PASSIVE (it needs SAFE_ACTIVE)', () => {
    expect(planEngines('DOMAIN', 'PASSIVE')).toEqual([]);
  });

  it('plans Nuclei for a DOMAIN target once SAFE_ACTIVE is authorized', () => {
    const plan = planEngines('DOMAIN', 'SAFE_ACTIVE');
    expect(plan.map((p) => p.engineId)).toEqual(['nuclei']);
  });

  it('plans naabu for IP/CIDR only at SAFE_ACTIVE or above', () => {
    expect(planEngines('IP', 'PASSIVE')).toEqual([]);
    expect(planEngines('CIDR', 'SAFE_ACTIVE').map((p) => p.engineId)).toEqual(['naabu']);
  });

  it('has no plan (honest zero coverage) for target types with no engine adapter yet', () => {
    expect(planEngines('CLOUD_ACCOUNT', 'RESTRICTED')).toEqual([]);
    expect(planEngines('KUBERNETES_CLUSTER', 'RESTRICTED')).toEqual([]);
  });

  it('a higher authorized class than an engine needs still includes that engine', () => {
    expect(planEngines('DOMAIN', 'RESTRICTED').map((p) => p.engineId)).toEqual(['nuclei']);
  });
});

describe('candidateEnginesForTargetType (compatibility, independent of requested class)', () => {
  it('lists nuclei for DOMAIN even though it would not be recommended at PASSIVE', () => {
    expect(candidateEnginesForTargetType('DOMAIN').map((p) => p.engineId)).toEqual(['nuclei']);
  });

  it('is empty for target types with no engine adapter yet', () => {
    expect(candidateEnginesForTargetType('CLOUD_ACCOUNT')).toEqual([]);
  });
});
