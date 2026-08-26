import { describe, it, expect, vi } from 'vitest';
import { createTestMobileDb } from '../testHelpers.js';
import { dbRun } from '../db/index.js';
import { createLLMQuery } from './llmProvider.js';

async function seedReport(db, { id = 'r1', title = 'Ekim Ayı Bütçe Raporu', category = 'finans', content = 'Toplam gider 120000 TL oldu.' } = {}) {
  await dbRun(db, `
    INSERT INTO analyses (id, user_id, device_id, version, created_at, updated_at, sync_status, category, title, content)
    VALUES (?, 'BOLD-001', 'AQ-AND-TEST', 1, datetime('now'), datetime('now'), 'synced', ?, ?, ?)
  `, [id, category, title, content]);
}

function fakeModelManager({ available = true } = {}) {
  return { isAvailableSync: () => available, spec: { filename: 'fake.gguf', contextSize: 2048 } };
}

describe('mobile createLLMQuery', () => {
  it('throws local_llm_unavailable when the device/model gate fails', async () => {
    const db = await createTestMobileDb();
    const run = createLLMQuery({ db, userId: 'BOLD-001', modelManager: fakeModelManager({ available: false }) });
    await expect(run({ mode: 'chat', text: 'merhaba' })).rejects.toThrow('local_llm_unavailable');
  });

  it('answers a chat request with a generated prose answer citing retrieved reports', async () => {
    const db = await createTestMobileDb();
    await seedReport(db);
    const generate = vi.fn(async () => 'gider bilgisi bulundu');
    const runtimeFactory = vi.fn(async () => ({ generate }));

    const run = createLLMQuery({ db, userId: 'BOLD-001', modelManager: fakeModelManager(), runtimeFactory });
    const result = await run({ mode: 'chat', text: 'ekim ayı giderleri' });

    expect(result.type).toBe('generated');
    expect(result.text).toBe('gider bilgisi bulundu');
    expect(result.sources).toEqual([{ id: 'r1', title: 'Ekim Ayı Bütçe Raporu' }]);
  });

  it('answers a generate request with a structured analysis result', async () => {
    const db = await createTestMobileDb();
    await seedReport(db);
    const generate = vi.fn(async (fullPrompt) => {
      expect(fullPrompt).toContain('## Yönetici Özeti');
      expect(fullPrompt).toContain('## Mali Riskler');
      return 'Analiz içeriği.';
    });
    const runtimeFactory = vi.fn(async () => ({ generate }));

    const run = createLLMQuery({ db, userId: 'BOLD-001', modelManager: fakeModelManager(), runtimeFactory });
    const result = await run({ mode: 'generate', category: 'finans', title: 'Kasım Tahmini', prompt: 'kasım bütçesi' });

    expect(result.type).toBe('analysis');
    expect(result.result.title).toBe('Kasım Tahmini');
    expect(result.result.content).toBe('Analiz içeriği.');
  });

  it('uses the toplumsal report skeleton and keeps other-category archive context out of generation', async () => {
    const db = await createTestMobileDb();
    await seedReport(db, {
      id: 'finance-old',
      category: 'finans',
      title: 'Banka Optimizasyon Raporu',
      content: 'Hedef Banka ve kaynak tahsisi optimizasyonu.',
    });
    await seedReport(db, {
      id: 'social-old',
      category: 'toplumsal',
      title: 'Mahalle Gerginliği',
      content: 'Yerel gerilim ve kolluk koordinasyonu.',
    });
    const generate = vi.fn(async (fullPrompt) => {
      expect(fullPrompt).toContain('## Nefret Söylemi ve Ayrımcılık Riski');
      expect(fullPrompt).toContain('Kürt işçilere saldırı');
      expect(fullPrompt).toContain('Mahalle Gerginliği');
      expect(fullPrompt).not.toContain('Hedef Banka');
      expect(fullPrompt).not.toContain('optimizasyonu');
      return 'Toplumsal analiz üretildi.';
    });
    const runtimeFactory = vi.fn(async () => ({ generate }));

    const run = createLLMQuery({ db, userId: 'BOLD-001', modelManager: fakeModelManager(), runtimeFactory });
    const result = await run({
      mode: 'generate',
      category: 'toplumsal',
      title: 'ırkçılık',
      prompt: 'Kürt işçilere saldırı ve kolluk koordinasyonu',
    });

    expect(result.type).toBe('analysis');
    expect(result.result.sources).toEqual([{ id: 'social-old', title: 'Mahalle Gerginliği' }]);
  });

  it('surfaces the native-plugin-missing error from llmRuntime.js as a thrown error (never crashes)', async () => {
    const db = await createTestMobileDb();
    const { createLlamaRuntime } = await import('./llmRuntime.js');
    const run = createLLMQuery({ db, userId: 'BOLD-001', modelManager: fakeModelManager(), runtimeFactory: createLlamaRuntime });
    await expect(run({ mode: 'chat', text: 'merhaba' })).rejects.toThrow('android_native_llm_plugin_missing');
  });

  it('caps oversized chat/generate input before it reaches the runtime (resource-safety context cap)', async () => {
    const db = await createTestMobileDb();
    const generate = vi.fn(async () => 'ok');
    const runtimeFactory = vi.fn(async () => ({ generate }));
    const run = createLLMQuery({ db, userId: 'BOLD-001', modelManager: fakeModelManager(), runtimeFactory });

    const huge = 'x'.repeat(10000);
    await run({ mode: 'chat', text: huge });

    const [promptSent] = generate.mock.calls[0];
    // The huge input must have been truncated well below its original
    // length before being folded into the final prompt sent to the runtime.
    expect(promptSent.length).toBeLessThan(huge.length);
  });
});
