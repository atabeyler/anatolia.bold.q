import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../lib/rbac.js';
import { getEngineStatus, runHealthChecks } from '../engines/registry.js';
import { recordAuditEvent } from '../services/audit.js';

export const enginesRouter = Router();

enginesRouter.use(requireAuth);

enginesRouter.get('/', requirePermission('rule:view'), async (_req, res) => {
  res.json({ engines: await getEngineStatus() });
});

// Spawns every adapter's healthCheck() (real subprocess invocations) --
// gated behind system:manage since it's an administrative action, not a
// read. A stale/never-run health table would otherwise let a scan silently
// route to a dead engine and look like full coverage when it wasn't.
enginesRouter.post('/health-check', requirePermission('system:manage'), async (req, res) => {
  const results = await runHealthChecks();
  await recordAuditEvent({
    orgId: req.auth.orgId,
    actorUserId: req.auth.userId,
    action: 'engines.health_check',
    result: 'SUCCESS',
    metadata: { results },
  });
  res.json({ results });
});
