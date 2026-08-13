import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';

// sync.js talks to Postgres through getPool() (raw pg Pool/Client, not the
// Drizzle layer) so it can hold row locks inside its own short
// transactions. This fake implements just enough of the pg Pool/Client
// surface -- connect/query/release, BEGIN/COMMIT/ROLLBACK -- backed by an
// in-memory store, to exercise the actual route logic (idempotent replay,
// optimistic-concurrency conflict detection, per-user isolation) without a
// real database.
function createFakePool() {
  const state = {
    devices: new Map(), // device_id -> { deviceId, userCode, revokedAt }
    analyses: [], // rows
    syncOperations: new Map(), // operation_id -> row
    nextId: 1,
    nextRevision: 1,
  };

  function findAnalysis(clientId, userCode) {
    return state.analyses.find((r) => r.client_id === clientId && r.user_code === userCode) || null;
  }

  function toRow(r) {
    return { ...r };
  }

  const fakeClient = {
    async query(sql, params = []) {
      const s = sql.replace(/\s+/g, ' ').trim();

      if (s === 'BEGIN' || s === 'COMMIT' || s === 'ROLLBACK') return { rows: [] };

      if (s.includes('SELECT 1 FROM devices WHERE device_id')) {
        const [deviceId, userCode] = params;
        const d = state.devices.get(deviceId);
        return { rows: d && d.userCode === userCode && !d.revokedAt ? [{ '?column?': 1 }] : [] };
      }

      if (s.includes('UPDATE devices SET last_seen_at')) {
        const [deviceId] = params;
        const d = state.devices.get(deviceId);
        if (d) d.lastSeenAt = new Date();
        return { rows: [] };
      }

      if (s.includes('SELECT device_id, revoked_at, last_seen_at FROM devices')) {
        const [deviceId, userCode] = params;
        const d = state.devices.get(deviceId);
        if (!d || d.userCode !== userCode) return { rows: [] };
        return { rows: [{ device_id: d.deviceId, revoked_at: d.revokedAt || null, last_seen_at: d.lastSeenAt || null }] };
      }

      if (s.includes('SELECT status, server_version, server_payload FROM sync_operations')) {
        const [operationId] = params;
        const op = state.syncOperations.get(operationId);
        return { rows: op ? [toRow(op)] : [] };
      }

      if (s.includes('FROM analyses WHERE client_id = $1 AND user_code = $2 FOR UPDATE')) {
        const [clientId, userCode] = params;
        const row = findAnalysis(clientId, userCode);
        return { rows: row ? [toRow(row)] : [] };
      }

      if (s.startsWith('INSERT INTO analyses')) {
        const [userCode, category, title, content, aiProvider, clientId, deviceId] = params;
        const row = {
          id: state.nextId++,
          user_code: userCode,
          category,
          title,
          content,
          ai_provider: aiProvider,
          fraud_transaction_count: null,
          fraud_flagged_count: null,
          created_at: new Date(),
          client_id: clientId,
          device_id: deviceId,
          version: 1,
          updated_at: new Date(),
          deleted_at: null,
          sync_revision: state.nextRevision++,
        };
        state.analyses.push(row);
        return { rows: [toRow(row)] };
      }

      if (s.startsWith('UPDATE analyses SET title')) {
        const [clientId, deviceId, title, content] = params;
        const row = state.analyses.find((r) => r.client_id === clientId);
        row.title = title ?? row.title;
        row.content = content ?? row.content;
        row.device_id = deviceId;
        row.version += 1;
        row.updated_at = new Date();
        row.sync_revision = state.nextRevision++;
        return { rows: [toRow(row)] };
      }

      if (s.startsWith('UPDATE analyses SET deleted_at')) {
        const [clientId, deviceId] = params;
        const row = state.analyses.find((r) => r.client_id === clientId);
        row.deleted_at = new Date();
        row.device_id = deviceId;
        row.version += 1;
        row.updated_at = new Date();
        row.sync_revision = state.nextRevision++;
        return { rows: [toRow(row)] };
      }

      if (s.startsWith('INSERT INTO sync_operations')) {
        const [operationId, userCode, deviceId, entityType, entityClientId, op, status, serverVersion, serverPayload, error] = params;
        state.syncOperations.set(operationId, {
          operation_id: operationId, user_code: userCode, device_id: deviceId, entity_type: entityType,
          entity_client_id: entityClientId, op, status, server_version: serverVersion,
          server_payload: serverPayload ? JSON.parse(serverPayload) : null, error,
        });
        return { rows: [] };
      }

      if (s.includes('FROM analyses WHERE user_code = $1 AND sync_revision > $2')) {
        const [userCode, since, limit] = params;
        const rows = state.analyses
          .filter((r) => r.user_code === userCode && r.sync_revision > since)
          .sort((a, b) => a.sync_revision - b.sync_revision)
          .slice(0, limit);
        return { rows: rows.map(toRow) };
      }

      if (s.includes('COALESCE(MAX(sync_revision), 0) AS latest')) {
        const [userCode] = params;
        const rows = state.analyses.filter((r) => r.user_code === userCode);
        const latest = rows.length ? Math.max(...rows.map((r) => r.sync_revision)) : 0;
        return { rows: [{ latest }] };
      }

      throw new Error(`fake pool: unhandled query: ${s}`);
    },
    release() {},
  };

  return {
    _state: state,
    _registerDevice(deviceId, userCode) {
      state.devices.set(deviceId, { deviceId, userCode, revokedAt: null });
    },
    async connect() {
      return fakeClient;
    },
    async query(sql, params) {
      return fakeClient.query(sql, params);
    },
  };
}

