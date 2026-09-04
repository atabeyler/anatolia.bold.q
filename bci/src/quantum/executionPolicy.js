import { query } from '../db/client.js';
import { getQuantumProvider } from './registry.js';
import { COMPUTE_MODES, PROVIDER_HEALTH } from './QuantumComputeGateway.js';

const CLASSIFICATION_LEVELS = ['PUBLIC', 'INTERNAL', 'CONFIDENTIAL', 'SECRET'];

// spec section 17's example table, as the fail-safe default for an org
// that has never set a quantum policy: PUBLIC may leave, everything more
// sensitive stays local by default until an admin opts in explicitly.
const DEFAULT_POLICY = {
  allowQuantumSimulator: false,
  allowQuantumHardware: false,
  maxExternalDataClassification: 'PUBLIC',
};

export async function getQuantumPolicy(orgId) {
  const { rows } = await query('SELECT * FROM quantum_policies WHERE org_id = $1', [orgId]);
  if (rows.length === 0) return DEFAULT_POLICY;
  return {
    allowQuantumSimulator: rows[0].allow_quantum_simulator,
    allowQuantumHardware: rows[0].allow_quantum_hardware,
    maxExternalDataClassification: rows[0].max_external_data_classification,
  };
}

export async function setQuantumPolicy(orgId, policy) {
  await query(
    `INSERT INTO quantum_policies (org_id, allow_quantum_simulator, allow_quantum_hardware, max_external_data_classification, updated_at)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (org_id) DO UPDATE SET
       allow_quantum_simulator = $2, allow_quantum_hardware = $3, max_external_data_classification = $4, updated_at = now()`,
    [orgId, policy.allowQuantumSimulator, policy.allowQuantumHardware, policy.maxExternalDataClassification]
  );
}

function classificationAllowed(dataClassification, maxAllowed) {
  const dataIdx = CLASSIFICATION_LEVELS.indexOf(dataClassification);
  const maxIdx = CLASSIFICATION_LEVELS.indexOf(maxAllowed);
  if (dataIdx === -1 || maxIdx === -1) return false; // unrecognized classification -> fail closed
  return dataIdx <= maxIdx;
}

// BCI Quantum Execution Policy (spec section 7). Pure decision function
// (given the policy + provider health snapshot already resolved) so it's
// directly unit-testable without a database or a running provider.
// Answers ONE question: which single mode should actually be used for
// this workload -- never "quantum because it's available", only "quantum
// because policy explicitly allows it, the data is allowed to leave (for
// hardware), and the provider is actually usable."
export function decideExecutionMode({ problemSize, policy, dataClassification, providerHealthById, simulatorMaxSize, hardwareMaxSize }) {
  if (!policy.allowQuantumSimulator && !policy.allowQuantumHardware) {
    return { mode: COMPUTE_MODES.CLASSICAL, reason: 'org_policy_denies_quantum' };
  }

  // Real IBM hardware is tried first (when allowed) since it's the only
  // mode that actually runs on a physical QPU -- but a block at any one of
  // these checks falls through to try the local simulator, never straight
  // to an error: a data-classification denial or a down provider is a
  // reason to stay local, never a reason to refuse the analysis outright
  // (spec section 62).
  if (policy.allowQuantumHardware) {
    if (!classificationAllowed(dataClassification, policy.maxExternalDataClassification)) {
      return fallBackToLocal(policy, problemSize, simulatorMaxSize, providerHealthById, 'data_classification_denies_external_quantum');
    }

    const health = providerHealthById.ibm_quantum;
    const hardwareHealthy = health && (health.status === PROVIDER_HEALTH.AVAILABLE || health.status === PROVIDER_HEALTH.DEGRADED);
    if (!hardwareHealthy) {
      return fallBackToLocal(policy, problemSize, simulatorMaxSize, providerHealthById, `ibm_provider_${health?.status?.toLowerCase() || 'unavailable'}`);
    }

    if (hardwareMaxSize != null && problemSize > hardwareMaxSize) {
      return fallBackToLocal(policy, problemSize, simulatorMaxSize, providerHealthById, 'problem_too_large_for_hardware');
    }

    return { mode: COMPUTE_MODES.QUANTUM_HARDWARE, reason: 'policy_allows_and_provider_available' };
  }

  return fallBackToLocal(policy, problemSize, simulatorMaxSize, providerHealthById, 'hardware_not_allowed_by_policy');
}

function fallBackToLocal(policy, problemSize, simulatorMaxSize, providerHealthById, fallbackReason) {
  if (policy.allowQuantumSimulator) {
    const health = providerHealthById.quantum_simulator;
    const healthy = health && health.status === PROVIDER_HEALTH.AVAILABLE;
    const sizeOk = simulatorMaxSize == null || problemSize <= simulatorMaxSize;
    if (healthy && sizeOk) {
      return { mode: COMPUTE_MODES.QUANTUM_SIMULATOR, reason: fallbackReason };
    }
  }
  return { mode: COMPUTE_MODES.CLASSICAL, reason: fallbackReason };
}

export async function resolveExecutionMode({ orgId, problemSize, dataClassification = 'INTERNAL' }) {
  const policy = await getQuantumPolicy(orgId);
  const providerHealthById = {};
  for (const id of ['quantum_simulator', 'ibm_quantum']) {
    providerHealthById[id] = await getQuantumProvider(id).getProviderHealth();
  }
  const simulatorMaxSize = getQuantumProvider('quantum_simulator').getCapabilities().maxProblemSize;
  const hardwareMaxSize = getQuantumProvider('ibm_quantum').getCapabilities().maxProblemSize;

  return decideExecutionMode({ problemSize, policy, dataClassification, providerHealthById, simulatorMaxSize, hardwareMaxSize });
}
