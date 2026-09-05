import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../lib/rbac.js';
import { runCryptoDiscovery, listCryptoFindings } from '../services/cryptoDiscovery.js';
import { buildCbom } from '../services/cbom.js';
import { computeReadiness } from '../services/pqcReadiness.js';

export const cryptoRouter = Router();

cryptoRouter.use(requireAuth);

const discoverSchema = z.object({
  target: z.string().min(1),
  port: z.number().int().positive().max(65535).optional(),
});

// Crypto Discovery makes a real, active network connection to the target --
// the same authorization bar as starting a scan (scan:create), not a mere
// read.
cryptoRouter.post('/discover', requirePermission('scan:create'), async (req, res) => {
  const parsed = discoverSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_request', requestId: req.id });

  const outcome = await runCryptoDiscovery({
    orgId: req.auth.orgId,
    actorUserId: req.auth.userId,
    target: parsed.data.target,
    port: parsed.data.port,
  });

  if (!outcome.accepted) {
    return res.status(403).json({ error: 'scope_denied', reason: outcome.decision.reason, requestId: req.id });
  }
  if (!outcome.discovered) {
    return res.status(502).json({ error: 'discovery_failed', reason: outcome.error, requestId: req.id });
  }
  res.status(201).json({ finding: outcome.finding });
});

cryptoRouter.get('/inventory', requirePermission('finding:view'), async (req, res) => {
  res.json({ findings: await listCryptoFindings(req.auth.orgId) });
});

cryptoRouter.get('/cbom', requirePermission('finding:view'), async (req, res) => {
  res.json(await buildCbom(req.auth.orgId));
});

cryptoRouter.get('/readiness', requirePermission('finding:view'), async (req, res) => {
  res.json(await computeReadiness(req.auth.orgId));
});
