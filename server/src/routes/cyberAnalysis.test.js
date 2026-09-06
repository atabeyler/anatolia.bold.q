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

describe('/api/cyber-analysis/proxy/* (generic BCI passthrough)', () => {
  beforeEach(() => {
    callBci.mockReset();
    isBciConfigured.mockReset().mockReturnValue(true);
  });

  it('forwards a GET to the corresponding BCI path and returns its data', async () => {
    callBci.mockResolvedValueOnce({ ok: true, data: { assets: [{ id: 'a1' }] } });
    const app = buildApp();
    const res = await request(app).get('/api/cyber-analysis/proxy/assets').set('Authorization', `Bearer ${tokenFor('analyst')}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ assets: [{ id: 'a1' }] });
    expect(callBci).toHaveBeenCalledWith(expect.anything(), '/api/v1/assets', { method: 'GET', body: undefined });
  });

  it('forwards a POST body to the corresponding BCI path', async () => {
    callBci.mockResolvedValueOnce({ ok: true, data: { asset: { id: 'a2' } } });
    const app = buildApp();
    const res = await request(app)
      .post('/api/cyber-analysis/proxy/assets')
      .set('Authorization', `Bearer ${tokenFor('analyst')}`)
      .send({ name: 'example.com', assetType: 'DOMAIN' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ asset: { id: 'a2' } });
    expect(callBci).toHaveBeenCalledWith(expect.anything(), '/api/v1/assets', {
      method: 'POST',
      body: { name: 'example.com', assetType: 'DOMAIN' },
    });
  });

  it('forwards a GET query string to the corresponding BCI path (regression: req.params[0] alone drops it)', async () => {
    callBci.mockResolvedValueOnce({ ok: true, data: { engines: [] } });
    const app = buildApp();
    const res = await request(app)
      .get('/api/cyber-analysis/proxy/engines/plan?targetType=DOMAIN&requestedClass=PASSIVE')
      .set('Authorization', `Bearer ${tokenFor('analyst')}`);
    expect(res.status).toBe(200);
    expect(callBci).toHaveBeenCalledWith(
      expect.anything(),
      '/api/v1/engines/plan?targetType=DOMAIN&requestedClass=PASSIVE',
      { method: 'GET', body: undefined }
    );
  });

  it('relays a real BCI error status/body instead of masking it as 503', async () => {
    callBci.mockResolvedValueOnce({ ok: false, reason: 'bci_error', status: 403, data: { error: 'forbidden' } });
    const app = buildApp();
    const res = await request(app).get('/api/cyber-analysis/proxy/engines').set('Authorization', `Bearer ${tokenFor('analyst')}`);
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'forbidden' });
  });

  it('degrades to 503 when BCI is unreachable', async () => {
    callBci.mockResolvedValueOnce({ ok: false, reason: 'bci_unreachable' });
    const app = buildApp();
    const res = await request(app).get('/api/cyber-analysis/proxy/scans').set('Authorization', `Bearer ${tokenFor('admin')}`);
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ error: 'bci_unavailable' });
  });

  it('rejects a viewer-role user the same as every other route in this file', async () => {
    const app = buildApp();
    const res = await request(app).get('/api/cyber-analysis/proxy/assets').set('Authorization', `Bearer ${tokenFor('viewer')}`);
    expect(res.status).toBe(403);
    expect(callBci).not.toHaveBeenCalled();
  });
});
