import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../lib/rbac.js';
import { getEngineStatus, getEngineCatalog, runHealthChecks } from '../engines/registry.js';
import { planEngines, candidateEnginesForTargetType } from '../services/analysisPlanner.js';
import { recordAuditEvent } from '../services/audit.js';

export const enginesRouter = Router();

enginesRouter.use(requireAuth);

enginesRouter.get('/', requirePermission('rule:view'), async (_req, res) => {
  res.json({ engines: await getEngineStatus() });
});

// Real engine-selection preview for the "which motors would run" question
// (analysis wizard step 2) -- never a client-side guess. Every registered
// engine (getEngineCatalog(), not just ones a health check has already
// touched) comes back with three independent facts, matching the product
// rule that an incompatible engine is shown, never hidden, while BCI's own
// recommendation and live health stay visible and separate:
//   - status: real health (HEALTHY/DEGRADED/OFFLINE/UNKNOWN)
//   - compatible: whether analysisPlanner.js would ever consider this
//     engine for the requested target type, at ANY scan class (this is
//     analysisPlanner's own scan-target-type taxonomy -- DOMAIN/URL/IP/
//     REPOSITORY/etc, not an adapter's own supportedTargetTypes field,
//     which is a *different*, asset-type taxonomy coverageScore.js uses;
//     see candidateEnginesForTargetType's own comment)
//   - recommended: whether planEngines() would actually select it for
//     this target type + the specific requested class
// hasExecutableEngine is what a caller checks before letting a scan start:
// if analysisPlanner would produce zero engines for this combination (e.g.
// DOMAIN + PASSIVE, where the only DOMAIN engine is SAFE_ACTIVE-only), this
// is false and the caller must refuse to start rather than let a job run
// into NO_COVERAGE after the fact.
const planQuerySchema = z.object({
  targetType: z.string().min(1),
  requestedClass: z.enum(['PASSIVE', 'SAFE_ACTIVE', 'AUTHENTICATED', 'RESTRICTED']),
});

enginesRouter.get('/plan', requirePermission('rule:view'), async (req, res) => {
  const parsed = planQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid_request', details: parsed.error.flatten(), requestId: req.id });
  }
  const { targetType, requestedClass } = parsed.data;

  const catalog = await getEngineCatalog();
  const compatibleIds = new Set(candidateEnginesForTargetType(targetType).map((p) => p.engineId));
  const recommendedIds = new Set(planEngines(targetType, requestedClass).map((p) => p.engineId));
  const engines = catalog.map((e) => ({
    ...e,
    compatible: compatibleIds.has(e.id),
    recommended: recommendedIds.has(e.id),
  }));

  res.json({
    engines,
    hasExecutableEngine: engines.some((e) => e.recommended && e.status === 'HEALTHY'),
  });
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
