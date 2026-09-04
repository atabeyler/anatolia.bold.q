import { describe, it, expect, beforeEach } from 'vitest';
import { decideExecutionMode, getQuantumPolicy, setQuantumPolicy } from '../src/quantum/executionPolicy.js';
import { COMPUTE_MODES, PROVIDER_HEALTH } from '../src/quantum/QuantumComputeGateway.js';
import { resetDatabase, createOrg } from './helpers/db.js';

const AVAILABLE = { status: PROVIDER_HEALTH.AVAILABLE };
const NOT_CONFIGURED = { status: PROVIDER_HEALTH.NOT_CONFIGURED };

const DENY_ALL_POLICY = { allowQuantumSimulator: false, allowQuantumHardware: false, maxExternalDataClassification: 'PUBLIC' };
const SIM_ONLY_POLICY = { allowQuantumSimulator: true, allowQuantumHardware: false, maxExternalDataClassification: 'PUBLIC' };
const HARDWARE_POLICY = { allowQuantumSimulator: true, allowQuantumHardware: true, maxExternalDataClassification: 'CONFIDENTIAL' };

describe('decideExecutionMode (pure) — spec section 7', () => {
  it('defaults to CLASSICAL when the org has never opted into quantum', () => {
    const decision = decideExecutionMode({
      problemSize: 4, policy: DENY_ALL_POLICY, dataClassification: 'PUBLIC',
      providerHealthById: { quantum_simulator: AVAILABLE, ibm_quantum: AVAILABLE },
      simulatorMaxSize: 10, hardwareMaxSize: 12,
    });
    expect(decision.mode).toBe(COMPUTE_MODES.CLASSICAL);
    expect(decision.reason).toBe('org_policy_denies_quantum');
  });

  it('uses the simulator once policy allows it and it is healthy and the problem fits', () => {
    const decision = decideExecutionMode({
      problemSize: 4, policy: SIM_ONLY_POLICY, dataClassification: 'PUBLIC',
      providerHealthById: { quantum_simulator: AVAILABLE, ibm_quantum: NOT_CONFIGURED },
      simulatorMaxSize: 10, hardwareMaxSize: 12,
    });
    expect(decision.mode).toBe(COMPUTE_MODES.QUANTUM_SIMULATOR);
  });

  it('falls back to CLASSICAL when the simulator is allowed but NOT_CONFIGURED', () => {
    const decision = decideExecutionMode({
      problemSize: 4, policy: SIM_ONLY_POLICY, dataClassification: 'PUBLIC',
      providerHealthById: { quantum_simulator: NOT_CONFIGURED, ibm_quantum: NOT_CONFIGURED },
      simulatorMaxSize: 10, hardwareMaxSize: 12,
    });
    expect(decision.mode).toBe(COMPUTE_MODES.CLASSICAL);
  });

  it('falls back to CLASSICAL when the problem exceeds the simulator qubit ceiling', () => {
    const decision = decideExecutionMode({
      problemSize: 50, policy: SIM_ONLY_POLICY, dataClassification: 'PUBLIC',
      providerHealthById: { quantum_simulator: AVAILABLE, ibm_quantum: NOT_CONFIGURED },
      simulatorMaxSize: 10, hardwareMaxSize: 12,
    });
    expect(decision.mode).toBe(COMPUTE_MODES.CLASSICAL);
  });

  it('uses IBM hardware when policy allows it, data classification permits, and it is available', () => {
    const decision = decideExecutionMode({
      problemSize: 4, policy: HARDWARE_POLICY, dataClassification: 'INTERNAL',
      providerHealthById: { quantum_simulator: AVAILABLE, ibm_quantum: AVAILABLE },
      simulatorMaxSize: 10, hardwareMaxSize: 12,
    });
    expect(decision.mode).toBe(COMPUTE_MODES.QUANTUM_HARDWARE);
  });

  it('SECRET data never reaches external IBM hardware even if the org policy allows quantum hardware generally', () => {
    const decision = decideExecutionMode({
      problemSize: 4, policy: HARDWARE_POLICY, dataClassification: 'SECRET',
      providerHealthById: { quantum_simulator: AVAILABLE, ibm_quantum: AVAILABLE },
      simulatorMaxSize: 10, hardwareMaxSize: 12,
    });
    expect(decision.mode).not.toBe(COMPUTE_MODES.QUANTUM_HARDWARE);
    expect(decision.mode).toBe(COMPUTE_MODES.QUANTUM_SIMULATOR); // stays local instead
    expect(decision.reason).toBe('data_classification_denies_external_quantum');
  });

  it('falls back from IBM to the simulator (not straight to an error) when IBM is unavailable', () => {
    const decision = decideExecutionMode({
      problemSize: 4, policy: HARDWARE_POLICY, dataClassification: 'INTERNAL',
      providerHealthById: { quantum_simulator: AVAILABLE, ibm_quantum: { status: PROVIDER_HEALTH.UNAVAILABLE } },
      simulatorMaxSize: 10, hardwareMaxSize: 12,
    });
    expect(decision.mode).toBe(COMPUTE_MODES.QUANTUM_SIMULATOR);
  });

  it('an unrecognized data classification fails closed (never treated as low-sensitivity)', () => {
    const decision = decideExecutionMode({
      problemSize: 4, policy: HARDWARE_POLICY, dataClassification: 'NOT_A_REAL_CLASSIFICATION',
      providerHealthById: { quantum_simulator: AVAILABLE, ibm_quantum: AVAILABLE },
      simulatorMaxSize: 10, hardwareMaxSize: 12,
    });
    expect(decision.mode).not.toBe(COMPUTE_MODES.QUANTUM_HARDWARE);
  });
});

describe('quantum policy persistence', () => {
  beforeEach(resetDatabase);

  it('defaults to the safe/local-only posture when an org has never set a policy', async () => {
    const orgId = await createOrg();
    const policy = await getQuantumPolicy(orgId);
    expect(policy).toEqual({ allowQuantumSimulator: false, allowQuantumHardware: false, maxExternalDataClassification: 'PUBLIC' });
  });

  it('round-trips a policy update', async () => {
    const orgId = await createOrg();
    await setQuantumPolicy(orgId, { allowQuantumSimulator: true, allowQuantumHardware: false, maxExternalDataClassification: 'INTERNAL' });
    const policy = await getQuantumPolicy(orgId);
    expect(policy.allowQuantumSimulator).toBe(true);
    expect(policy.maxExternalDataClassification).toBe('INTERNAL');
  });
});
