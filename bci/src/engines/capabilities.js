// Canonical BCI cyber-analysis capability registry. Intrusiveness is a
// separate execution-policy dimension and must never be registered here.
const capabilities = new Map();

export function registerCapability(capability) {
  if (!capability?.id || typeof capability.id !== 'string') {
    throw new Error('Capability requires a stable string id');
  }
  const id = capability.id.trim().toUpperCase();
  const normalized = Object.freeze({
    id,
    name: capability.name || id,
    description: capability.description || '',
    category: capability.category || 'GENERAL',
    ...(capability.requiredIntrusiveness ? { requiredIntrusiveness: capability.requiredIntrusiveness } : {}),
  });
  capabilities.set(normalized.id, normalized);
  return normalized;
}

export function getCapability(id) {
  return capabilities.get(String(id || '').toUpperCase()) || null;
}

export function listCapabilities() {
  return [...capabilities.values()];
}

[
  { id: 'SAST', name: 'Static Application Security Testing', description: 'Analyzes source code for security defects.', category: 'CODE', requiredIntrusiveness: 'PASSIVE' },
  { id: 'SCA', name: 'Software Composition Analysis', description: 'Analyzes third-party components and known vulnerabilities.', category: 'SUPPLY_CHAIN', requiredIntrusiveness: 'PASSIVE' },
  { id: 'SECRETS', name: 'Secret Detection', description: 'Detects exposed credentials and secrets.', category: 'CODE', requiredIntrusiveness: 'PASSIVE' },
  { id: 'IAC', name: 'Infrastructure as Code', description: 'Analyzes infrastructure-as-code definitions.', category: 'CONFIGURATION', requiredIntrusiveness: 'PASSIVE' },
  { id: 'CONFIG', name: 'Configuration Analysis', description: 'Detects insecure configuration and misconfiguration.', category: 'CONFIGURATION', requiredIntrusiveness: 'PASSIVE' },
  { id: 'SUPPLY_CHAIN', name: 'Supply Chain Analysis', description: 'Analyzes dependency and software supply-chain exposure.', category: 'SUPPLY_CHAIN', requiredIntrusiveness: 'PASSIVE' },
  { id: 'NETWORK_DISCOVERY', name: 'Network Discovery', description: 'Discovers reachable network services.', category: 'NETWORK', requiredIntrusiveness: 'SAFE_ACTIVE' },
  { id: 'WEB', name: 'Web Security Analysis', description: 'Performs bounded web security checks.', category: 'APPLICATION', requiredIntrusiveness: 'SAFE_ACTIVE' },
  { id: 'API', name: 'API Security Analysis', description: 'Performs bounded API security checks.', category: 'APPLICATION', requiredIntrusiveness: 'SAFE_ACTIVE' },
  { id: 'FUZZ', name: 'HTTP Input Robustness', description: 'Exercises HTTP inputs with bounded malformed and boundary values.', category: 'ACTIVE_VALIDATION', requiredIntrusiveness: 'SAFE_ACTIVE' },
  { id: 'INTRUSIVE', name: 'Advanced Active Validation', description: 'Validates risky behavior without automatic exploitation.', category: 'ACTIVE_VALIDATION', requiredIntrusiveness: 'RESTRICTED' },
  { id: 'DOS', name: 'Availability / Resilience', description: 'Performs bounded availability and resilience observations; it does not generate destructive load.', category: 'RESILIENCE', requiredIntrusiveness: 'RESTRICTED' },
].forEach(registerCapability);
