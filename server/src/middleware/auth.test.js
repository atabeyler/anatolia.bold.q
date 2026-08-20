import { describe, it, expect, vi } from 'vitest';
import jwt from 'jsonwebtoken';
import { authMiddleware } from './auth.js';
import { JWT_SECRET } from '../lib/jwtSecret.js';

function fakeRes() {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
}

describe('authMiddleware', () => {
  it('401s with neither a cookie nor an Authorization header', () => {
    const req = { headers: {} };
    const res = fakeRes();
    const next = vi.fn();
    authMiddleware(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('authenticates via the Authorization header (desktop/mobile path)', () => {
    const token = jwt.sign({ userCode: 'U1', nickname: 'BOLD-001' }, JWT_SECRET);
    const req = { headers: { authorization: `Bearer ${token}` } };
    const res = fakeRes();
    const next = vi.fn();
    authMiddleware(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(req.user.userCode).toBe('U1');
    expect(req.token).toBe(token);
  });

  it('authenticates via the httpOnly session cookie (web path)', () => {
    const token = jwt.sign({ userCode: 'U2', nickname: 'BOLD-002' }, JWT_SECRET);
    const req = { headers: { cookie: `other=1; anatolia_jwt=${token}; more=2` } };
    const res = fakeRes();
    const next = vi.fn();
    authMiddleware(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(req.user.userCode).toBe('U2');
    expect(req.token).toBe(token);
  });

  it('401s for an invalid/forged token from either source', () => {
    const forged = jwt.sign({ userCode: 'X' }, 'wrong-secret');
    const res = fakeRes();
    authMiddleware({ headers: { authorization: `Bearer ${forged}` } }, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(401);

    const res2 = fakeRes();
    authMiddleware({ headers: { cookie: `anatolia_jwt=${forged}` } }, res2, vi.fn());
    expect(res2.status).toHaveBeenCalledWith(401);
  });

  it('prefers the cookie when both are present', () => {
    const cookieToken = jwt.sign({ userCode: 'FROM-COOKIE' }, JWT_SECRET);
    const headerToken = jwt.sign({ userCode: 'FROM-HEADER' }, JWT_SECRET);
    const req = { headers: { cookie: `anatolia_jwt=${cookieToken}`, authorization: `Bearer ${headerToken}` } };
    const res = fakeRes();
    authMiddleware(req, res, vi.fn());
    expect(req.user.userCode).toBe('FROM-COOKIE');
  });
});
