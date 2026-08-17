import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';

let fakeRow = null;

vi.mock('../db/client.js', () => ({
  isDbConfigured: () => true,
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: async () => (fakeRow ? [fakeRow] : []),
      }),
    }),
  }),
}));
vi.mock('../db/schema.js', () => ({ analyses: {}, emergencyLogs: {} }));
vi.mock('../services/docx.js', () => ({ generateReportDocx: vi.fn(async () => Buffer.from('docx')) }));
vi.mock('../services/pdf.js', () => ({ generateReportPdf: vi.fn(async () => Buffer.from('pdf')) }));
vi.mock('../services/morningBrief.js', () => ({
  getTodayBriefing: vi.fn(), getBriefingByDate: vi.fn(), listBriefingDates: vi.fn(), generateMorningBriefIfNeeded: vi.fn(),
}));

const { default: historyRouter } = await import('./history.js');
const { JWT_SECRET } = await import('../lib/jwtSecret.js');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/history', historyRouter);
  return app;
}

function token(claims = {}) {
  return jwt.sign({ userCode: 'BOLD-001', ...claims }, JWT_SECRET, { expiresIn: '1h' });
}

beforeEach(() => {
  fakeRow = { id: 1, userCode: 'BOLD-001', category: 'savunma', title: 'T', content: 'C', aiProvider: 'Claude', createdAt: new Date(), deletedAt: null };
});

describe('GET /api/history/:id — classification access control', () => {
  it('blocks a viewer-role owner from reading their own CONFIDENTIAL-category record', async () => {
    const app = buildApp();
    const res = await request(app).get('/api/history/1').set('Authorization', `Bearer ${token({ role: 'viewer' })}`);
    expect(res.status).toBe(403);
  });

  it('allows an analyst-role owner to read their own CONFIDENTIAL-category record', async () => {
    const app = buildApp();
    const res = await request(app).get('/api/history/1').set('Authorization', `Bearer ${token({ role: 'analyst' })}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(1);
  });

  it('allows a viewer-role owner to read an INTERNAL-category record', async () => {
    fakeRow.category = 'ekonomi';
    const app = buildApp();
    const res = await request(app).get('/api/history/1').set('Authorization', `Bearer ${token({ role: 'viewer' })}`);
    expect(res.status).toBe(200);
  });
});

describe('GET /api/history/:id/download — classification access control', () => {
  it('blocks a viewer-role owner from downloading a CONFIDENTIAL-category record', async () => {
    const app = buildApp();
    const res = await request(app).get('/api/history/1/download').set('Authorization', `Bearer ${token({ role: 'viewer' })}`);
    expect(res.status).toBe(403);
  });

  it('allows an analyst-role owner to download a CONFIDENTIAL-category record', async () => {
    const app = buildApp();
    const res = await request(app).get('/api/history/1/download').set('Authorization', `Bearer ${token({ role: 'analyst' })}`);
    expect(res.status).toBe(200);
  });
});

describe('GET /api/history/:id/download-pdf — classification access control', () => {
  it('blocks a viewer-role owner from downloading a CONFIDENTIAL-category record', async () => {
    const app = buildApp();
    const res = await request(app).get('/api/history/1/download-pdf').set('Authorization', `Bearer ${token({ role: 'viewer' })}`);
    expect(res.status).toBe(403);
  });
});
