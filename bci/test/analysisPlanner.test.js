import { describe, it, expect } from 'vitest';
import { planEngines, candidateEnginesForTargetType, availableCapabilitiesForTargetType } from '../src/services/analysisPlanner.js';
import { getCapability, listCapabilities, registerCapability } from '../src/engines/capabilities.js';

describe('planEngines (pure)', () => {
  it('plans passive repository engines', () => expect(planEngines('REPOSITORY', 'PASSIVE').map((p) => p.engineId).sort()).toEqual(['osv-scanner','semgrep','trivy']));
  it('withholds active web engines at PASSIVE', () => expect(planEngines('DOMAIN', 'PASSIVE')).toEqual([]));
  it('plans safe-active web engines without restricted engines', () => expect(planEngines('DOMAIN', 'SAFE_ACTIVE').map((p) => p.engineId).sort()).toEqual(['http-fuzz','nuclei']));
  it('maps every advanced capability to its real adapter', () => {
    expect(planEngines('DOMAIN','SAFE_ACTIVE','FUZZ').map((p)=>p.engineId)).toEqual(['http-fuzz']);
    expect(planEngines('DOMAIN','RESTRICTED','INTRUSIVE').map((p)=>p.engineId)).toEqual(['intrusive-validation']);
    expect(planEngines('DOMAIN','RESTRICTED','DOS').map((p)=>p.engineId)).toEqual(['availability-probe']);
  });
  it('does not run restricted adapters below RESTRICTED', () => {
    expect(planEngines('DOMAIN','SAFE_ACTIVE','INTRUSIVE')).toEqual([]);
    expect(planEngines('DOMAIN','AUTHENTICATED','DOS')).toEqual([]);
  });
  it('returns no plan for unknown capabilities', () => expect(planEngines('DOMAIN','RESTRICTED','DOES_NOT_EXIST')).toEqual([]));
});

describe('dynamic capability registry', () => {
  it('ships the advanced capabilities', () => expect(listCapabilities().map((c)=>c.id)).toEqual(expect.arrayContaining(['FUZZ','INTRUSIVE','DOS'])));
  it('accepts future capabilities without planner rewrites', () => {
    registerCapability({ id:'CUSTOM_ANALYSIS', name:'Custom Analysis' });
    expect(getCapability('CUSTOM_ANALYSIS')?.name).toBe('Custom Analysis');
    expect(planEngines('DOMAIN','RESTRICTED','CUSTOM_ANALYSIS')).toEqual([]);
  });
  it('reports real target support', () => {
    const caps=availableCapabilitiesForTargetType('DOMAIN');
    for (const id of ['SAFE_ACTIVE','FUZZ','INTRUSIVE','DOS']) expect(caps.find((c)=>c.id===id)?.supported).toBe(true);
  });
});

describe('candidateEnginesForTargetType', () => {
  it('lists all registered DOMAIN candidates', () => expect(candidateEnginesForTargetType('DOMAIN').map((p)=>p.engineId).sort()).toEqual(['availability-probe','http-fuzz','intrusive-validation','nuclei']));
});
