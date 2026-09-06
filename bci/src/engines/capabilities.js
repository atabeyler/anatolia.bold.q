// BCI Cyber Analysis Capability Registry.
// Capabilities are first-class analysis metadata, independent from quantum
// execution preferences and from engine availability. New capabilities can
// be registered without changing planner control flow or UI contracts.
const capabilities = new Map();

export function registerCapability(capability) {
  if (!capability?.id || typeof capability.id !== 'string') {
    throw new Error('Capability requires a stable string id');
  }
  const normalized = Object.freeze({
    id: capability.id.toUpperCase(),
    name: capability.name || capability.id.toUpperCase(),
    description: capability.description || '',
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
  ['PASSIVE', 'Passive Analysis'],
  ['SAFE_ACTIVE', 'Safe Active Analysis'],
  ['AUTHENTICATED', 'Authenticated Analysis'],
  ['FUZZ', 'Fuzz Analysis'],
  ['INTRUSIVE', 'Intrusive Analysis'],
  ['DOS', 'Denial-of-Service Analysis'],
].forEach(([id, name]) => registerCapability({ id, name }));
