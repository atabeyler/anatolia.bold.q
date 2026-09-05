import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { signAccessToken } from '../src/lib/jwt.js';
import { query } from '../src/db/client.js';
import { resetDatabase, createOrg, createUser } from './helpers/db.js';

const app = createApp();

beforeEach(resetDatabase);

async function approveScope(orgId, userId, target, targetType, classes = ['PASSIVE', 'SAFE_ACTIVE']) {
  await query(
    `INSERT INTO authorized_scopes (org_id, name, target, target_type, allowed_scan_classes, status, created_by, approved_by, approved_at)
     VALUES ($1,'scope',$2,$3,$4,'APPROVED',$5,$5,now())`,
    [orgId, target, targetType, classes, userId]
  );
}

describe('crypto API', () => {
  it('viewer can read inventory/cbom/readiness but not trigger discovery', async () => {
    const orgId = await createOrg();
    const userId = await createUser(orgId, { roleId: 'viewer' });
    const token = signAccessToken({ userId, orgId });

    const inventory = await request(app).get('/api/v1/crypto/inventory').set('Authorization', `Bearer ${token}`);
    expect(inventory.status).toBe(200);
    expect(inventory.body.findings).toEqual([]);

    const cbom = await request(app).get('/api/v1/crypto/cbom').set('Authorization', `Bearer ${token}`);
    expect(cbom.status).toBe(200);

    const readiness = await request(app).get('/api/v1/crypto/readiness').set('Authorization', `Bearer ${token}`);
    expect(readiness.status).toBe(200);
    expect(readiness.body.readinessScore).toBeNull();

    const discover = await request(app).post('/api/v1/crypto/discover').set('Authorization', `Bearer ${token}`).send({ target: '127.0.0.1' });
    expect(discover.status).toBe(403);
  });

  it('operator triggering discovery without an approved scope gets scope_denied, never a bypass', async () => {
    const orgId = await createOrg();
    const userId = await createUser(orgId, { roleId: 'operator' });
    const token = signAccessToken({ userId, orgId });

    const res = await request(app).post('/api/v1/crypto/discover').set('Authorization', `Bearer ${token}`).send({ target: '127.0.0.1', port: 1 });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('scope_denied');
  });

  it('discovers a JWT signing algorithm with no scope needed (no network connection made)', async () => {
    const orgId = await createOrg();
    const userId = await createUser(orgId, { roleId: 'operator' });
    const token = signAccessToken({ userId, orgId });
    const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
    const jwt = `${b64({ alg: 'RS256' })}.${b64({ sub: 'x' })}.sig`;

    const res = await request(app).post('/api/v1/crypto/discover/jwt').set('Authorization', `Bearer ${token}`).send({ token: jwt });
    expect(res.status).toBe(201);
    expect(res.body.finding.algorithm_id).toBe('RSA');
  });

  it('rejects a malformed JWT with 400, not a 500', async () => {
    const orgId = await createOrg();
    const userId = await createUser(orgId, { roleId: 'operator' });
    const token = signAccessToken({ userId, orgId });

    const res = await request(app).post('/api/v1/crypto/discover/jwt').set('Authorization', `Bearer ${token}`).send({ token: 'garbage' });
    expect(res.status).toBe(400);
  });

  it("org A cannot read org B's crypto inventory", async () => {
    const orgA = await createOrg('A', 'org-a');
    const orgB = await createOrg('B', 'org-b');
    const userB = await createUser(orgB, { email: 'b@x.com', roleId: 'operator' });
    await approveScope(orgB, userB, '127.0.0.1', 'IP');

    const tokenA = signAccessToken({ userId: await createUser(orgA, { email: 'a@x.com', roleId: 'viewer' }), orgId: orgA });
    const res = await request(app).get('/api/v1/crypto/inventory').set('Authorization', `Bearer ${tokenA}`);
    expect(res.status).toBe(200);
    expect(res.body.findings).toEqual([]);
  });
});
