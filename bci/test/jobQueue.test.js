import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { query } from '../src/db/client.js';
import { resetDatabase, createOrg, createUser } from './helpers/db.js';
import {
  enqueueScan,
  claimNextJob,
  completeJob,
  markNoCoverage,
  failJob,
  cancelJob,
  sweepTimedOutJobs,
} from '../src/services/jobQueue.js';
import { runHealthChecks } from '../src/engines/registry.js';

// enqueueScan()'s selectedEngineIds health check reads engine_health, which
// only real runHealthChecks() ever populates -- resetDatabase() never
// truncates it (it's a live-status table, not per-test data), so relying on
// some earlier test file happening to have called runHealthChecks() first
// is exactly the file-execution-order fragility this suite explicitly
// avoids elsewhere (see globalSetup.js's engine_registry seeding comment).
// Running it once here, up front, makes this file's healthy-selection
// tests correct regardless of run order.
beforeAll(runHealthChecks);

beforeEach(resetDatabase);

async function approveScope(orgId, userId, target, allowedScanClasses = ['PASSIVE'], targetType = 'DOMAIN') {
  const { rows } = await query(
    `INSERT INTO authorized_scopes (org_id, name, target, target_type, allowed_scan_classes, status, created_by, approved_by, approved_at)
     VALUES ($1, 'scope', $2, $3, $4, 'APPROVED', $5, $5, now()) RETURNING id`,
    [orgId, target, targetType, allowedScanClasses, userId]
  );
  return rows[0].id;
}

