import jwt from 'jsonwebtoken';
import { JWT_SECRET } from '../lib/jwtSecret.js';
import { readAuthCookie } from '../lib/cookies.js';

// Accepts either an httpOnly session cookie (web) or an `Authorization:
// Bearer` header (desktop/mobile, which run from a different origin than
// the API and so never receive/send the cookie -- see lib/cookies.js).
// The cookie is checked first only because it's the more common case now;
// a request never legitimately carries both.
export function authMiddleware(req, res, next) {
  const cookieToken = readAuthCookie(req.headers.cookie);
  const auth = req.headers.authorization;
  const headerToken = auth?.startsWith('Bearer ') ? auth.slice(7) : null;
  const token = cookieToken || headerToken;

  if (!token) {
    return res.status(401).json({ error: 'Yetkisiz' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    // Stashed so a route that needs to forward the caller's identity to
    // another internal request (see routes/platform.js's replay endpoint)
    // can do so regardless of whether this request authenticated via
    // cookie or header.
    req.token = token;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Token geçersiz' });
  }
}
