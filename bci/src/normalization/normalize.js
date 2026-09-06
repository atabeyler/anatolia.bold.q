import { normalizeTrivy } from './normalizers/trivy.js';
import { normalizeOsvScanner } from './normalizers/osvScanner.js';
import { normalizeSemgrep } from './normalizers/semgrep.js';
import { normalizeNuclei } from './normalizers/nuclei.js';
import { normalizeNaabu } from './normalizers/naabu.js';
import { normalizeHttpFuzz } from './normalizers/httpFuzz.js';

const NORMALIZERS = {
  trivy: normalizeTrivy,
  'osv-scanner': normalizeOsvScanner,
  semgrep: normalizeSemgrep,
  nuclei: normalizeNuclei,
  naabu: normalizeNaabu,
  'http-fuzz': normalizeHttpFuzz,
};

export function normalizeRaw(engineId, rawPayload) {
  const normalizer = NORMALIZERS[engineId];
  if (!normalizer) throw new Error(`No normalizer registered for engine "${engineId}"`);
  return normalizer(rawPayload);
}

export function supportsEngine(engineId) {
  return Object.prototype.hasOwnProperty.call(NORMALIZERS, engineId);
}
