import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../lib/rbac.js';
import { syncSecurityGraph, findReachableAssets } from '../services/securityGraph.js';

export const graphRouter = Router();

graphRouter.use(requireAuth);

graphRouter.post('/sync', requirePermission('asset:update'), async (req, res) => {
  res.json(await syncSecurityGraph(req.auth.orgId));
});

// Defensive attack-path analysis (spec section 31) -- read-only, so it only
// needs asset:view, not the write-level permission the sync above requires.
graphRouter.get('/assets/:assetId/reachable', requirePermission('asset:view'), async (req, res) => {
  const reachable = await findReachableAssets(req.auth.orgId, req.params.assetId);
  res.json({ reachable });
});
