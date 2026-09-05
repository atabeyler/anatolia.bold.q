import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';

const isBciConfigured = vi.fn(() => true);
vi.mock('../services/bciClient.js', () => ({
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
    isBciConfigured.mockReset().mockReturnValue(true);
  });

  it('rejects a viewer-role user (analyst/admin only)', async () => {
    const app = buildApp();
    const res = await request(app).get('/api/cyber-analysis/status').set('Authorization', `Bearer ${tokenFor('viewer')}`);
    expect(res.status).toBe(403);
  });

  it('rejects an unauthenticated request', async () => {
    const app = buildApp();
    const res = await request(app).get('/api/cyber-analysis/status');
    expect(res.status).toBe(401);
  });

  it('reports availability via /status', async () => {
    isBciConfigured.mockReturnValue(false);
    const app = buildApp();
    const res = await request(app).get('/api/cyber-analysis/status').set('Authorization', `Bearer ${tokenFor('analyst')}`);
    expect(res.status).toBe(200);
    expect(res.body.available).toBe(false);
  });

  it('/ui returns the configured BCI admin UI URL', async () => {
    process.env.BCI_UI_URL = 'https://bci-ui.example.com';
    const app = buildApp();
    const res = await request(app).get('/api/cyber-analysis/ui').set('Authorization', `Bearer ${tokenFor('analyst')}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ url: 'https://bci-ui.example.com' });
    delete process.env.BCI_UI_URL;
  });

  it('/ui reports 404 (not 503) when BCI_UI_URL is not configured', async () => {
    delete process.env.BCI_UI_URL;
    const app = buildApp();
    const res = await request(app).get('/api/cyber-analysis/ui').set('Authorization', `Bearer ${tokenFor('admin')}`);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'bci_ui_not_configured' });
  });
});
