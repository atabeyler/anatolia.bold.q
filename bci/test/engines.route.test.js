import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { signAccessToken } from '../src/lib/jwt.js';
import { resetDatabase, createOrg, createUser } from './helpers/db.js';
import { runHealthChecks } from '../src/engines/registry.js';
import { query } from '../src/db/client.js';
import { config } from '../src/config.js';

const app = createApp();

beforeEach(resetDatabase);

async function tokenFor(orgId, roleId) {
  const userId = await createUser(orgId, { email: `${roleId}@test.local`, roleId });
  return signAccessToken({ userId, orgId });
}

describe('GET /engines/plan -- real engine selection preview (analysis wizard step 2)', () => {

  it('returns the worker snapshot without probing inside a split API container', async () => {
    const orgId = await createOrg();
    const token = await tokenFor(orgId, 'system_admin');
    await query(
      `INSERT INTO engine_health (engine_id, status, version, detail, last_checked_at)
       VALUES ('semgrep', 'HEALTHY', 'worker-sentinel', 'checked by worker', now())
       ON CONFLICT (engine_id) DO UPDATE SET status = 'HEALTHY', version = 'worker-sentinel', detail = 'checked by worker', last_checked_at = now()`
    );
    const previousMode = config.engineHealthMode;
    config.engineHealthMode = 'WORKER';
    try {
      const res = await request(app)
        .post('/api/v1/engines/health-check')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.mode).toBe('WORKER_SNAPSHOT');
      expect(res.body.results.find((engine) => engine.id === 'semgrep').version).toBe('worker-sentinel');
    } finally {
      config.engineHealthMode = previousMode;
    }
  });
  it('shows every registered engine, with independent status/compatible/recommended -- never a hardcoded subset', async () => {
    const orgId = await createOrg();
    const token = await tokenFor(orgId, 'operator');

    const res = await request(app)
      .get('/api/v1/engines/plan')
      .query({ targetType: 'DOMAIN', requestedClass: 'PASSIVE' })
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    // All real adapters, not a hardcoded subset -- listAdapters() is the
    // source of truth, so a 6th engine registered in code would show up
    // here with zero frontend changes.
    expect(res.body.engines).toHaveLength(8);
    // UNKNOWN if no health check has ever run for that engine in this test
    // database, otherwise a real HEALTHY/DEGRADED/OFFLINE from engine_health
    // -- never assumed, never a 4th made-up value.
    expect(res.body.engines.every((e) => ['UNKNOWN', 'HEALTHY', 'DEGRADED', 'OFFLINE'].includes(e.status))).toBe(true);

    const nuclei = res.body.engines.find((e) => e.id === 'nuclei');
    expect(nuclei.targetCompatible).toBe(true); // nuclei supports DOMAIN
    expect(nuclei.compatible).toBe(false); // but SAFE_ACTIVE exceeds PASSIVE
    expect(nuclei.compatibilityStatus).toBe('INCOMPATIBLE');
    expect(nuclei.reasons).toContain('INTRUSIVENESS_EXCEEDS_REQUEST');
    // DOMAIN's only engine plan entry (nuclei) is SAFE_ACTIVE -- a PASSIVE
    // request must not recommend it (this is exactly the real bug: DOMAIN +
    // PASSIVE produces zero recommended engines).
    expect(nuclei.recommended).toBe(false);

    const semgrep = res.body.engines.find((e) => e.id === 'semgrep');
    expect(semgrep.compatible).toBe(false); // semgrep is REPOSITORY-only

    // Zero engines are both recommended AND healthy for DOMAIN+PASSIVE --
    // this is the real, pre-flight signal a scan for this combination
    // cannot actually run anything.
    expect(res.body.hasExecutableEngine).toBe(false);
  });

  it('recommends nuclei for DOMAIN once the requested class is at least SAFE_ACTIVE, and reports it executable once healthy', async () => {
    const orgId = await createOrg();
    const token = await tokenFor(orgId, 'operator');
    await runHealthChecks();

    const res = await request(app)
      .get('/api/v1/engines/plan')
      .query({ targetType: 'DOMAIN', requestedClass: 'SAFE_ACTIVE' })
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    const nuclei = res.body.engines.find((e) => e.id === 'nuclei');
    expect(nuclei.recommended).toBe(true);
    // Real health from runHealthChecks() -- HEALTHY only if the nuclei
    // binary is actually installed in this environment, never assumed.
    if (nuclei.status === 'HEALTHY') {
      expect(res.body.hasExecutableEngine).toBe(true);
    }
  }, 60_000);

  it('rejects an unrecognized requestedClass rather than silently planning for a guessed default', async () => {
    const orgId = await createOrg();
    const token = await tokenFor(orgId, 'operator');
    const res = await request(app)
      .get('/api/v1/engines/plan')
      .query({ targetType: 'DOMAIN', requestedClass: 'NOT_A_REAL_CLASS' })
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(400);
  });

  it('publishes canonical capability metadata and rejects unknown selections', async () => {
    const orgId = await createOrg();
    const token = await tokenFor(orgId, 'operator');
    const catalog = await request(app).get('/api/v1/engines/capabilities').set('Authorization', `Bearer ${token}`);
    expect(catalog.status).toBe(200);
    expect(catalog.body.capabilities.find((capability) => capability.id === 'FUZZ')).toMatchObject({ category: 'ACTIVE_VALIDATION', requiredIntrusiveness: 'SAFE_ACTIVE' });
    expect(catalog.body.capabilities.some((capability) => capability.id === 'PASSIVE')).toBe(false);

    const invalid = await request(app).get('/api/v1/engines/plan')
      .query({ targetType: 'DOMAIN', requestedClass: 'RESTRICTED', capabilities: 'NOT_REAL' })
      .set('Authorization', `Bearer ${token}`);
    expect(invalid.status).toBe(400);
    expect(invalid.body.error).toBe('unknown_capability');
  });
});
