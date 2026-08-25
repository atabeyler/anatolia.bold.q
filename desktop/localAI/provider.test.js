import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createTestDb } from '../testHelpers.js';
import { createLocalAIProvider } from './provider.js';
import { PROVIDERS } from './registry.js';

describe('createLocalAIProvider', () => {
  it('never throws even if the underlying query blows up (spec J: no model/crash safety)', async () => {
    const db = createTestDb();
    db.close(); // force every query against it to fail
    const provider = createLocalAIProvider({ db, userId: 'BOLD-001' });

    const result = await provider.query({ text: 'raporlarımı bul' });
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('answers a normal query successfully', async () => {
    const db = createTestDb();
    db.prepare(`
      INSERT INTO analyses (id, user_id, device_id, version, created_at, updated_at, sync_status, category, title, content)
      VALUES ('a', 'BOLD-001', 'AQ-WIN-TEST', 1, datetime('now'), datetime('now'), 'synced', 'x', 'Rapor', 'içerik')
    `).run();
    const provider = createLocalAIProvider({ db, userId: 'BOLD-001' });

    const result = await provider.query({ text: 'rapor' });
    expect(result.ok).toBe(true);
    expect(result.type).toBe('find');
  });
});

// Full Analysis Router fallback chain, at the registry/provider level:
// local-llm reporting itself available at selection time but then failing
// per-request (the exact scenario llmProvider.js's sentinel error exists
// for) must transparently fall through to offline-extractive within the
// SAME query() call, tagging the response with the engine that actually
// answered -- never silently pretending local-llm answered when it didn't
// (spec point 9), and never crashing (spec point 12: "none available" and
// "local LLM unavailable" are both handled paths, not exceptions).
describe('createLocalAIProvider local-llm -> offline-extractive fallback', () => {
  let originalLocalLLM;

  beforeEach(() => {
    originalLocalLLM = { ...PROVIDERS[0] };
  });

  afterEach(() => {
    Object.assign(PROVIDERS[0], originalLocalLLM);
  });

  it('falls through to offline-extractive when local-llm is selected but the per-request check fails', async () => {
    Object.assign(PROVIDERS[0], {
      isAvailable: () => true, // looked available at selection time
      createQuery: () => async () => { throw new Error('local_llm_unavailable'); },
    });

    const db = createTestDb();
    db.prepare(`
      INSERT INTO analyses (id, user_id, device_id, version, created_at, updated_at, sync_status, category, title, content)
      VALUES ('a', 'BOLD-001', 'AQ-WIN-TEST', 1, datetime('now'), datetime('now'), 'synced', 'x', 'Rapor', 'içerik')
    `).run();
    const provider = createLocalAIProvider({ db, userId: 'BOLD-001' });

    const result = await provider.query({ text: 'rapor' });
    expect(result.ok).toBe(true);
    expect(result.capability).toBe('offline-extractive');
    expect(result.type).toBe('find');
  });

  it('falls through to the archive engine for any local runtime failure', async () => {
    Object.assign(PROVIDERS[0], {
      isAvailable: () => true,
      createQuery: () => async () => { throw new Error('unexpected_crash'); },
    });

    const db = createTestDb();
    const provider = createLocalAIProvider({ db, userId: 'BOLD-001' });

    const result = await provider.query({ text: 'rapor' });
    expect(result.ok).toBe(true);
    expect(result.capability).toBe('offline-extractive');
  });
});
