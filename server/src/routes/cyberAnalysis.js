/**
 * Cyber Analysis module -- ANATOLIA-Q's user-facing surface for BCI (BOLD
 * Cyber Intelligence). Every route here proxies to the separately deployed
 * BCI service (see services/bciClient.js); nothing in this file talks to
 * BCI's database or reimplements any of its logic. Per spec section 56,
 * users see "BCI Vulnerability Analysis"/"BCI Risk Analysis" language here,
 * never the names of the third-party scanners BCI orchestrates underneath.
 */
import express from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { requireRole, ROLES } from '../lib/rbac.js';
import { callBci, isBciConfigured } from '../services/bciClient.js';

const router = express.Router();
const asyncRoute = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

// Viewer role is intentionally excluded: Cyber Analysis surfaces
// organization-wide risk data, not the kind of thing every ANATOLIA-Q
// account should see by default.
const requireAnalyst = requireRole(ROLES.ADMIN, ROLES.ANALYST);

router.use(authMiddleware, requireAnalyst);

router.get('/status', (_req, res) => {
  res.json({ available: isBciConfigured() });
});

router.get('/overview', asyncRoute(async (req, res) => {
  const [security, coverage] = await Promise.all([
    callBci(req.user, '/api/v1/risk/security-score'),
    callBci(req.user, '/api/v1/risk/coverage-score'),
  ]);

  if (!security.ok || !coverage.ok) {
    return res.status(503).json({ error: 'bci_unavailable' });
  }
  res.json({ securityScore: security.data, coverageScore: coverage.data });
}));

router.get('/findings', asyncRoute(async (req, res) => {
  const result = await callBci(req.user, '/api/v1/findings');
  if (!result.ok) return res.status(503).json({ error: 'bci_unavailable' });
  res.json(result.data);
}));

router.get('/findings/:id', asyncRoute(async (req, res) => {
  const result = await callBci(req.user, `/api/v1/findings/${encodeURIComponent(req.params.id)}`);
  if (!result.ok) {
    return res.status(result.status === 404 ? 404 : 503).json({ error: 'bci_unavailable' });
  }
  res.json(result.data);
}));

export default router;
