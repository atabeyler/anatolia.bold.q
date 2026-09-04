import { normalizeTrivy } from './normalizers/trivy.js';
import { normalizeOsvScanner } from './normalizers/osvScanner.js';
import { normalizeSemgrep } from './normalizers/semgrep.js';
import { normalizeNuclei } from './normalizers/nuclei.js';
import { normalizeNaabu } from './normalizers/naabu.js';

// One normalizer per engine, each a pure function: (engine-native raw JSON)
// -> Array<{ category, ruleId, title, ... }> in BCI's common observation
// shape (spec section 16). Adding a sixth engine means adding one entry
// here and one adapter in src/engines/ -- nothing else in the pipeline
// (Correlation, Verification, Risk) changes.
const NORMALIZERS = {
  trivy: normalizeTrivy,
  'osv-scanner': normalizeOsvScanner,
  semgrep: normalizeSemgrep,
  nuclei: normalizeNuclei,
  naabu: normalizeNaabu,
};

export function normalizeRaw(engineId, rawPayload) {
  const normalizer = NORMALIZERS[engineId];
  if (!normalizer) {
    throw new Error(`No normalizer registered for engine "${engineId}"`);
  }
  return normalizer(rawPayload);
}

export function supportsEngine(engineId) {
  return Object.prototype.hasOwnProperty.call(NORMALIZERS, engineId);
}
