import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { signAccessToken } from '../src/lib/jwt.js';
import { resetDatabase, createOrg, createUser } from './helpers/db.js';

const app = createApp();

beforeEach(resetDatabase);

async function tokenFor(orgId, roleId, email = `${roleId}@test.local`) {
  const userId = await createUser(orgId, { email, roleId });
  return signAccessToken({ userId, orgId });
}

describe('asset inventory', () => {
  it('viewer cannot create an asset but can list assets', async () => {
    const orgId = await createOrg();
    const token = await tokenFor(orgId, 'viewer');

    const create = await request(app)
      .post('/api/v1/assets')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'example.com', assetType: 'DOMAIN' });
    expect(create.status).toBe(403);

    const list = await request(app).get('/api/v1/assets').set('Authorization', `Bearer ${token}`);
    expect(list.status).toBe(200);
    expect(list.body.assets).toEqual([]);
  });

  it('operator can create, fetch, and update an asset', async () => {
    const orgId = await createOrg();
    const token = await tokenFor(orgId, 'operator');

    const create = await request(app)
      .post('/api/v1/assets')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'example.com', assetType: 'DOMAIN' });
    expect(create.status).toBe(201);
    expect(create.body.asset.criticality).toBe('MEDIUM');

    const assetId = create.body.asset.id;

    const get = await request(app).get(`/api/v1/assets/${assetId}`).set('Authorization', `Bearer ${token}`);
    expect(get.status).toBe(200);
    expect(get.body.identifiers).toEqual([]);

    const update = await request(app)
      .patch(`/api/v1/assets/${assetId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ criticality: 'CRITICAL' });
    expect(update.status).toBe(200);
    expect(update.body.asset.criticality).toBe('CRITICAL');
  });

  it('rejects an invalid asset_type', async () => {
    const orgId = await createOrg();
    const token = await tokenFor(orgId, 'operator');
    const res = await request(app)
      .post('/api/v1/assets')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'x', assetType: 'NOT_A_REAL_TYPE' });
    expect(res.status).toBe(400);
  });

  it('adds identifiers and technologies to an asset', async () => {
    const orgId = await createOrg();
    const token = await tokenFor(orgId, 'operator');
    const create = await request(app)
      .post('/api/v1/assets')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'example.com', assetType: 'DOMAIN' });
    const assetId = create.body.asset.id;

    const idRes = await request(app)
      .post(`/api/v1/assets/${assetId}/identifiers`)
      .set('Authorization', `Bearer ${token}`)
      .send({ identifierType: 'DOMAIN', value: 'example.com' });
    expect(idRes.status).toBe(201);

    const techRes = await request(app)
      .post(`/api/v1/assets/${assetId}/technologies`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'nginx', version: '1.25.0' });
    expect(techRes.status).toBe(201);

    const get = await request(app).get(`/api/v1/assets/${assetId}`).set('Authorization', `Bearer ${token}`);
    expect(get.body.identifiers).toHaveLength(1);
    expect(get.body.technologies).toHaveLength(1);
  });

  it('records a HOSTS relationship between two assets in the same org', async () => {
    const orgId = await createOrg();
    const token = await tokenFor(orgId, 'operator');
    const host = await request(app)
      .post('/api/v1/assets')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'server-1', assetType: 'HOST' });
    const app1 = await request(app)
      .post('/api/v1/assets')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'web-app-1', assetType: 'WEB_APP' });

    const rel = await request(app)
      .post('/api/v1/assets/relationships')
      .set('Authorization', `Bearer ${token}`)
      .send({ sourceAssetId: host.body.asset.id, targetAssetId: app1.body.asset.id, relationshipType: 'HOSTS' });
    expect(rel.status).toBe(201);

    const get = await request(app).get(`/api/v1/assets/${app1.body.asset.id}`).set('Authorization', `Bearer ${token}`);
    expect(get.body.relationships).toHaveLength(1);
    expect(get.body.relationships[0].relationship_type).toBe('HOSTS');
  });

  describe('cross-tenant isolation', () => {
    it("org A cannot see, fetch, or update org B's asset", async () => {
      const orgA = await createOrg('A', 'org-a');
      const orgB = await createOrg('B', 'org-b');
      const bToken = await tokenFor(orgB, 'operator', 'op@b.test');
      const aToken = await tokenFor(orgA, 'operator', 'op@a.test');

      const created = await request(app)
        .post('/api/v1/assets')
        .set('Authorization', `Bearer ${bToken}`)
        .send({ name: 'b-secret-host', assetType: 'HOST' });
      const assetId = created.body.asset.id;

      const list = await request(app).get('/api/v1/assets').set('Authorization', `Bearer ${aToken}`);
      expect(list.body.assets).toEqual([]);

      const get = await request(app).get(`/api/v1/assets/${assetId}`).set('Authorization', `Bearer ${aToken}`);
      expect(get.status).toBe(404);

      const update = await request(app)
        .patch(`/api/v1/assets/${assetId}`)
        .set('Authorization', `Bearer ${aToken}`)
        .send({ criticality: 'CRITICAL' });
      expect(update.status).toBe(404);
    });

    it('cannot create a relationship spanning two different orgs', async () => {
      const orgA = await createOrg('A', 'org-a');
      const orgB = await createOrg('B', 'org-b');
      const aToken = await tokenFor(orgA, 'operator', 'op@a.test');
      const bToken = await tokenFor(orgB, 'operator', 'op@b.test');

      const aAsset = await request(app)
        .post('/api/v1/assets')
        .set('Authorization', `Bearer ${aToken}`)
        .send({ name: 'a-host', assetType: 'HOST' });
      const bAsset = await request(app)
        .post('/api/v1/assets')
        .set('Authorization', `Bearer ${bToken}`)
        .send({ name: 'b-app', assetType: 'WEB_APP' });

      const rel = await request(app)
        .post('/api/v1/assets/relationships')
        .set('Authorization', `Bearer ${aToken}`)
        .send({ sourceAssetId: aAsset.body.asset.id, targetAssetId: bAsset.body.asset.id, relationshipType: 'HOSTS' });
      expect(rel.status).toBe(404);
    });
  });
});
