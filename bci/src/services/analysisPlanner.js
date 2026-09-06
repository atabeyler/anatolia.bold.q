import { getAdapter } from '../engines/registry.js';
import { getCapability, listCapabilities } from '../engines/capabilities.js';

const INTRUSIVENESS_ORDER = ['PASSIVE', 'SAFE_ACTIVE', 'AUTHENTICATED', 'RESTRICTED'];
function allowedUpTo(requestedClass) {
  const idx = INTRUSIVENESS_ORDER.indexOf(requestedClass);
  return new Set(INTRUSIVENESS_ORDER.slice(0, idx + 1));
}
const WEB_ANALYSIS = [
  { engineId: 'nuclei', intrusiveness: 'SAFE_ACTIVE', mode: 'url' },
  { engineId: 'http-fuzz', intrusiveness: 'SAFE_ACTIVE', mode: 'url' },
  { engineId: 'intrusive-validation', intrusiveness: 'RESTRICTED', mode: 'url' },
  { engineId: 'availability-probe', intrusiveness: 'RESTRICTED', mode: 'url' },
];
const ENGINE_PLAN_BY_TARGET_TYPE = {
  REPOSITORY: [
    { engineId: 'semgrep', intrusiveness: 'PASSIVE', mode: 'fs' },
    { engineId: 'osv-scanner', intrusiveness: 'PASSIVE', mode: 'fs' },
    { engineId: 'trivy', intrusiveness: 'PASSIVE', mode: 'fs' },
  ],
  CONTAINER: [{ engineId: 'trivy', intrusiveness: 'PASSIVE', mode: 'image' }],
  DOMAIN: WEB_ANALYSIS, SUBDOMAIN: WEB_ANALYSIS, URL: WEB_ANALYSIS, API: WEB_ANALYSIS,
  IP: [{ engineId: 'naabu', intrusiveness: 'SAFE_ACTIVE', mode: 'host' }],
  CIDR: [{ engineId: 'naabu', intrusiveness: 'SAFE_ACTIVE', mode: 'host' }],
  CLOUD_ACCOUNT: [], KUBERNETES_CLUSTER: [],
};
export function planEngines(targetType, requestedClass, requestedCapability = null) {
  const candidates = ENGINE_PLAN_BY_TARGET_TYPE[targetType] || [];
  const allowed = allowedUpTo(requestedClass);
  let planned = candidates.filter((c) => allowed.has(c.intrusiveness));
  if (requestedCapability) {
    const capability = String(requestedCapability).toUpperCase();
    if (!getCapability(capability)) return [];
    planned = planned.filter((c) => getAdapter(c.engineId)?.capabilities?.includes(capability));
  }
  return planned;
}
export function candidateEnginesForTargetType(targetType) { return ENGINE_PLAN_BY_TARGET_TYPE[targetType] || []; }
export function availableCapabilitiesForTargetType(targetType) {
  const ids = new Set();
  for (const candidate of candidateEnginesForTargetType(targetType)) for (const capability of getAdapter(candidate.engineId)?.capabilities || []) ids.add(capability);
  return listCapabilities().map((capability) => ({ ...capability, supported: ids.has(capability.id) }));
}
