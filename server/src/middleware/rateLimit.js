import rateLimit from 'express-rate-limit';

// Applied to unauthenticated or AI/email-triggering endpoints that would
// otherwise let an anonymous caller spam paid LLM calls or mail/broadcast
// sends with a trivial loop.
export const publicActionLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Çok fazla istek — lütfen bir dakika sonra tekrar deneyin.' },
});

export const uploadLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Çok fazla istek — lütfen bir dakika sonra tekrar deneyin.' },
});

// Applied to authenticated routes that trigger a paid LLM call and/or spawn
// a Python (Qiskit) subprocess per request -- authMiddleware alone doesn't
// stop a single logged-in user from looping calls and running up cost/load.
export const analysisLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Çok fazla istek — lütfen bir dakika sonra tekrar deneyin.' },
});
