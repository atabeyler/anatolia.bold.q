import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { signAccessToken } from '../src/lib/jwt.js';
import { query } from '../src/db/client.js';
import { resetDatabase, createOrg, createUser } from './helpers/db.js';

const app = createApp();

beforeEach(async () => {
  await resetDatabase();
  for (const engineId of ['nuclei', 'http-fuzz']) {
    await query(
      `INSERT INTO engine_health (engine_id, status, last_checked_at) VALUES ($1, 'HEALTHY', now())
       ON CONFLICT (engine_id) DO UPDATE SET status = 'HEALTHY', last_checked_at = now()`,
      [engineId]
    );
  }
});

async function tokenFor(orgId, roleId, email = `${roleId}@test.local`) {
  const userId = await createUser(orgId, { email, roleId });
  return { userId, token: signAccessToken({ userId, orgId }) };
}

async function approveScope(orgId, userId, target) {
  await query(
    `INSERT INTO authorized_scopes (org_id, name, target, allowed_scan_classes, status, created_by, approved_by, approved_at)
     VALUES ($1, 'scope', $2, '{PASSIVE}', 'APPROVED', $3, $3, now())`,
    [orgId, target, userId]
  );
}

describe('POST /api/v1/scans', () => {
  it('viewer cannot create a scan', async () => {
    const orgId = await createOrg();
    const { token } = await tokenFor(orgId, 'viewer');
    const res = await request(app)
      .post('/api/v1/scans')
      .set('Authorization', `Bearer ${token}`)
      .send({ target: 'example.com', requestedClass: 'SAFE_ACTIVE' });
    expect(res.status).toBe(403);
  });

  it('operator with permission but no authorized scope can still create a scan (scope enforcement removed)', async () => {
    const orgId = await createOrg();
    const { token } = await tokenFor(orgId, 'operator');
    const res = await request(app)
      .post('/api/v1/scans')
      .set('Authorization', `Bearer ${token}`)
      .send({ target: 'example.com', requestedClass: 'SAFE_ACTIVE' });
    expect(res.status).toBe(201);
  });

  it('operator with an approved scope can create, view, and cancel a scan', async () => {
    const orgId = await createOrg();
    const { userId, token } = await tokenFor(orgId, 'operator');
    await approveScope(orgId, userId, 'example.com');

    const create = await request(app)
      .post('/api/v1/scans')
      .set('Authorization', `Bearer ${token}`)
      .send({ target: 'example.com', requestedClass: 'SAFE_ACTIVE' });
    expect(create.status).toBe(201);
    expect(create.body.job.status).toBe('QUEUED');

    const get = await request(app).get(`/api/v1/scans/${create.body.job.id}`).set('Authorization', `Bearer ${token}`);
    expect(get.status).toBe(200);

    const cancel = await request(app)
      .post(`/api/v1/scans/${create.body.job.id}/cancel`)
      .set('Authorization', `Bearer ${token}`);
    expect(cancel.status).toBe(200);
    expect(cancel.body.job.status).toBe('CANCELLED');
  });

  it('GET /:id/engine-runs returns real scan_job_engine_runs rows, never a fake progress percentage', async () => {
    const orgId = await createOrg();
    const { userId, token } = await tokenFor(orgId, 'operator');
    await approveScope(orgId, userId, 'example.com');
    const create = await request(app)
      .post('/api/v1/scans')
      .set('Authorization', `Bearer ${token}`)
      .send({ target: 'example.com', requestedClass: 'SAFE_ACTIVE' });

    await query(
      `INSERT INTO scan_job_engine_runs (job_id, engine_id, status, observation_count, finished_at)
       VALUES ($1, 'nuclei', 'COMPLETED', 3, now())`,
      [create.body.job.id]
    );

    const res = await request(app)
      .get(`/api/v1/scans/${create.body.job.id}/engine-runs`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.engineRuns).toHaveLength(1);
    expect(res.body.engineRuns[0]).toMatchObject({ engine_id: 'nuclei', status: 'COMPLETED', observation_count: 3 });
  });

  it("org A cannot view or cancel org B's scan job", async () => {
    const orgA = await createOrg('A', 'org-a');
    const orgB = await createOrg('B', 'org-b');
    const b = await tokenFor(orgB, 'operator', 'op@b.test');
    await approveScope(orgB, b.userId, 'b-internal.example');
    const created = await request(app)
      .post('/api/v1/scans')
      .set('Authorization', `Bearer ${b.token}`)
      .send({ target: 'b-internal.example', requestedClass: 'SAFE_ACTIVE' });

    const a = await tokenFor(orgA, 'operator', 'op@a.test');
    const get = await request(app).get(`/api/v1/scans/${created.body.job.id}`).set('Authorization', `Bearer ${a.token}`);
    expect(get.status).toBe(404);

    const cancel = await request(app)
      .post(`/api/v1/scans/${created.body.job.id}/cancel`)
      .set('Authorization', `Bearer ${a.token}`);
    expect(cancel.status).toBe(404);
  });
});
