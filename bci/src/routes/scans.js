import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../lib/rbac.js';
import { query } from '../db/client.js';
import { enqueueScan, getJob, listJobs, cancelJob } from '../services/jobQueue.js';

export const scansRouter = Router();

scansRouter.use(requireAuth);

const createScanSchema = z.object({
  target: z.string().min(1),
  requestedClass: z.enum(['PASSIVE', 'SAFE_ACTIVE', 'AUTHENTICATED', 'RESTRICTED']),
});

// This is the one place a scan actually starts. It never bypasses the
// policy engine -- see services/jobQueue.js#enqueueScan -- so a DENY here is
// not a bug to work around, it's the point of the whole authorized-scope
// model in M2.
scansRouter.post('/', requirePermission('scan:create'), async (req, res) => {
  const parsed = createScanSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid_request', requestId: req.id });
  }

  const outcome = await enqueueScan({
    orgId: req.auth.orgId,
    actorUserId: req.auth.userId,
    target: parsed.data.target,
    requestedClass: parsed.data.requestedClass,
  });

  if (!outcome.accepted) {
    return res.status(403).json({ error: 'scope_denied', reason: outcome.decision.reason, requestId: req.id });
  }

  res.status(201).json({ job: outcome.job });
});

scansRouter.get('/', requirePermission('scan:view'), async (req, res) => {
  res.json({ jobs: await listJobs(req.auth.orgId) });
});

scansRouter.get('/:id', requirePermission('scan:view'), async (req, res) => {
  const job = await getJob(req.auth.orgId, req.params.id);
  if (!job) return res.status(404).json({ error: 'job_not_found', requestId: req.id });
  res.json({ job });
});

// Real per-engine execution status for a job (spec: "Motor Çalışma
// Durumu") -- straight from scan_job_engine_runs, the same table
// analysisPipeline.js writes to as each planned engine finishes. Never a
// derived/fake progress percentage: only what's actually been recorded.
scansRouter.get('/:id/engine-runs', requirePermission('scan:view'), async (req, res) => {
  const job = await getJob(req.auth.orgId, req.params.id);
  if (!job) return res.status(404).json({ error: 'job_not_found', requestId: req.id });

  const { rows } = await query(
    `SELECT engine_id, status, detail, observation_count, started_at, finished_at
       FROM scan_job_engine_runs WHERE job_id = $1 ORDER BY started_at`,
    [req.params.id]
  );
  res.json({ engineRuns: rows });
});

scansRouter.post('/:id/cancel', requirePermission('scan:cancel'), async (req, res) => {
  const job = await cancelJob({ orgId: req.auth.orgId, actorUserId: req.auth.userId, jobId: req.params.id });
  if (!job) {
    return res.status(404).json({ error: 'job_not_found_or_already_terminal', requestId: req.id });
  }
  res.json({ job });
});