let fakePool;
vi.mock('../services/database.js', () => ({ getPool: () => fakePool }));

const { default: syncRouter } = await import('./sync.js');
const { JWT_SECRET } = await import('../lib/jwtSecret.js');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/sync', syncRouter);
  return app;
}

function token(userCode) {
  return jwt.sign({ userCode }, JWT_SECRET, { expiresIn: '1h' });
}

beforeEach(() => {
  fakePool = createFakePool();
  fakePool._registerDevice('AQ-WIN-AAAAAAAA', 'BOLD-001');
  fakePool._registerDevice('AQ-WIN-BBBBBBBB', 'BOLD-001');
  fakePool._registerDevice('AQ-WIN-CCCCCCCC', 'BOLD-002');
});

describe('POST /api/sync/push', () => {
  it('rejects an unauthorized device', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/api/sync/push')
      .set('Authorization', `Bearer ${token('BOLD-001')}`)
      .send({ deviceId: 'AQ-WIN-UNKNOWN', operations: [] });
    expect(res.status).toBe(403);
  });

  it('creates a new record and returns it applied with version 1', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/api/sync/push')
      .set('Authorization', `Bearer ${token('BOLD-001')}`)
      .send({
        deviceId: 'AQ-WIN-AAAAAAAA',
        operations: [{
          operationId: 'op-1', entityType: 'analysis', op: 'create', entityId: 'rec-1',
          payload: { category: 'bddk', title: 'Test raporu', content: 'içerik' },
        }],
      });
    expect(res.status).toBe(200);
    expect(res.body.results[0]).toMatchObject({ status: 'applied', serverVersion: 1, entityId: 'rec-1' });
  });

  it('replays an operationId idempotently instead of double-applying', async () => {
    const app = buildApp();
    const op = {
      operationId: 'op-dup', entityType: 'analysis', op: 'create', entityId: 'rec-dup',
      payload: { category: 'bddk', title: 'x', content: 'y' },
    };
    await request(app).post('/api/sync/push').set('Authorization', `Bearer ${token('BOLD-001')}`)
      .send({ deviceId: 'AQ-WIN-AAAAAAAA', operations: [op] });
    const res = await request(app).post('/api/sync/push').set('Authorization', `Bearer ${token('BOLD-001')}`)
      .send({ deviceId: 'AQ-WIN-AAAAAAAA', operations: [op] });

    expect(res.body.results[0].status).toBe('applied');
    expect(res.body.results[0].replayed).toBe(true);
    expect(fakePool._state.analyses.length).toBe(1); // not duplicated
  });

  it('detects a conflict when baseVersion is stale (two devices editing the same record)', async () => {
    const app = buildApp();
    await request(app).post('/api/sync/push').set('Authorization', `Bearer ${token('BOLD-001')}`)
      .send({
        deviceId: 'AQ-WIN-AAAAAAAA',
        operations: [{ operationId: 'c1', entityType: 'analysis', op: 'create', entityId: 'rec-conflict', payload: { category: 'bddk', title: 't', content: 'c' } }],
      });

    // Device A updates first, bumping version to 2.
    await request(app).post('/api/sync/push').set('Authorization', `Bearer ${token('BOLD-001')}`)
      .send({
        deviceId: 'AQ-WIN-AAAAAAAA',
        operations: [{ operationId: 'u1', entityType: 'analysis', op: 'update', entityId: 'rec-conflict', baseVersion: 1, payload: { title: 'A değişti' } }],
      });

    // Device B still thinks version is 1 -- must be reported as a conflict, not silently overwritten.
    const res = await request(app).post('/api/sync/push').set('Authorization', `Bearer ${token('BOLD-001')}`)
      .send({
        deviceId: 'AQ-WIN-BBBBBBBB',
        operations: [{ operationId: 'u2', entityType: 'analysis', op: 'update', entityId: 'rec-conflict', baseVersion: 1, payload: { title: 'B değişti' } }],
      });

    expect(res.body.results[0].status).toBe('conflict');
    expect(res.body.results[0].serverVersion).toBe(2);
    const stored = fakePool._state.analyses.find((r) => r.client_id === 'rec-conflict');
    expect(stored.title).toBe('A değişti'); // B's write was not applied over A's
  });

  it('never lets one user push against another user\'s record', async () => {
    const app = buildApp();
    await request(app).post('/api/sync/push').set('Authorization', `Bearer ${token('BOLD-001')}`)
      .send({
        deviceId: 'AQ-WIN-AAAAAAAA',
        operations: [{ operationId: 'c1', entityType: 'analysis', op: 'create', entityId: 'rec-isolated', payload: { category: 'bddk', title: 't', content: 'c' } }],
      });

    const res = await request(app).post('/api/sync/push').set('Authorization', `Bearer ${token('BOLD-002')}`)
      .send({
        deviceId: 'AQ-WIN-CCCCCCCC',
        operations: [{ operationId: 'u1', entityType: 'analysis', op: 'update', entityId: 'rec-isolated', baseVersion: 1, payload: { title: 'ele geçirilmiş' } }],
      });

    expect(res.body.results[0].status).toBe('error');
    expect(res.body.results[0].error).toBe('not_found');
  });
});

