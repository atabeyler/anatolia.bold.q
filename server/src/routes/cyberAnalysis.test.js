import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';

const callBci = vi.fn();
const isBciConfigured = vi.fn(() => true);
vi.mock('../services/bciClient.js', () => ({
  callBci: (...args) => callBci(...args),
  isBciConfigured: () => isBciConfigured(),
}));

const { default: cyberAnalysisRouter } = await import('./cyberAnalysis.js');
const { JWT_SECRET } = await import('../lib/jwtSecret.js');

function tokenFor(role) {
  return jwt.sign({ userCode: 'u1', nickname: 'Test', role, isAdmin: role === 'admin' }, JWT_SECRET, { expiresIn: '1h' });
}

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/cyber-analysis', cyberAnalysisRouter);
  return app;
}

describe('GET /api/cyber-analysis/*', () => {
  beforeEach(() => {
    callBci.mockReset();
    isBciConfigured.mockReset().mockReturnValue(true);
  });

  it('rejects a viewer-role user (analyst/admin only)', async () => {
    const app = buildApp();
    const res = await request(app).get('/api/cyber-analysis/overview').set('Authorization', `Bearer ${tokenFor('viewer')}`);
    expect(res.status).toBe(403);
  });

  it('rejects an unauthenticated request', async () => {
    const app = buildApp();
    const res = await request(app).get('/api/cyber-analysis/overview');
    expect(res.status).toBe(401);
  });

  it('an analyst gets a combined overview when BCI is reachable', async () => {
    callBci.mockResolvedValueOnce({ ok: true, data: { score: 82 } }).mockResolvedValueOnce({ ok: true, data: { score: 60 } });
    const app = buildApp();
    const res = await request(app).get('/api/cyber-analysis/overview').set('Authorization', `Bearer ${tokenFor('analyst')}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ securityScore: { score: 82 }, coverageScore: { score: 60 } });
  });

  it('degrades to 503, never crashes, when BCI is unreachable', async () => {
    callBci.mockResolvedValue({ ok: false, reason: 'bci_unreachable' });
    const app = buildApp();
    const res = await request(app).get('/api/cyber-analysis/overview').set('Authorization', `Bearer ${tokenFor('admin')}`);
    expect(res.status).toBe(503);
  });

  it('reports availability via /status without requiring a live BCI call', async () => {
    isBciConfigured.mockReturnValue(false);
    const app = buildApp();
    const res = await request(app).get('/api/cyber-analysis/status').set('Authorization', `Bearer ${tokenFor('analyst')}`);
    expect(res.status).toBe(200);
    expect(res.body.available).toBe(false);
    expect(callBci).not.toHaveBeenCalled();
  });
});
