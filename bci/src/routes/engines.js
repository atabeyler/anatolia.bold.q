import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../lib/rbac.js';
import { getEngineStatus, getEngineCatalog, getCapabilityCatalog, runHealthChecks } from '../engines/registry.js';
import { planEngines, candidateEnginesForTargetType, availableCapabilitiesForTargetType } from '../services/analysisPlanner.js';
import { recordAuditEvent } from '../services/audit.js';

export const enginesRouter = Router();
enginesRouter.use(requireAuth);

enginesRouter.get('/', requirePermission('rule:view'), async (_req, res) => {
  res.json({ engines: await getEngineStatus(), capabilities: getCapabilityCatalog() });
});

// Registry-backed capability catalog. The UI must consume this endpoint
// rather than maintain a second hard-coded list.
enginesRouter.get('/capabilities', requirePermission('rule:view'), (_req, res) => {
  res.json({ capabilities: getCapabilityCatalog() });
});

const planQuerySchema = z.object({
  targetType: z.string().min(1),
  requestedClass: z.enum(['PASSIVE', 'SAFE_ACTIVE', 'AUTHENTICATED', 'RESTRICTED']),
  capability: z.string().min(1).optional(),
});

enginesRouter.get('/plan', requirePermission('rule:view'), async (req, res) => {
  const parsed = planQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid_request', details: parsed.error.flatten(), requestId: req.id });
  }
  const { targetType, requestedClass, capability } = parsed.data;
  const requestedCapability = capability?.toUpperCase() || null;
  const capabilityCatalog = getCapabilityCatalog();
  if (requestedCapability && !capabilityCatalog.some((c) => c.id === requestedCapability)) {
    return res.status(400).json({ error: 'unknown_capability', capability: requestedCapability, requestId: req.id });
  }

  const catalog = await getEngineCatalog();
  const compatibleIds = new Set(candidateEnginesForTargetType(targetType).map((p) => p.engineId));
  const recommendedIds = new Set(planEngines(targetType, requestedClass, requestedCapability).map((p) => p.engineId));
  const engines = catalog.map((e) => ({
    ...e,
    compatible: compatibleIds.has(e.id),
    capabilityCompatible: !requestedCapability || e.capabilities.includes(requestedCapability),
    recommended: recommendedIds.has(e.id),
  }));

  res.json({
    engines,
    capabilities: availableCapabilitiesForTargetType(targetType),
    requestedCapability,
    hasExecutableEngine: engines.some((e) => e.recommended && e.status === 'HEALTHY'),
  });
});

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
