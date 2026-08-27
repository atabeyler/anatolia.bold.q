import { describe, it, expect, vi } from 'vitest';
import { createTestDb } from '../testHelpers.js';
import { createLLMQuery } from './llmProvider.js';

function seedReport(db, { id = 'r1', title = 'Ekim Ayı Bütçe Raporu', category = 'finans', content = 'Toplam gider 120000 TL oldu.' } = {}) {
  db.prepare(`
    INSERT INTO analyses (id, user_id, device_id, version, created_at, updated_at, sync_status, category, title, content)
    VALUES (?, 'BOLD-001', 'AQ-WIN-TEST', 1, datetime('now'), datetime('now'), 'synced', ?, ?, ?)
  `).run(id, category, title, content);
}

function fakeModelManager({ available = true, verifyChecksum = async () => ({ ok: true }), spec = { contextSize: 4096 } } = {}) {
  return { isAvailable: () => available, modelPath: '/fake/model.gguf', spec, verifyChecksum };
}

describe('createLLMQuery', () => {
  it('throws local_llm_unavailable when the model manager says the device/model is not ready', async () => {
    const db = createTestDb();
    const run = createLLMQuery({ db, userId: 'BOLD-001', modelManager: fakeModelManager({ available: false }) });
    await expect(run({ mode: 'chat', text: 'merhaba' })).rejects.toThrow('local_llm_unavailable');
  });

  it('answers a chat request with a generated prose answer citing retrieved reports', async () => {
    const db = createTestDb();
    seedReport(db);
    const generate = vi.fn(async (prompt) => `Cevap: ${prompt.includes('120000') ? 'gider bilgisi bulundu' : 'bulunamadı'}`);
    const runtimeFactory = vi.fn(async () => ({ generate }));

    const run = createLLMQuery({ db, userId: 'BOLD-001', modelManager: fakeModelManager(), runtimeFactory });
    const result = await run({ mode: 'chat', text: 'ekim ayı giderleri' });

    expect(result.type).toBe('generated');
    expect(result.text).toContain('gider bilgisi bulundu');
    expect(result.sources).toEqual([{ id: 'r1', title: 'Ekim Ayı Bütçe Raporu' }]);
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('answers a generate request with a structured analysis result', async () => {
    const db = createTestDb();
    seedReport(db);
    const generate = vi.fn(async (fullPrompt) => {
      expect(fullPrompt).toContain('## Yönetici Özeti');
      expect(fullPrompt).toContain('## Mali Riskler');
      return '# Analiz\n\nİçerik burada.';
    });
    const runtimeFactory = vi.fn(async () => ({ generate }));

    const run = createLLMQuery({ db, userId: 'BOLD-001', modelManager: fakeModelManager(), runtimeFactory });
    const result = await run({ mode: 'generate', category: 'finans', title: 'Kasım Tahmini', prompt: 'kasım ayı bütçesini tahmin et' });

    expect(result.type).toBe('analysis');
    expect(result.result.title).toBe('Kasım Tahmini');
    expect(result.result.content).toContain('İçerik burada');
  });

  it('uses the toplumsal report skeleton and keeps other-category archive context out of generation', async () => {
    const db = createTestDb();
    seedReport(db, {
      id: 'finance-old',
      category: 'finans',
      title: 'Banka Optimizasyon Raporu',
      content: 'Hedef Banka ve kaynak tahsisi optimizasyonu.',
    });
    seedReport(db, {
      id: 'social-old',
      category: 'toplumsal',
      title: 'Mahalle Gerginliği',
      content: 'Yerel gerilim ve kolluk koordinasyonu.',
    });
    const generate = vi.fn(async (fullPrompt) => {
      expect(fullPrompt).toContain('## Nefret Söylemi ve Ayrımcılık Riski');
      expect(fullPrompt).toContain('Kürt işçilere saldırı');
      expect(fullPrompt).not.toContain('Mahalle Gerginliği');
      expect(fullPrompt).not.toContain('Hedef Banka');
      expect(fullPrompt).not.toContain('optimizasyonu');
      return 'OPTİMİZASYON PROBLEMİ\nBütçe: %60\n\n## Yönetici Özeti\nToplumsal analiz üretildi.';
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
    expect(result.result.content).toMatch(/^## Yönetici Özeti/);
    expect(result.result.content).not.toContain('OPTİMİZASYON PROBLEMİ');
    expect(result.result.sources).toEqual([]);
  });

  it('still generates a fresh analysis when there is no matching archive context', async () => {
    const db = createTestDb();
    let systemPromptSeen = '';
    const generate = vi.fn(async (fullPrompt) => {
      expect(fullPrompt).toContain('ilgili geçmiş rapor bulunamadı');
      expect(fullPrompt).toContain('deniz sınırında çatışma');
      return '# Yeni Analiz\n\nGeçmiş rapor olmadan yeni taslak üretildi.';
    });
    const runtimeFactory = vi.fn(async ({ systemPrompt }) => {
      systemPromptSeen = systemPrompt;
      return { generate };
    });

    const run = createLLMQuery({ db, userId: 'BOLD-001', modelManager: fakeModelManager(), runtimeFactory });
    const result = await run({
      mode: 'generate',
      category: 'jeopolitik',
      title: 'Deniz Sınırı Çatışma Analizi',
      prompt: 'deniz sınırında çatışma',
    });

    expect(generate).toHaveBeenCalledTimes(1);
    expect(result.type).toBe('analysis');
    expect(result.result.sources).toEqual([]);
    expect(result.result.content).toContain('yeni taslak');
    expect(systemPromptSeen).toContain('yerel bağlam boş olsa bile');
    expect(systemPromptSeen).not.toContain('Yalnızca sana verilen bağlama dayan');
  });

  it('reuses one loaded runtime across multiple calls instead of reloading the model each time', async () => {
    const db = createTestDb();
    const generate = vi.fn(async () => 'ok');
    const runtimeFactory = vi.fn(async () => ({ generate }));
    const run = createLLMQuery({ db, userId: 'BOLD-001', modelManager: fakeModelManager(), runtimeFactory });

    await run({ mode: 'chat', text: 'bir' });
    await run({ mode: 'chat', text: 'iki' });

    expect(runtimeFactory).toHaveBeenCalledTimes(1);
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it('dispose() releases the runtime and a subsequent call reloads it', async () => {
    const db = createTestDb();
    const dispose = vi.fn(async () => {});
    const generate = vi.fn(async () => 'ok');
    const runtimeFactory = vi.fn(async () => ({ generate, dispose }));
    const run = createLLMQuery({ db, userId: 'BOLD-001', modelManager: fakeModelManager(), runtimeFactory });

    await run({ mode: 'chat', text: 'bir' });
    await run.dispose();
    expect(dispose).toHaveBeenCalledTimes(1);

    await run({ mode: 'chat', text: 'iki' });
    expect(runtimeFactory).toHaveBeenCalledTimes(2);
  });

  it('re-verifies the model file checksum on every fresh load (AQ: not just at download time)', async () => {
    const db = createTestDb();
    const generate = vi.fn(async () => 'ok');
    const runtimeFactory = vi.fn(async () => ({ generate }));
    const verifyChecksum = vi.fn(async () => ({ ok: true }));
    const run = createLLMQuery({ db, userId: 'BOLD-001', modelManager: fakeModelManager({ verifyChecksum }), runtimeFactory });

    await run({ mode: 'chat', text: 'bir' });
    expect(verifyChecksum).toHaveBeenCalledTimes(1);
    expect(runtimeFactory).toHaveBeenCalledTimes(1);
  });

  it('refuses to load a model file whose checksum no longer matches (swapped/corrupted file)', async () => {
    const db = createTestDb();
    const runtimeFactory = vi.fn(async () => ({ generate: vi.fn() }));
    const verifyChecksum = vi.fn(async () => ({ ok: false, expected: 'aaa', actual: 'bbb' }));
    const run = createLLMQuery({ db, userId: 'BOLD-001', modelManager: fakeModelManager({ verifyChecksum }), runtimeFactory });

    await expect(run({ mode: 'chat', text: 'merhaba' })).rejects.toThrow('local_llm_integrity_check_failed');
    expect(runtimeFactory).not.toHaveBeenCalled();
  });

  it('does not permanently cache a failed load -- a later call can succeed once the file is valid again', async () => {
    const db = createTestDb();
    const generate = vi.fn(async () => 'ok');
    const runtimeFactory = vi.fn(async () => ({ generate }));
    let ok = false;
    const verifyChecksum = vi.fn(async () => ({ ok }));
    const run = createLLMQuery({ db, userId: 'BOLD-001', modelManager: fakeModelManager({ verifyChecksum }), runtimeFactory });

    await expect(run({ mode: 'chat', text: 'once' })).rejects.toThrow('local_llm_integrity_check_failed');

    ok = true;
    const result = await run({ mode: 'chat', text: 'tekrar' });
    expect(result.type).toBe('generated');
    expect(runtimeFactory).toHaveBeenCalledTimes(1);
  });

  it('times out a stalled low-tier generation instead of waiting forever', async () => {
    vi.useFakeTimers();
    try {
      const db = createTestDb();
      const generate = vi.fn(() => new Promise(() => {}));
      const dispose = vi.fn(async () => {});
      const runtimeFactory = vi.fn(async () => ({ generate, dispose }));
      const run = createLLMQuery({
        db,
        userId: 'BOLD-001',
        modelManager: fakeModelManager({ spec: { tier: 'low', contextSize: 1536 } }),
        runtimeFactory,
      });

      const pending = expect(run({ mode: 'chat', text: 'savunma testi' })).rejects.toThrow('local_llm_timeout');
      await vi.advanceTimersByTimeAsync(35_000);
      await pending;
      expect(dispose).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
