import { logger } from '../lib/logger.js';

const MIN_INTERVAL_MS = 120_000;
const MAX_INTERVAL_MS = 150_000;
const REQUEST_TIMEOUT_MS = 10_000;

function randomInterval() {
  return MIN_INTERVAL_MS + Math.random() * (MAX_INTERVAL_MS - MIN_INTERVAL_MS);
}

function scheduleNextPing(healthUrl) {
  setTimeout(async () => {
    try {
      const res = await fetch(healthUrl, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      if (!res.ok) {
        logger.warn({ status: res.status, healthUrl }, 'Self-ping health check returned a non-OK status');
      }
    } catch (err) {
      logger.warn({ err, healthUrl }, 'Self-ping health check request failed');
    } finally {
      scheduleNextPing(healthUrl);
    }
  }, randomInterval());
}

// Render's free tier spins the service down after ~15 minutes without
// inbound traffic, so the next real request pays a 30-60s cold-start
// penalty. Render injects RENDER_EXTERNAL_URL into every web service's
// environment, so its presence doubles as our "are we actually running on
// Render" check — anywhere else (local dev, another host) this is a no-op.
export function startSelfPing() {
  const baseUrl = process.env.RENDER_EXTERNAL_URL;
  if (!baseUrl) return;

  const healthUrl = new URL('/api/health', baseUrl).toString();
  logger.info({ healthUrl }, 'Self-ping enabled to prevent Render free-tier spin-down');
  scheduleNextPing(healthUrl);
}
