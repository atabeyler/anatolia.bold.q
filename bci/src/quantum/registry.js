import { assertValidProvider } from './QuantumComputeGateway.js';
import { classicalAdapter } from './providers/classicalAdapter.js';
import { quantumInspiredAdapter } from './providers/quantumInspiredAdapter.js';
import { localSimulatorAdapter } from './providers/localSimulatorAdapter.js';
import { ibmAdapter } from './providers/ibmAdapter.js';

const providers = new Map();
[classicalAdapter, quantumInspiredAdapter, localSimulatorAdapter, ibmAdapter].forEach((p) => {
  assertValidProvider(p);
  providers.set(p.id, p);
});

export function getQuantumProvider(id) {
  return providers.get(id) || null;
}

export function listQuantumProviders() {
  return [...providers.values()];
}

export async function getAllProviderHealth() {
  const results = [];
  for (const provider of providers.values()) {
    const health = await provider.getProviderHealth();
    results.push({ id: provider.id, mode: provider.mode, ...health, capabilities: provider.getCapabilities() });
  }
  return results;
}
