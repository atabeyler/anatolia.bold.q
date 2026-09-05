// Standalone worker process. Deliberately a separate entrypoint from
// src/index.js (the control-plane API): spec section 6 requires the
// scan/data plane to be isolated from the control plane so that a
// compromised or crashed worker never becomes a compromise of BCI Core.
// This process only touches scan_jobs/job_workers -- it has no route
// handlers and never terminates the API.
import { randomUUID } from 'node:crypto';
import { pool } from './db/client.js';
import { logger } from './logger.js';
import { claimNextJob, completeJob, markNoCoverage, failJob, sweepTimedOutJobs, heartbeatWorker } from './services/jobQueue.js';
import { runAnalysisPipeline } from './services/analysisPipeline.js';

const POLL_INTERVAL_MS = Number(process.env.BCI_WORKER_POLL_MS) || 1000;
const SWEEP_INTERVAL_MS = Number(process.env.BCI_WORKER_SWEEP_MS) || 30_000;
const CONCURRENCY = Number(process.env.BCI_WORKER_CONCURRENCY) || 2;

async function workerLoop(workerId, signal) {
  while (!signal.stopped) {
    let job;
    try {
      job = await claimNextJob(workerId);
    } catch (err) {
      logger.error({ err, workerId }, 'Worker failed to claim a job');
      await sleep(POLL_INTERVAL_MS);
      continue;
    }

    if (!job) {
      await heartbeatWorker(workerId, 'IDLE');
      await sleep(POLL_INTERVAL_MS);
      continue;
    }

    await heartbeatWorker(workerId, 'BUSY', job.id);
    try {
      const result = await runAnalysisPipeline(job);
      if (result.enginesRun.length === 0) {
        await markNoCoverage(job.id, result);
        logger.warn({ workerId, jobId: job.id, ...result }, 'Job finished with no engine coverage');
      } else {
        await completeJob(job.id, result);
        logger.info({ workerId, jobId: job.id, ...result }, 'Job completed');
      }
    } catch (err) {
      await failJob(job.id, String(err?.message || err));
      logger.error({ err, workerId, jobId: job.id }, 'Job failed');
    }
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const signal = { stopped: false };
  const workers = Array.from({ length: CONCURRENCY }, (_, i) => `worker-${process.pid}-${i}-${randomUUID().slice(0, 8)}`);

  logger.info({ concurrency: CONCURRENCY, workers }, 'BCI worker pool starting');

  const loops = workers.map((id) => workerLoop(id, signal));

  const sweeper = setInterval(() => {
    sweepTimedOutJobs().catch((err) => logger.error({ err }, 'Timeout sweep failed'));
  }, SWEEP_INTERVAL_MS);

  const shutdown = async () => {
    signal.stopped = true;
    clearInterval(sweeper);
    await Promise.all(loops);
    await pool.end();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  await Promise.all(loops);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    logger.error({ err }, 'BCI worker pool crashed');
    process.exit(1);
  });
}