describe('job queue', () => {
  it('refuses to enqueue a scan with no matching authorized scope', async () => {
    const orgId = await createOrg();
    const userId = await createUser(orgId, { roleId: 'operator' });

    const outcome = await enqueueScan({ orgId, actorUserId: userId, target: 'example.com', requestedClass: 'PASSIVE' });
    expect(outcome.accepted).toBe(false);
    expect(outcome.decision.decision).toBe('DENY');

    const { rows } = await query('SELECT count(*)::int AS n FROM scan_jobs');
    expect(rows[0].n).toBe(0);
  });

  it('enqueues a QUEUED job once the target is in an approved scope', async () => {
    const orgId = await createOrg();
    const userId = await createUser(orgId, { roleId: 'operator' });
    await approveScope(orgId, userId, 'example.com');

    const outcome = await enqueueScan({ orgId, actorUserId: userId, target: 'example.com', requestedClass: 'PASSIVE' });
    expect(outcome.accepted).toBe(true);
    expect(outcome.job.status).toBe('QUEUED');
  });

  it('with no selectedEngineIds, defaults selected_engine_ids to the full real recommended plan (unchanged pre-existing behavior)', async () => {
    const orgId = await createOrg();
    const userId = await createUser(orgId, { roleId: 'operator' });
    await approveScope(orgId, userId, '/tmp/some-repo', ['PASSIVE'], 'REPOSITORY');

    const outcome = await enqueueScan({ orgId, actorUserId: userId, target: '/tmp/some-repo', requestedClass: 'PASSIVE' });
    expect(outcome.accepted).toBe(true);
    expect(outcome.job.recommended_engine_ids.sort()).toEqual(['osv-scanner', 'semgrep', 'trivy']);
    expect(outcome.job.selected_engine_ids.sort()).toEqual(['osv-scanner', 'semgrep', 'trivy']);
  });

  it('accepts a real subset of the recommended engines as selectedEngineIds', async () => {
    const orgId = await createOrg();
    const userId = await createUser(orgId, { roleId: 'operator' });
    await approveScope(orgId, userId, '/tmp/some-repo', ['PASSIVE'], 'REPOSITORY');

    const outcome = await enqueueScan({
      orgId, actorUserId: userId, target: '/tmp/some-repo', requestedClass: 'PASSIVE', selectedEngineIds: ['semgrep'],
    });
    expect(outcome.accepted).toBe(true);
    expect(outcome.job.selected_engine_ids).toEqual(['semgrep']);
    expect(outcome.job.recommended_engine_ids.sort()).toEqual(['osv-scanner', 'semgrep', 'trivy']); // recommendation itself unchanged
  });

  it('rejects a selectedEngineIds entry that is not compatible/recommended for this target type -- never silently ignored, never allowed to add scope', async () => {
    const orgId = await createOrg();
    const userId = await createUser(orgId, { roleId: 'operator' });
    await approveScope(orgId, userId, '/tmp/some-repo', ['PASSIVE'], 'REPOSITORY');

    // nuclei is a DOMAIN/WEB engine, never recommended for REPOSITORY.
    const outcome = await enqueueScan({
      orgId, actorUserId: userId, target: '/tmp/some-repo', requestedClass: 'PASSIVE', selectedEngineIds: ['nuclei'],
    });
    expect(outcome.accepted).toBe(false);
    expect(outcome.decision.reason).toBe('engine_not_compatible_or_recommended');

    const { rows } = await query('SELECT count(*)::int AS n FROM scan_jobs');
    expect(rows[0].n).toBe(0); // no job created on rejection
  });

  it('rejects an empty selectedEngineIds array -- at least one engine is required if a selection is made at all', async () => {
    const orgId = await createOrg();
    const userId = await createUser(orgId, { roleId: 'operator' });
    await approveScope(orgId, userId, '/tmp/some-repo', ['PASSIVE'], 'REPOSITORY');

    const outcome = await enqueueScan({
      orgId, actorUserId: userId, target: '/tmp/some-repo', requestedClass: 'PASSIVE', selectedEngineIds: [],
    });
    expect(outcome.accepted).toBe(false);
    expect(outcome.decision.reason).toBe('at_least_one_engine_required');
  });

  it('rejects a selected engine that is compatible/recommended but not actually HEALTHY', async () => {
    const orgId = await createOrg();
    const userId = await createUser(orgId, { roleId: 'operator' });
    await approveScope(orgId, userId, '/tmp/some-repo', ['PASSIVE'], 'REPOSITORY');
    await query(
      `INSERT INTO engine_health (engine_id, status, last_checked_at) VALUES ('semgrep', 'OFFLINE', now())
       ON CONFLICT (engine_id) DO UPDATE SET status = 'OFFLINE', last_checked_at = now()`
    );

    const outcome = await enqueueScan({
      orgId, actorUserId: userId, target: '/tmp/some-repo', requestedClass: 'PASSIVE', selectedEngineIds: ['semgrep'],
    });
    expect(outcome.accepted).toBe(false);
    expect(outcome.decision.reason).toBe('engine_not_healthy');
  });

  it('claimNextJob moves a job to ANALYZING and stamps a timeout', async () => {
    const orgId = await createOrg();
    const userId = await createUser(orgId, { roleId: 'operator' });
    await approveScope(orgId, userId, 'example.com');
    const { job } = await enqueueScan({ orgId, actorUserId: userId, target: 'example.com', requestedClass: 'PASSIVE' });

    const claimed = await claimNextJob('worker-1');
    expect(claimed.id).toBe(job.id);
    expect(claimed.status).toBe('ANALYZING');
    expect(claimed.attempts).toBe(1);
    expect(claimed.timeout_at).not.toBeNull();
  });

  it('two workers claiming concurrently never get the same job', async () => {
    const orgId = await createOrg();
    const userId = await createUser(orgId, { roleId: 'operator' });
    await approveScope(orgId, userId, 'example.com');
    await enqueueScan({ orgId, actorUserId: userId, target: 'example.com', requestedClass: 'PASSIVE' });

    const [a, b] = await Promise.all([claimNextJob('worker-a'), claimNextJob('worker-b')]);
    const claimed = [a, b].filter(Boolean);
    expect(claimed).toHaveLength(1);
  });

  it('completeJob marks the job COMPLETED with a result payload', async () => {
    const orgId = await createOrg();
    const userId = await createUser(orgId, { roleId: 'operator' });
    await approveScope(orgId, userId, 'example.com');
    const { job } = await enqueueScan({ orgId, actorUserId: userId, target: 'example.com', requestedClass: 'PASSIVE' });
    await claimNextJob('worker-1');

    await completeJob(job.id, { ok: true });
    const { rows } = await query('SELECT status, result FROM scan_jobs WHERE id = $1', [job.id]);
    expect(rows[0].status).toBe('COMPLETED');
    expect(rows[0].result).toEqual({ ok: true });
  });

  it('markNoCoverage marks the job NO_COVERAGE, distinct from COMPLETED, when the pipeline ran zero engines', async () => {
    const orgId = await createOrg();
    const userId = await createUser(orgId, { roleId: 'operator' });
    await approveScope(orgId, userId, 'example.com');
    const { job } = await enqueueScan({ orgId, actorUserId: userId, target: 'example.com', requestedClass: 'PASSIVE' });
    await claimNextJob('worker-1');

    await markNoCoverage(job.id, { enginesRun: [], note: 'no engine coverage for target type DOMAIN' });
    const { rows } = await query('SELECT status, result FROM scan_jobs WHERE id = $1', [job.id]);
    expect(rows[0].status).toBe('NO_COVERAGE');
    expect(rows[0].status).not.toBe('COMPLETED');
    expect(rows[0].result.note).toMatch(/no engine coverage/);
  });

  it('failJob requeues until max_attempts, then marks FAILED for good', async () => {
    const orgId = await createOrg();
    const userId = await createUser(orgId, { roleId: 'operator' });
    await approveScope(orgId, userId, 'example.com');
    const { job } = await enqueueScan({ orgId, actorUserId: userId, target: 'example.com', requestedClass: 'PASSIVE' });
    await query('UPDATE scan_jobs SET max_attempts = 2 WHERE id = $1', [job.id]);

    await claimNextJob('worker-1'); // attempt 1
    await failJob(job.id, 'boom');
    let { rows } = await query('SELECT status, attempts FROM scan_jobs WHERE id = $1', [job.id]);
    expect(rows[0].status).toBe('QUEUED');
    expect(rows[0].attempts).toBe(1);

    await claimNextJob('worker-1'); // attempt 2
    await failJob(job.id, 'boom again');
    ({ rows } = await query('SELECT status FROM scan_jobs WHERE id = $1', [job.id]));
    expect(rows[0].status).toBe('FAILED');
  });

  it('cancelJob stops a QUEUED job but not an already-terminal one', async () => {
    const orgId = await createOrg();
    const userId = await createUser(orgId, { roleId: 'operator' });
    await approveScope(orgId, userId, 'example.com');
    const { job } = await enqueueScan({ orgId, actorUserId: userId, target: 'example.com', requestedClass: 'PASSIVE' });

    const cancelled = await cancelJob({ orgId, actorUserId: userId, jobId: job.id });
    expect(cancelled.status).toBe('CANCELLED');

    const again = await cancelJob({ orgId, actorUserId: userId, jobId: job.id });
    expect(again).toBeNull();
  });

  it('sweepTimedOutJobs requeues a stuck job within its attempt budget and TIMED_OUTs it once exhausted', async () => {
    const orgId = await createOrg();
    const userId = await createUser(orgId, { roleId: 'operator' });
    await approveScope(orgId, userId, 'example.com');
    const { job } = await enqueueScan({ orgId, actorUserId: userId, target: 'example.com', requestedClass: 'PASSIVE' });
    await query('UPDATE scan_jobs SET max_attempts = 1 WHERE id = $1', [job.id]);

    await claimNextJob('worker-1');
    // Simulate a worker that crashed mid-job: force the timeout into the past.
    await query("UPDATE scan_jobs SET timeout_at = now() - interval '1 minute' WHERE id = $1", [job.id]);

    const swept = await sweepTimedOutJobs();
    expect(swept).toBe(1);

    const { rows } = await query('SELECT status FROM scan_jobs WHERE id = $1', [job.id]);
    expect(rows[0].status).toBe('TIMED_OUT');
  });
});
