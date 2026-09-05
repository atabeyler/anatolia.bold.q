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
// Official fallback chain (spec section 6):
//   IBM QUANTUM HARDWARE -> LOCAL QUANTUM SIMULATOR -> QUANTUM-INSPIRED -> CLASSICAL
// Quantum-inspired has no external dependency and no policy gate of its own
// (it never leaves the machine, same as classical) -- it is the last rung
// before classical, not a step that can itself be "denied". Every fallback
// carries the real reason the step above it wasn't used, so a resolved
// mode is never mislabeled as CLASSICAL when quantum-inspired was actually
// what ran.
export function decideExecutionMode({ problemSize, policy, dataClassification, providerHealthById, simulatorMaxSize, hardwareMaxSize, quantumInspiredMaxSize }) {
  if (!policy.allowQuantumSimulator && !policy.allowQuantumHardware) {
    return { mode: COMPUTE_MODES.CLASSICAL, reason: 'org_policy_denies_quantum' };
  }

  const ctx = { policy, problemSize, providerHealthById, simulatorMaxSize, quantumInspiredMaxSize };

  // Real IBM hardware is tried first (when allowed) since it's the only
  // mode that actually runs on a physical QPU -- but a block at any one of
  // these checks falls through the chain, never straight to an error: a
  // data-classification denial or a down provider is a reason to fall back
  // a step, never a reason to refuse the analysis outright (spec section 62).
  if (policy.allowQuantumHardware) {
    if (!classificationAllowed(dataClassification, policy.maxExternalDataClassification)) {
      return fallBackFromHardware(ctx, 'data_classification_denies_external_quantum');
    }

    const health = providerHealthById.ibm_quantum;
    const hardwareHealthy = health && (health.status === PROVIDER_HEALTH.AVAILABLE || health.status === PROVIDER_HEALTH.DEGRADED);
    if (!hardwareHealthy) {
      return fallBackFromHardware(ctx, `ibm_provider_${health?.status?.toLowerCase() || 'unavailable'}`);
    }

    if (hardwareMaxSize != null && problemSize > hardwareMaxSize) {
      return fallBackFromHardware(ctx, 'problem_too_large_for_hardware');
    }

    return { mode: COMPUTE_MODES.QUANTUM_HARDWARE, reason: 'policy_allows_and_provider_available' };
  }

  return fallBackFromHardware(ctx, 'hardware_not_allowed_by_policy');
}

// `hardwareReason` is why hardware itself wasn't used -- preserved as the
// decision's reason if the simulator is what actually runs (an org reading
// "why did this land on the simulator" wants to know about hardware, not
// about the simulator that succeeded). If the simulator ALSO can't run,
// though, hardwareReason stops being the interesting fact -- the simulator
// failure becomes the new, more proximate reason carried further down.
function fallBackFromHardware(ctx, hardwareReason) {
  const { policy, problemSize, providerHealthById, simulatorMaxSize } = ctx;
  if (policy.allowQuantumSimulator) {
    const health = providerHealthById.quantum_simulator;
    const healthy = health && health.status === PROVIDER_HEALTH.AVAILABLE;
    const sizeOk = simulatorMaxSize == null || problemSize <= simulatorMaxSize;
    if (healthy && sizeOk) {
      return { mode: COMPUTE_MODES.QUANTUM_SIMULATOR, reason: hardwareReason };
    }
    const simulatorReason = !healthy ? `simulator_${health?.status?.toLowerCase() || 'unavailable'}` : 'problem_too_large_for_simulator';
    return fallBackFromSimulator(ctx, simulatorReason);
  }
  return fallBackFromSimulator(ctx, hardwareReason);
}

function fallBackFromSimulator(ctx, reasonIfQuantumInspiredUsed) {
  const { problemSize, providerHealthById, quantumInspiredMaxSize } = ctx;
  const health = providerHealthById.quantum_inspired;
  const healthy = health && health.status === PROVIDER_HEALTH.AVAILABLE;
  const sizeOk = quantumInspiredMaxSize == null || problemSize <= quantumInspiredMaxSize;
  if (healthy && sizeOk) {
    return { mode: COMPUTE_MODES.QUANTUM_INSPIRED, reason: reasonIfQuantumInspiredUsed };
  }
  const classicalReason = !healthy ? `quantum_inspired_${health?.status?.toLowerCase() || 'unavailable'}` : 'problem_too_large_for_quantum_inspired';
  return { mode: COMPUTE_MODES.CLASSICAL, reason: classicalReason };
}

export async function resolveExecutionMode({ orgId, problemSize, dataClassification = 'INTERNAL' }) {
  const policy = await getQuantumPolicy(orgId);
  const providerHealthById = {};
  for (const id of ['quantum_simulator', 'ibm_quantum', 'quantum_inspired']) {
    providerHealthById[id] = await getQuantumProvider(id).getProviderHealth();
  }
  const simulatorMaxSize = getQuantumProvider('quantum_simulator').getCapabilities().maxProblemSize;
  const hardwareMaxSize = getQuantumProvider('ibm_quantum').getCapabilities().maxProblemSize;
  const quantumInspiredMaxSize = getQuantumProvider('quantum_inspired').getCapabilities().maxProblemSize;

  return decideExecutionMode({ problemSize, policy, dataClassification, providerHealthById, simulatorMaxSize, hardwareMaxSize, quantumInspiredMaxSize });
}
