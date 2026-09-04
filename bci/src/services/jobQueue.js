import { pool, query } from '../db/client.js';
import { evaluateScopeAuthorization } from './policyEngine.js';
import { recordAuditEvent } from './audit.js';

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

// The only way into the queue. A DENY from the policy engine never reaches
// the database as a job row -- there is no "create job now, check policy
// later" path, because that would be the AI-changes-the-authorization-
// decision bug in table form.
export async function enqueueScan({ orgId, actorUserId, target, requestedClass }) {
  const decision = await evaluateScopeAuthorization({ orgId, actorUserId, target, requestedClass });
  if (decision.decision !== 'ALLOW') {
    return { accepted: false, decision };
  }

  const { rows } = await query(
    `INSERT INTO scan_jobs (org_id, requested_by, target, requested_class, scope_id)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, status, created_at`,
    [orgId, actorUserId, target, requestedClass, decision.scopeId]
  );

  await recordAuditEvent({
    orgId,
    actorUserId,
    action: 'scan.create',
    targetType: 'scan_job',
    targetId: rows[0].id,
    result: 'SUCCESS',
    metadata: { target, requestedClass },
  });

  return { accepted: true, job: rows[0] };
}

export async function getJob(orgId, jobId) {
  const { rows } = await query('SELECT * FROM scan_jobs WHERE id = $1 AND org_id = $2', [jobId, orgId]);
  return rows[0] || null;
}

export async function listJobs(orgId) {
  const { rows } = await query(
    'SELECT id, target, requested_class, status, attempts, created_at, updated_at FROM scan_jobs WHERE org_id = $1 ORDER BY created_at DESC',
    [orgId]
  );
  return rows;
}

export async function cancelJob({ orgId, actorUserId, jobId }) {
  const { rows } = await query(
    `UPDATE scan_jobs SET status = 'CANCELLED', updated_at = now()
      WHERE id = $1 AND org_id = $2 AND status NOT IN ('COMPLETED', 'FAILED', 'CANCELLED', 'TIMED_OUT')
      RETURNING id, status`,
    [jobId, orgId]
  );
  if (rows.length === 0) return null;

  await recordAuditEvent({
    orgId,
    actorUserId,
    action: 'scan.cancel',
    targetType: 'scan_job',
    targetId: jobId,
    result: 'SUCCESS',
  });
  return rows[0];
}

// Atomically claims one queued job for this worker. SKIP LOCKED means N
// concurrent workers never claim the same row or block on each other.
export async function claimNextJob(workerId, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT id FROM scan_jobs
        WHERE status = 'QUEUED'
        ORDER BY created_at
        FOR UPDATE SKIP LOCKED
        LIMIT 1`
    );
    if (rows.length === 0) {
      await client.query('COMMIT');
      return null;
    }

    const { rows: updated } = await client.query(
      `UPDATE scan_jobs SET
          status = 'ANALYZING',
          attempts = attempts + 1,
          locked_by = $1,
          locked_at = now(),
          timeout_at = now() + ($2 || ' milliseconds')::interval,
          updated_at = now()
        WHERE id = $3
        RETURNING *`,
      [workerId, timeoutMs, rows[0].id]
    );
    await client.query('COMMIT');
    return updated[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function completeJob(jobId, result) {
  await query(
    `UPDATE scan_jobs SET status = 'COMPLETED', result = $1, locked_by = NULL, updated_at = now() WHERE id = $2`,
    [JSON.stringify(result ?? {}), jobId]
  );
}

// Bounded, idempotent retry: a job gets max_attempts tries total, then it's
// FAILED for good -- never retried forever, never silently dropped.
export async function failJob(jobId, errorMessage) {
  const { rows } = await query('SELECT attempts, max_attempts FROM scan_jobs WHERE id = $1', [jobId]);
  const job = rows[0];
  if (!job) return;

  const nextStatus = job.attempts >= job.max_attempts ? 'FAILED' : 'QUEUED';
  await query(
    `UPDATE scan_jobs SET status = $1, error = $2, locked_by = NULL, updated_at = now() WHERE id = $3`,
    [nextStatus, errorMessage, jobId]
  );
}

// Sweeps jobs whose timeout_at has passed while still not in a terminal
// state -- a worker that crashed mid-job (no chance to call failJob itself)
// must not leave that job stuck in ANALYZING forever.
export async function sweepTimedOutJobs() {
  const { rows } = await query(
    `SELECT id, attempts, max_attempts FROM scan_jobs
      WHERE status NOT IN ('QUEUED', 'COMPLETED', 'FAILED', 'CANCELLED', 'TIMED_OUT')
        AND timeout_at IS NOT NULL AND timeout_at < now()`
  );

  for (const job of rows) {
    const nextStatus = job.attempts >= job.max_attempts ? 'TIMED_OUT' : 'QUEUED';
    await query(
      `UPDATE scan_jobs SET status = $1, locked_by = NULL, updated_at = now() WHERE id = $2`,
      [nextStatus, job.id]
    );
  }
  return rows.length;
}

export async function heartbeatWorker(workerId, status, currentJobId = null) {
  await query(
    `INSERT INTO job_workers (worker_id, status, current_job, last_seen_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (worker_id) DO UPDATE SET status = $2, current_job = $3, last_seen_at = now()`,
    [workerId, status, currentJobId]
  );
}
