// The contract every engine adapter implements. Not an enforced base class
// (duck typing keeps adapters simple). Engines advertise capabilities as
// metadata so BCI can discover future analysis capabilities dynamically.
import { getCapability } from './capabilities.js';

export const INTRUSIVENESS_LEVELS = ['PASSIVE', 'SAFE_ACTIVE', 'AUTHENTICATED', 'RESTRICTED'];

export function assertValidAdapter(adapter) {
  const required = ['id', 'name', 'license', 'intrusiveness', 'supportedTargetTypes', 'supportedAnalysisTypes', 'capabilities', 'healthCheck', 'execute'];
  const missing = required.filter((key) => adapter[key] === undefined);
  if (missing.length > 0) {
    throw new Error(`Invalid engine adapter "${adapter.id ?? '?'}": missing ${missing.join(', ')}`);
  }
  if (!INTRUSIVENESS_LEVELS.includes(adapter.intrusiveness)) {
    throw new Error(`Invalid engine adapter "${adapter.id}": bad intrusiveness "${adapter.intrusiveness}"`);
  }
  if (!Array.isArray(adapter.capabilities)) {
    throw new Error(`Invalid engine adapter "${adapter.id}": capabilities must be an array`);
  }
  const unknown = adapter.capabilities.filter((id) => !getCapability(id));
  if (unknown.length > 0) {
    throw new Error(`Invalid engine adapter "${adapter.id}": unknown capabilities ${unknown.join(', ')}`);
  }
}
