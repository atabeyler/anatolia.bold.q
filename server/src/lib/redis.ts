/**
 * Optional Redis connection — used when REDIS_URL is set, otherwise returns
 * null and callers fall back to an in-memory store (see onlineState.ts).
 */
import { Redis } from 'ioredis';
import { logger } from './logger.js';

let client: Redis | null = null;
let initialized = false;

export function getRedis(): Redis | null {
  if (!process.env.REDIS_URL) return null;
  if (!initialized) {
    initialized = true;
    client = new Redis(process.env.REDIS_URL, {
      maxRetriesPerRequest: 2,
      lazyConnect: false,
    });
    client.on('error', (err: Error) => {
      logger.warn({ err }, '[Redis] Connection error');
    });
  }
  return client;
}
