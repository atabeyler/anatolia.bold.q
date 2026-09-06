import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../lib/rbac.js';
import { getEngineStatus, getEngineCatalog, getCapabilityCatalog, runHealthChecks } from '../engines/registry.js';
import { planEngines, candidateEnginesForTargetType, availableCapabilitiesForTargetType } from '../services/analysisPlanner.js';
import { recordAuditEvent } from '../services/audit.js';
import { config } from '../config.js';

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
  capabilities: z.string().optional(),
});

enginesRouter.get('/plan', requirePermission('rule:view'), async (req, res) => {
  const parsed = planQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid_request', details: parsed.error.flatten(), requestId: req.id });
  }
  const { targetType, requestedClass, capability, capabilities } = parsed.data;
  const selectedCapabilities = [...new Set((capabilities ? capabilities.split(',') : capability ? [capability] : []).filter(Boolean).map((id) => id.toUpperCase()))];
  const capabilityCatalog = getCapabilityCatalog();
  const unknownCapabilities = selectedCapabilities.filter((id) => !capabilityCatalog.some((c) => c.id === id));
  if (unknownCapabilities.length > 0) {
    return res.status(400).json({ error: 'unknown_capability', capabilities: unknownCapabilities, requestId: req.id });
  }

  const catalog = await getEngineCatalog();
  const targetIds = new Set(candidateEnginesForTargetType(targetType).map((p) => p.engineId));
  const targetCapabilitiesById = new Map(candidateEnginesForTargetType(targetType).map((plan) => [plan.engineId, plan.capabilities]));
  const plannedIds = new Set(planEngines(targetType, requestedClass, selectedCapabilities).map((p) => p.engineId));
  const engines = catalog.map((e) => {
    const targetCompatible = targetIds.has(e.id);
    const intrusivenessCompatible = targetCompatible && planEngines(targetType, requestedClass).some((p) => p.engineId === e.id);
    const targetCapabilities = targetCapabilitiesById.get(e.id) ?? [];
    const capabilityCompatible = selectedCapabilities.length === 0 || targetCapabilities.some((id) => selectedCapabilities.includes(id));
    const compatible = targetCompatible && intrusivenessCompatible && capabilityCompatible;
    const reasons = [];
    if (!targetCompatible) reasons.push('TARGET_TYPE_UNSUPPORTED');
    else if (!intrusivenessCompatible) reasons.push('INTRUSIVENESS_EXCEEDS_REQUEST');
    if (!capabilityCompatible) reasons.push('CAPABILITY_UNSUPPORTED');
    if (e.status !== 'HEALTHY') reasons.push('ENGINE_UNAVAILABLE');
    const recommended = plannedIds.has(e.id);
    return {
      ...e, targetCapabilities, targetCompatible, intrusivenessCompatible, capabilityCompatible, compatible, recommended,
      compatibilityStatus: compatible ? 'COMPATIBLE' : 'INCOMPATIBLE',
      availabilityStatus: e.status === 'HEALTHY' ? 'AVAILABLE' : 'UNAVAILABLE',
      decision: e.status !== 'HEALTHY' ? 'UNAVAILABLE' : recommended ? 'RECOMMENDED' : compatible ? 'COMPATIBLE' : 'INCOMPATIBLE',
      reasons,
    };
  });

  res.json({
    engines,
    capabilities: availableCapabilitiesForTargetType(targetType, requestedClass, catalog),
    selectedCapabilities,
    hasExecutableEngine: engines.some((e) => e.recommended && e.status === 'HEALTHY'),
  });
});

enginesRouter.post('/health-check', requirePermission('system:manage'), async (req, res) => {
  // Scanner binaries live in the isolated worker in the split production
  // deployment. Probing inside the API image would overwrite truthful worker
  // health with false OFFLINE results. LOCAL mode remains available for a
  // deliberately co-located development/runtime setup.
  const workerManaged = config.engineHealthMode === 'WORKER';
  const results = workerManaged ? await getEngineStatus() : await runHealthChecks();
  await recordAuditEvent({
    orgId: req.auth.orgId,
    actorUserId: req.auth.userId,
    action: 'engines.health_check',
    result: 'SUCCESS',
    metadata: { results, mode: workerManaged ? 'WORKER_SNAPSHOT' : 'LOCAL_EXECUTION' },
  });
  res.json({ results, mode: workerManaged ? 'WORKER_SNAPSHOT' : 'LOCAL_EXECUTION' });
});
