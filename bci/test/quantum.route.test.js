import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { signAccessToken } from '../src/lib/jwt.js';
import { resetDatabase, createOrg, createUser } from './helpers/db.js';

const app = createApp();

beforeEach(resetDatabase);

describe('quantum API', () => {
  it('viewer can read provider health and policy', async () => {
    const orgId = await createOrg();
    const userId = await createUser(orgId, { roleId: 'viewer' });
    const token = signAccessToken({ userId, orgId });

    const providers = await request(app).get('/api/v1/quantum/providers').set('Authorization', `Bearer ${token}`);
    expect(providers.status).toBe(200);
    expect(providers.body.providers.map((p) => p.id).sort()).toEqual(['classical', 'ibm_quantum', 'quantum_inspired', 'quantum_simulator']);

    const policy = await request(app).get('/api/v1/quantum/policy').set('Authorization', `Bearer ${token}`);
    expect(policy.status).toBe(200);
    expect(policy.body.policy.allowQuantumHardware).toBe(false);
  });

  it('viewer cannot change the quantum policy (system:manage required)', async () => {
    const orgId = await createOrg();
    const userId = await createUser(orgId, { roleId: 'viewer' });
    const token = signAccessToken({ userId, orgId });

    const res = await request(app)
      .put('/api/v1/quantum/policy')
      .set('Authorization', `Bearer ${token}`)
      .send({ allowQuantumSimulator: true, allowQuantumHardware: true, maxExternalDataClassification: 'SECRET' });
    expect(res.status).toBe(403);
  });

  it('system_admin can change the quantum policy', async () => {
    const orgId = await createOrg();
    const userId = await createUser(orgId, { roleId: 'system_admin' });
    const token = signAccessToken({ userId, orgId });

    const res = await request(app)
      .put('/api/v1/quantum/policy')
      .set('Authorization', `Bearer ${token}`)
      .send({ allowQuantumSimulator: true, allowQuantumHardware: false, maxExternalDataClassification: 'INTERNAL' });
    expect(res.status).toBe(200);

    const get = await request(app).get('/api/v1/quantum/policy').set('Authorization', `Bearer ${token}`);
    expect(get.body.policy.allowQuantumSimulator).toBe(true);
  });

  it('operator can run the remediation optimizer; viewer cannot', async () => {
    const orgId = await createOrg();
    const viewerToken = signAccessToken({ userId: await createUser(orgId, { email: 'v@x.com', roleId: 'viewer' }), orgId });
    const opToken = signAccessToken({ userId: await createUser(orgId, { email: 'o@x.com', roleId: 'operator' }), orgId });

    const denied = await request(app)
      .post('/api/v1/quantum/remediation-optimize')
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({ effortBudget: 5 });
    expect(denied.status).toBe(403);

    const allowed = await request(app)
      .post('/api/v1/quantum/remediation-optimize')
      .set('Authorization', `Bearer ${opToken}`)
      .send({ effortBudget: 5 });
    expect(allowed.status).toBe(200);
    expect(allowed.body.selectedFindingIds).toEqual([]);
  });

  it("org A cannot read org B's quantum benchmark", async () => {
    const orgA = await createOrg('A', 'org-a');
    const orgB = await createOrg('B', 'org-b');
    const bToken = signAccessToken({ userId: await createUser(orgB, { email: 'b@x.com', roleId: 'operator' }), orgId: orgB });
    const gen = await request(app).post('/api/v1/quantum/remediation-optimize').set('Authorization', `Bearer ${bToken}`).send({ effortBudget: 5 });

    const aToken = signAccessToken({ userId: await createUser(orgA, { email: 'a@x.com', roleId: 'operator' }), orgId: orgA });
    if (gen.body.benchmarkId) {
      const res = await request(app).get(`/api/v1/quantum/benchmarks/${gen.body.benchmarkId}`).set('Authorization', `Bearer ${aToken}`);
      expect(res.status).toBe(404);
    }
  });
});
