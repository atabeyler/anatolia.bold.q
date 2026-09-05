import { describe, it, expect, beforeEach } from 'vitest';
import { query } from '../src/db/client.js';
import { resetDatabase, createOrg, createUser, insertNormalizedObservation } from './helpers/db.js';
import { correlateJobObservations } from '../src/services/correlation.js';
import { upsertVulnerability } from '../src/services/intelligence.js';
import { optimizeRemediation, buildRemediationProblem } from '../src/services/remediationOptimizer.js';

beforeEach(resetDatabase);

async function seedFinding(orgId, userId, cveId, cvssScore, category = 'SCA', target = `t-${cveId}`) {
  const jobId = (await query(`INSERT INTO scan_jobs (org_id, requested_by, target, requested_class) VALUES ($1,$2,$3,'PASSIVE') RETURNING id`, [orgId, userId, target])).rows[0].id;
  await upsertVulnerability({ cveId, cvssScore });
  await insertNormalizedObservation(orgId, jobId, { engineId: 'trivy', category, cveIds: [cveId], target });
  return correlateJobObservations(orgId, jobId);
}

describe('buildRemediationProblem (integration)', () => {
  it('turns open, risk-scored findings into knapsack items with category-based effort costs', async () => {
    const orgId = await createOrg();
    const userId = await createUser(orgId, { roleId: 'operator' });
    await seedFinding(orgId, userId, 'CVE-2099-70001', 9.0, 'SCA');
    await seedFinding(orgId, userId, 'CVE-2099-70002', 3.0, 'WEB');

    const items = await buildRemediationProblem(orgId);
    expect(items).toHaveLength(2);
    expect(items.every((i) => i.cost >= 1)).toBe(true);
    expect(items.every((i) => i.value > 0)).toBe(true);
  });

  it('excludes closed findings (they need no remediation)', async () => {
    const orgId = await createOrg();
    const userId = await createUser(orgId, { roleId: 'operator' });
    const [findingId] = await seedFinding(orgId, userId, 'CVE-2099-70003', 9.0);
    await query("UPDATE findings SET status = 'VERIFIED_FIXED' WHERE id = $1", [findingId]);

    expect(await buildRemediationProblem(orgId)).toEqual([]);
  });
});

describe('optimizeRemediation (integration, real benchmark)', () => {
  it('proposes a feasible selection under the effort budget with an expected risk reduction', async () => {
    const orgId = await createOrg();
    const userId = await createUser(orgId, { roleId: 'operator' });
    await seedFinding(orgId, userId, 'CVE-2099-70010', 9.5, 'SCA');
    await seedFinding(orgId, userId, 'CVE-2099-70011', 8.0, 'WEB');
    await seedFinding(orgId, userId, 'CVE-2099-70012', 2.0, 'SCA');

    const result = await optimizeRemediation({ orgId, actorUserId: userId, effortBudget: 2 });

    expect(result.benchmarkId).toBeDefined();
    expect(result.optimizationObjective).toBeGreaterThan(0);
    expect(result.selection.length).toBeGreaterThan(0);
    expect(['QUANTUM_BENEFIT_OBSERVED_FOR_THIS_WORKLOAD', 'NO_QUANTUM_ADVANTAGE_DEMONSTRATED']).toContain(result.verdict);
  });

  it('reports honestly when there is nothing to optimize', async () => {
    const orgId = await createOrg();
    const userId = await createUser(orgId, { roleId: 'operator' });
    const result = await optimizeRemediation({ orgId, actorUserId: userId, effortBudget: 5 });
    expect(result.selectedFindingIds).toEqual([]);
    expect(result.note).toMatch(/no open findings/);
  });
});
