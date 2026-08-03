import jwt from 'jsonwebtoken';
import { JWT_SECRET } from './jwtSecret.js';

/**
 * Best-effort user identification for endpoints that must stay reachable
 * without a login (e.g. the pre-login emergency center button) but still
 * want to attribute the action to a known user when a valid token is
 * present. Falls back to 'ANONİM' for missing/invalid/expired tokens --
 * never throws.
 */
export function getOptionalUserCode(req) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) return 'ANONİM';
  try {
    const decoded = jwt.verify(auth.slice(7), JWT_SECRET);
    return decoded.userCode || 'ANONİM';
  } catch {
    return 'ANONİM';
  }
}