describe('GET /api/sync/pull', () => {
  it('only returns the authenticated user\'s own records', async () => {
    const app = buildApp();
    await request(app).post('/api/sync/push').set('Authorization', `Bearer ${token('BOLD-001')}`)
      .send({ deviceId: 'AQ-WIN-AAAAAAAA', operations: [{ operationId: 'a', entityType: 'analysis', op: 'create', entityId: 'r1', payload: { category: 'x', title: 't', content: 'c' } }] });
    await request(app).post('/api/sync/push').set('Authorization', `Bearer ${token('BOLD-002')}`)
      .send({ deviceId: 'AQ-WIN-CCCCCCCC', operations: [{ operationId: 'b', entityType: 'analysis', op: 'create', entityId: 'r2', payload: { category: 'x', title: 't2', content: 'c2' } }] });

    const res = await request(app)
      .get('/api/sync/pull?since=0&deviceId=AQ-WIN-AAAAAAAA')
      .set('Authorization', `Bearer ${token('BOLD-001')}`);

    expect(res.status).toBe(200);
    expect(res.body.records).toHaveLength(1);
    expect(res.body.records[0].entityId).toBe('r1');
  });

  it('includes tombstones for soft-deleted records', async () => {
    const app = buildApp();
    await request(app).post('/api/sync/push').set('Authorization', `Bearer ${token('BOLD-001')}`)
      .send({ deviceId: 'AQ-WIN-AAAAAAAA', operations: [{ operationId: 'a', entityType: 'analysis', op: 'create', entityId: 'r3', payload: { category: 'x', title: 't', content: 'c' } }] });
    await request(app).post('/api/sync/push').set('Authorization', `Bearer ${token('BOLD-001')}`)
      .send({ deviceId: 'AQ-WIN-AAAAAAAA', operations: [{ operationId: 'd', entityType: 'analysis', op: 'delete', entityId: 'r3', baseVersion: 1 }] });

    const res = await request(app)
      .get('/api/sync/pull?since=0&deviceId=AQ-WIN-AAAAAAAA')
      .set('Authorization', `Bearer ${token('BOLD-001')}`);

    const rec = res.body.records.find((r) => r.entityId === 'r3');
    expect(rec.deleted).toBe(true);
    expect(rec.payload).toBeNull();
  });
});
