// Runtime guard that prevents execution of dangerous features when disabled.
const { get } = require('../services/quantumParamsService');
const { ALLOWED_FEATURES } = require('./features');

async function ensureFeatureEnabled(feature, context = {}) {
  if (!ALLOWED_FEATURES.includes(feature)) {
    throw new Error(`Unknown feature: ${feature}`);
  }
  const row = await get(feature);
  // Default: disabled unless explicitly enabled
  if (!row || !row.enabled) {
    const err = new Error(`Feature ${feature} is disabled by policy`);
    err.code = 'FEATURE_DISABLED';
    throw err;
  }
  if (row.expires_at && new Date(row.expires_at) < new Date()) {
    const err = new Error(`Feature ${feature} expired`);
    err.code = 'FEATURE_EXPIRED';
    throw err;
  }
  return true;
}

module.exports = { ensureFeatureEnabled };
