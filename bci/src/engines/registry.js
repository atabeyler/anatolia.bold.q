import { query } from '../db/client.js';
import { assertValidAdapter } from './EngineAdapter.js';
import { trivyAdapter } from './adapters/trivy.js';
import { osvScannerAdapter } from './adapters/osvScanner.js';
import { semgrepAdapter } from './adapters/semgrep.js';
import { nucleiAdapter } from './adapters/nuclei.js';
import { naabuAdapter } from './adapters/naabu.js';

const adapters = new Map();

function register(adapter) {
  assertValidAdapter(adapter);
  adapters.set(adapter.id, adapter);
}

[trivyAdapter, osvScannerAdapter, semgrepAdapter, nucleiAdapter, naabuAdapter].forEach(register);

export function getAdapter(id) {
  return adapters.get(id) || null;
}

export function listAdapters() {
  return [...adapters.values()];
}

// Persists both the static catalog entry (engine_registry) and the live
// health snapshot (engine_health) -- a health check never throws, and a
// binary that isn't installed shows up as OFFLINE rather than crashing
// whatever called this (spec section 48: one dead engine must not make the
// rest of the run look like it succeeded).
export async function runHealthChecks() {
  const results = [];
  for (const adapter of adapters.values()) {
    await query(
      `INSERT INTO engine_registry (id, name, intrusiveness, supported_target_types, supported_analysis_types, license, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, now())
       ON CONFLICT (id) DO UPDATE SET
         name = $2, intrusiveness = $3, supported_target_types = $4,
         supported_analysis_types = $5, license = $6, updated_at = now()`,
      [adapter.id, adapter.name, adapter.intrusiveness, adapter.supportedTargetTypes, adapter.supportedAnalysisTypes, adapter.license]
    );

    const health = await adapter.healthCheck();

    await query(
      `INSERT INTO engine_health (engine_id, status, version, detail, last_checked_at)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (engine_id) DO UPDATE SET
         status = $2, version = $3, detail = $4, last_checked_at = now()`,
      [adapter.id, health.status, health.version ?? null, health.detail ?? null]
    );

    results.push({ id: adapter.id, ...health });
  }
  return results;
}

export async function getEngineStatus() {
  const { rows } = await query(
    `SELECT r.id, r.name, r.intrusiveness, r.supported_target_types, r.supported_analysis_types, r.license,
            h.status, h.version, h.detail, h.last_checked_at
       FROM engine_registry r
       LEFT JOIN engine_health h ON h.engine_id = r.id
      ORDER BY r.id`
  );
  return rows;
}
