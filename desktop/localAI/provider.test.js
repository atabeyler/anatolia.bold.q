import { describe, it, expect } from 'vitest';
import { createTestDb } from '../testHelpers.js';
import { createLocalAIProvider } from './provider.js';

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
