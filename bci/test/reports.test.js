import { describe, it, expect, beforeEach } from 'vitest';
import { query } from '../src/db/client.js';
import { resetDatabase, createOrg, createUser, insertNormalizedObservation } from './helpers/db.js';
import { correlateJobObservations } from '../src/services/correlation.js';
import { upsertVulnerability } from '../src/services/intelligence.js';
import { generateReport, getReport, listReports } from '../src/services/reports.js';

beforeEach(resetDatabase);

async function seedOrgWithOneKevFinding() {
  const orgId = await createOrg();
  const userId = await createUser(orgId, { roleId: 'operator' });
  const jobId = (await query(`INSERT INTO scan_jobs (org_id, requested_by, target, requested_class) VALUES ($1,$2,'t1','PASSIVE') RETURNING id`, [orgId, userId])).rows[0].id;
  await upsertVulnerability({ cveId: 'CVE-2099-30001', cvssScore: 9.5, kev: true });
  await insertNormalizedObservation(orgId, jobId, { engineId: 'trivy', cveIds: ['CVE-2099-30001'], target: 't1' });
  await correlateJobObservations(orgId, jobId);
  return { orgId, userId };
}

describe('EXECUTIVE report', () => {
  it('surfaces the KEV exposure and top risk', async () => {
    const { orgId, userId } = await seedOrgWithOneKevFinding();
    const report = await generateReport(orgId, userId, 'EXECUTIVE');

    expect(report.content.kevExposureCount).toBe(1);
    expect(report.content.criticalFindingCount).toBe(1);
    expect(report.content.topRisks).toHaveLength(1);
    expect(report.bci_version).toBeDefined();
    expect(report.model_versions.risk).toBeGreaterThanOrEqual(1);
  });
});

describe('TECHNICAL report', () => {
  it('includes the finding and its engine sources', async () => {
    const { orgId, userId } = await seedOrgWithOneKevFinding();
    const report = await generateReport(orgId, userId, 'TECHNICAL');
    expect(report.content.findingCount).toBe(1);
    expect(report.content.findings[0].sources[0].engine_id).toBe('trivy');
  });
});

describe('report integrity', () => {
  it('detects tampering: a directly-edited content column fails integrity on read', async () => {
    const { orgId, userId } = await seedOrgWithOneKevFinding();
    const created = await generateReport(orgId, userId, 'EXECUTIVE');

    const untampered = await getReport(orgId, created.id);
    expect(untampered.integrityValid).toBe(true);

    await query("UPDATE reports SET content = content || '{\"criticalFindingCount\": 999}'::jsonb WHERE id = $1", [created.id]);
    const tampered = await getReport(orgId, created.id);
    expect(tampered.integrityValid).toBe(false);
  });

  it('lists reports without exposing the full content', async () => {
    const { orgId, userId } = await seedOrgWithOneKevFinding();
    await generateReport(orgId, userId, 'EXECUTIVE');
    await generateReport(orgId, userId, 'AUDIT');

    const list = await listReports(orgId);
    expect(list).toHaveLength(2);
    expect(list[0].content).toBeUndefined();
  });
});

describe('AUDIT report', () => {
  it('is itself built from the audit ledger', async () => {
    const { orgId, userId } = await seedOrgWithOneKevFinding();
    await generateReport(orgId, userId, 'EXECUTIVE'); // generates a report.generate audit event to read back
    const report = await generateReport(orgId, userId, 'AUDIT');
    expect(report.content.eventCount).toBeGreaterThan(0);
    expect(report.content.events.some((e) => e.action === 'report.generate')).toBe(true);
  });
});
