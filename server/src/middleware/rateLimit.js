import rateLimit from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import { getRedis } from '../lib/redis.js';

// express-rate-limit's default store is per-process in-memory -- behind a
// load balancer with more than one server instance (or more than one
// Node process), each instance enforces the limit independently, so the
// real effective limit is (configured limit) x (instance count), trivially
// bypassed by round-robin alone. When REDIS_URL is configured (already
// optional infra per .env.example, shared with onlineState.js), all
// instances share counters through it instead; unset, this falls back to
// the previous in-memory behavior exactly as before -- single-instance
// deployments are unaffected either way.
const redis = getRedis();
// A distinct prefix per limiter -- express-rate-limit's default key is
// req.ip alone, so three limiters sharing one RedisStore instance (or one
// prefix) would collide and count each other's requests against the same
// key. In-memory Store instances never had this problem since each
// rateLimit() call already got its own separate Map.
function makeOptions(prefix, limit) {
  return {
    windowMs: 60 * 1000,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Çok fazla istek — lütfen bir dakika sonra tekrar deneyin.' },
    ...(redis ? { store: new RedisStore({ sendCommand: (...args) => redis.call(...args), prefix }) } : {}),
  };
}

// Applied to unauthenticated or AI/email-triggering endpoints that would
// otherwise let an anonymous caller spam paid LLM calls or mail/broadcast
// sends with a trivial loop.
export const publicActionLimiter = rateLimit(makeOptions('rl:public:', 10));

export const uploadLimiter = rateLimit(makeOptions('rl:upload:', 20));

// Applied to authenticated routes that trigger a paid LLM call and/or spawn
// a Python (Qiskit) subprocess per request -- authMiddleware alone doesn't
// stop a single logged-in user from looping calls and running up cost/load.
export const analysisLimiter = rateLimit(makeOptions('rl:analysis:', 20));
