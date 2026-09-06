import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { query } from '../src/db/client.js';
import { resetDatabase, createOrg, createUser } from './helpers/db.js';
import { enqueueScan, claimNextJob, completeJob } from '../src/services/jobQueue.js';
import { runAnalysisPipeline } from '../src/services/analysisPipeline.js';
import { getAdapter, runHealthChecks } from '../src/engines/registry.js';

const execFileAsync = promisify(execFile);

// enqueueScan()'s selectedEngineIds health check reads engine_health, which
// only real runHealthChecks() ever populates -- resetDatabase() never
// truncates it (a live-status table, not per-test data), so relying on some
// earlier test file to have called it first is exactly the file-order
// fragility this suite avoids elsewhere. Run it once here so the
// selection-narrowing test below is correct regardless of run order.
beforeAll(runHealthChecks, 30_000);

beforeEach(resetDatabase);

async function approveScope(orgId, userId, target, targetType, classes = ['PASSIVE', 'SAFE_ACTIVE']) {
  await query(
    `INSERT INTO authorized_scopes (org_id, name, target, target_type, allowed_scan_classes, status, created_by, approved_by, approved_at)
     VALUES ($1,'scope',$2,$3,$4,'APPROVED',$5,$5,now())`,
    [orgId, target, targetType, classes, userId]
  );
}

async function ifHealthy(engineId) {
  return (await getAdapter(engineId).healthCheck()).status === 'HEALTHY';
}

// Real, self-owned local git repo -- the pipeline clones it exactly like it
// would clone any authorized REPOSITORY target, no network access needed.
let repoDir;
beforeAll(async () => {
  repoDir = await mkdtemp(path.join(os.tmpdir(), 'bci-pipeline-fixture-'));
  await writeFile(
    path.join(repoDir, 'package.json'),
    JSON.stringify({ name: 'fixture', version: '1.0.0', dependencies: { lodash: '4.17.4' } })
  );
  await writeFile(
    path.join(repoDir, 'package-lock.json'),
    JSON.stringify({
      name: 'fixture', version: '1.0.0', lockfileVersion: 1, requires: true,
      dependencies: { lodash: { version: '4.17.4', resolved: 'https://registry.npmjs.org/lodash/-/lodash-4.17.4.tgz' } },
    })
  );
  await writeFile(path.join(repoDir, 'app.js'), 'function run(input) { return eval(input); }\nmodule.exports = { run };\n');
  await execFileAsync('git', ['init', '-q'], { cwd: repoDir });
  await execFileAsync('git', ['config', 'user.email', 'test@test.local'], { cwd: repoDir });
  await execFileAsync('git', ['config', 'user.name', 'Test'], { cwd: repoDir });
  await execFileAsync('git', ['add', '-A'], { cwd: repoDir });
  await execFileAsync('git', ['commit', '-q', '-m', 'fixture'], { cwd: repoDir });
});
afterAll(async () => {
  if (repoDir) await rm(repoDir, { recursive: true, force: true });
});

describe('runAnalysisPipeline — REPOSITORY (real clone + real engines, skips if binaries missing)', () => {
  it('clones the repo, runs SAST/SCA, and produces a correlated, risk-scored Finding', async () => {
    if (!(await ifHealthy('osv-scanner')) && !(await ifHealthy('semgrep')) && !(await ifHealthy('trivy'))) return;

    const orgId = await createOrg();
    const userId = await createUser(orgId, { roleId: 'operator' });
    await approveScope(orgId, userId, repoDir, 'REPOSITORY');

    const { job, accepted } = await enqueueScan({ orgId, actorUserId: userId, target: repoDir, requestedClass: 'PASSIVE' });
    expect(accepted).toBe(true);

    const claimed = await claimNextJob('test-worker');
    const result = await runAnalysisPipeline(claimed);

    expect(result.enginesRun.length).toBeGreaterThan(0);
    expect(result.findingIds.length).toBeGreaterThan(0);

    // The guard above only requires at least one of the three real SAST/SCA
    // binaries to be healthy -- not all three -- so a planned-but-unhealthy
    // engine here is legitimately SKIPPED, never FAILED, matching the
    // "one engine unavailable never masks as job-level success" contract
    // tested explicitly below. Only the engines that actually ran must be
    // COMPLETED; asserting it of every planned engine would fail on any
    // real environment (this one included) that doesn't have every one of
    // osv-scanner/semgrep/trivy installed.
    const { rows: runs } = await query('SELECT engine_id, status FROM scan_job_engine_runs WHERE job_id = $1', [job.id]);
    const ranRuns = runs.filter((r) => result.enginesRun.includes(r.engine_id));
    const notRanRuns = runs.filter((r) => !result.enginesRun.includes(r.engine_id));
    expect(ranRuns.every((r) => r.status === 'COMPLETED')).toBe(true);
    expect(notRanRuns.every((r) => r.status === 'SKIPPED')).toBe(true);

    const { rows: findings } = await query('SELECT * FROM findings WHERE id = ANY($1)', [result.findingIds]);
    expect(findings.every((f) => f.risk_score !== null)).toBe(true);
  }, 60_000);
});

