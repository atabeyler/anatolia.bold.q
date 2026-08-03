import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';

const sendEmergencyAlertMock = vi.fn(async () => {});
vi.mock('../services/email.js', () => ({ sendEmergencyAlert: (...args) => sendEmergencyAlertMock(...args) }));
vi.mock('../db/client.js', () => ({ isDbConfigured: () => false, getDb: () => { throw new Error('not used when isDbConfigured() is false'); } }));

const { default: emergencyRouter } = await import('./emergency.js');
const { JWT_SECRET } = await import('../lib/jwtSecret.js');

function buildApp() {
  const app = express();
  app.use(express.json());
  const emitted = [];
  app.set('io', { emit: (event, payload) => emitted.push({ event, payload }) });
  app.locals.emitted = emitted;
  app.use('/api/emergency', emergencyRouter);
  return app;
}

function token(userCode = 'BOLD-001') {
  return jwt.sign({ userCode }, JWT_SECRET, { expiresIn: '1h' });
}

beforeEach(() => {
  sendEmergencyAlertMock.mockClear();
});

describe('POST /api/emergency/center (no auth required)', () => {
  it('accepts a message with no Authorization header, attributed to ANONİM', async () => {
    const app = buildApp();
    const res = await request(app).post('/api/emergency/center').send({ message: 'yardım gerekli' });
    expect(res.status).toBe(200);
    expect(sendEmergencyAlertMock).toHaveBeenCalledWith('ANONİM', 'yardım gerekli', undefined);
  });

  it('attributes the message to the token owner when a valid JWT is sent', async () => {
    const app = buildApp();
    const res = await request(app).post('/api/emergency/center').set('Authorization', `Bearer ${token('BOLD-007')}`).send({ message: 'test' });
    expect(res.status).toBe(200);
    expect(sendEmergencyAlertMock).toHaveBeenCalledWith('BOLD-007', 'test', undefined);
  });

  it('rejects an empty message', async () => {
    const app = buildApp();
    const res = await request(app).post('/api/emergency/center').send({ message: '' });
    expect(res.status).toBe(400);
  });

  it('rejects a message over the length cap', async () => {
    const app = buildApp();
    const res = await request(app).post('/api/emergency/center').send({ message: 'x'.repeat(2001) });
    expect(res.status).toBe(400);
  });

  it('rejects an overly long region name', async () => {
    const app = buildApp();
    const res = await request(app).post('/api/emergency/center').send({ message: 'ok', region: 'x'.repeat(101) });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/emergency/users (requires login -- broadcasts to every connected client)', () => {
  it('rejects a request with no Authorization header', async () => {
    const app = buildApp();
    const res = await request(app).post('/api/emergency/users').send({ message: 'test' });
    expect(res.status).toBe(401);
  });

  it('rejects an invalid token', async () => {
    const app = buildApp();
    const res = await request(app).post('/api/emergency/users').set('Authorization', 'Bearer not-a-real-token').send({ message: 'test' });
    expect(res.status).toBe(401);
  });

  it('broadcasts via socket.io for a validly authenticated user', async () => {
    const app = buildApp();
    const res = await request(app).post('/api/emergency/users').set('Authorization', `Bearer ${token('BOLD-002')}`).send({ message: 'herkese haber' });
    expect(res.status).toBe(200);
    expect(app.locals.emitted).toEqual([
      { event: 'emergency:broadcast', payload: expect.objectContaining({ from: 'BOLD-002', message: 'herkese haber' }) },
    ]);
  });

  it('rejects an empty message even when authenticated', async () => {
    const app = buildApp();
    const res = await request(app).post('/api/emergency/users').set('Authorization', `Bearer ${token()}`).send({ message: '   ' });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/emergency/region (no auth required)', () => {
  it('sends a regional alert with no Authorization header', async () => {
    const app = buildApp();
    const res = await request(app).post('/api/emergency/region').send({ message: 'bölgesel durum', region: 'Marmara' });
    expect(res.status).toBe(200);
    expect(sendEmergencyAlertMock).toHaveBeenCalledWith('ANONİM', 'bölgesel durum', 'Marmara');
  });

  it('rejects a missing message', async () => {
    const app = buildApp();
    const res = await request(app).post('/api/emergency/region').send({ region: 'Ege' });
    expect(res.status).toBe(400);
  });
});