describe('runAnalysisPipeline — real per-job engine selection actually narrows what runs', () => {
  it('only runs the user-selected engine, not the other recommended ones, when selectedEngineIds narrows the plan', async () => {
    if (!(await ifHealthy('trivy'))) return;

    const orgId = await createOrg();
    const userId = await createUser(orgId, { roleId: 'operator' });
    await approveScope(orgId, userId, repoDir, 'REPOSITORY');

    // REPOSITORY's real recommended plan is semgrep+osv-scanner+trivy
    // (analysisPlanner.js) -- selecting only trivy must mean only trivy
    // actually executes, proving the selection is honored by the real
    // pipeline, not just recorded and ignored.
    const { job, accepted } = await enqueueScan({
      orgId, actorUserId: userId, target: repoDir, requestedClass: 'PASSIVE', selectedEngineIds: ['trivy'], selectedCapabilities: ['SCA'],
    });
    expect(accepted).toBe(true);
    expect(job.recommended_engine_ids.sort()).toEqual(['osv-scanner', 'semgrep', 'trivy']);
    expect(job.selected_engine_ids).toEqual(['trivy']);

    const claimed = await claimNextJob('test-worker-selection');
    const result = await runAnalysisPipeline(claimed);
    expect(result.enginesRun).toEqual(['trivy']);

    const { rows: runs } = await query('SELECT engine_id FROM scan_job_engine_runs WHERE job_id = $1', [job.id]);
    expect(runs.map((r) => r.engine_id)).toEqual(['trivy']);
  }, 60_000);
});

describe('runAnalysisPipeline — one engine unavailable never masks as job-level success (spec section 2)', () => {
  const trivyAdapter = getAdapter('trivy');
  const originalTrivyHealthCheck = trivyAdapter.healthCheck;
  afterEach(() => {
    trivyAdapter.healthCheck = originalTrivyHealthCheck;
  });

  it('records trivy as SKIPPED, other engines as COMPLETED, and the job still finishes (never a silent full-coverage lie)', async () => {
    if (!(await ifHealthy('osv-scanner')) && !(await ifHealthy('semgrep'))) return;

    trivyAdapter.healthCheck = async () => ({ status: 'OFFLINE', detail: 'binary not found (simulated)' });

    const orgId = await createOrg();
    const userId = await createUser(orgId, { roleId: 'operator' });
    await approveScope(orgId, userId, repoDir, 'REPOSITORY');

    const { job, accepted } = await enqueueScan({ orgId, actorUserId: userId, target: repoDir, requestedClass: 'PASSIVE' });
    expect(accepted).toBe(true);

    const claimed = await claimNextJob('test-worker-skip');
    const result = await runAnalysisPipeline(claimed);

    expect(result.enginesSkipped.some((s) => s.engineId === 'trivy')).toBe(true);

    const { rows: runs } = await query('SELECT engine_id, status FROM scan_job_engine_runs WHERE job_id = $1', [job.id]);
    const trivyRun = runs.find((r) => r.engine_id === 'trivy');
    expect(trivyRun.status).toBe('SKIPPED');
    // A skipped engine is a real, visible fact -- never silently absorbed
    // into a run that then looks like every engine succeeded.
    expect(runs.some((r) => r.engine_id !== 'trivy' && r.status === 'COMPLETED')).toBe(true);

    // Job-level status (set by worker.js's completeJob(), mirrored here) is
    // honestly about pipeline orchestration completing, not "every engine
    // succeeded" -- that distinction lives in scan_job_engine_runs above
    // and in the Coverage Score, never hidden by collapsing both into one
    // flag.
    await completeJob(job.id, result);
    const { rows: jobRows } = await query('SELECT status FROM scan_jobs WHERE id = $1', [job.id]);
    expect(jobRows[0].status).toBe('COMPLETED');
  }, 60_000);
});

describe('runAnalysisPipeline — DOMAIN/URL via Nuclei against a self-owned local server', () => {
  it('detects the missing-HSTS finding and risk-scores it', async () => {
    if (!(await ifHealthy('nuclei'))) return;

    const server = http.createServer((_req, res) => res.end('ok'));
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const target = `http://127.0.0.1:${server.address().port}`;

    try {
      const orgId = await createOrg();
      const userId = await createUser(orgId, { roleId: 'operator' });
      await approveScope(orgId, userId, target, 'URL');

      const { accepted } = await enqueueScan({ orgId, actorUserId: userId, target, requestedClass: 'SAFE_ACTIVE' });
      expect(accepted).toBe(true);

      const claimed = await claimNextJob('test-worker-2');
      const result = await runAnalysisPipeline(claimed);

      expect(result.enginesRun).toContain('nuclei');
      expect(result.findingIds.length).toBeGreaterThan(0);
    } finally {
      server.close();
    }
  }, 60_000);
});

describe('scan preflight — no engine coverage for an unsupported target type', () => {
  it('rejects before queueing rather than creating a zero-engine job', async () => {
    const orgId = await createOrg();
    const userId = await createUser(orgId, { roleId: 'operator' });
    await approveScope(orgId, userId, '123456789012', 'CLOUD_ACCOUNT', ['PASSIVE']);

    const { accepted } = await enqueueScan({ orgId, actorUserId: userId, target: '123456789012', requestedClass: 'PASSIVE' });
    expect(accepted).toBe(false);
    expect((await query('SELECT count(*)::int AS n FROM scan_jobs')).rows[0].n).toBe(0);
  });
});
