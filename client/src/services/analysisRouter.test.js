import { describe, it, expect, vi } from 'vitest';
import { routeAnalysisGeneration, routeConsultChat, AllEnginesUnavailableError, ENGINE } from './analysisRouter.js';

// Full priority-chain coverage for the Analysis Router (task spec point 4):
//   1. Cloud reachable       -> Q CLOUD
//   2. Cloud unreachable     -> Q LOCAL LLM
//   3. Local LLM unavailable -> Q LOCAL DATA (existing extractive engine)
//   4. Nothing available     -> a clear, honest error
describe('routeAnalysisGeneration', () => {
  it('1. uses the cloud call when online, tagging the result ENGINE.CLOUD', async () => {
    const cloudCall = vi.fn(async () => ({ title: 'Rapor', content: 'İçerik', provider: 'Claude (Anthropic)' }));
    const nativeAIQuery = vi.fn();

    const result = await routeAnalysisGeneration({ isOffline: false, cloudCall, nativeAIQuery, generateRequest: {} });

    expect(result.engine).toBe(ENGINE.CLOUD);
    expect(result.content).toBe('İçerik');
    expect(nativeAIQuery).not.toHaveBeenCalled();
  });

  it('2. routes to the local LLM when offline and it answers', async () => {
    const cloudCall = vi.fn();
    const nativeAIQuery = vi.fn(async (req) => {
      expect(req.mode).toBe('generate');
      return { ok: true, capability: 'local-llm', type: 'analysis', result: { title: 'Taslak', content: 'Yerel içerik', sources: [] } };
    });

    const result = await routeAnalysisGeneration({ isOffline: true, cloudCall, nativeAIQuery, generateRequest: { category: 'finans', prompt: 'x' } });

    expect(result.engine).toBe(ENGINE.LOCAL_LLM);
    expect(result.content).toBe('Yerel içerik');
    expect(cloudCall).not.toHaveBeenCalled();
  });

  it('3. falls through to Q LOCAL DATA when the local-llm provider is unavailable (offline-extractive answered instead)', async () => {
    const nativeAIQuery = vi.fn(async () => ({
      ok: true,
      capability: 'offline-extractive',
      type: 'archive-synthesis',
      result: { generated: false, matches: [{ id: 'a', title: 'Rapor A', category: 'finans', createdAt: new Date().toISOString(), summary: 'özet' }], note: 'not generated' },
    }));

    const result = await routeAnalysisGeneration({ isOffline: true, cloudCall: vi.fn(), nativeAIQuery, generateRequest: {} });

    expect(result.engine).toBe(ENGINE.LOCAL_DATA);
    expect(result.content).toContain('Rapor A');
  });

  it('4. throws AllEnginesUnavailableError when nothing can answer', async () => {
    const nativeAIQuery = vi.fn(async () => ({ ok: false, error: 'no model' }));
    await expect(routeAnalysisGeneration({ isOffline: true, cloudCall: vi.fn(), nativeAIQuery, generateRequest: {} }))
      .rejects.toBeInstanceOf(AllEnginesUnavailableError);
  });

  it('4b. throws AllEnginesUnavailableError when offline with no native bridge at all (plain web build)', async () => {
    await expect(routeAnalysisGeneration({ isOffline: true, cloudCall: vi.fn(), nativeAIQuery: undefined, generateRequest: {} }))
      .rejects.toBeInstanceOf(AllEnginesUnavailableError);
  });

  it('propagates a real cloud error unchanged when online (no silent local fallback for a cloud-side failure)', async () => {
    const cloudCall = vi.fn(async () => { throw new Error('cloud boom'); });
    await expect(routeAnalysisGeneration({ isOffline: false, cloudCall, nativeAIQuery: vi.fn(), generateRequest: {} }))
      .rejects.toThrow('cloud boom');
  });
});

describe('routeConsultChat', () => {
  it('cloud path returns ENGINE.CLOUD with the provider label', async () => {
    const cloudCall = vi.fn(async () => ({ content: 'cevap', provider: 'Claude (Anthropic)' }));
    const result = await routeConsultChat({ isOffline: false, cloudCall, nativeAIQuery: vi.fn(), chatText: 'soru' });
    expect(result.engine).toBe(ENGINE.CLOUD);
    expect(result.providerLabel).toBe('Claude (Anthropic)');
  });

  it('offline generative answer is tagged ENGINE.LOCAL_LLM', async () => {
    const nativeAIQuery = vi.fn(async () => ({ ok: true, capability: 'local-llm', type: 'generated', text: 'cevap', sources: [] }));
    const result = await routeConsultChat({ isOffline: true, cloudCall: vi.fn(), nativeAIQuery, chatText: 'soru' });
    expect(result.engine).toBe(ENGINE.LOCAL_LLM);
    expect(result.content).toBe('cevap');
  });

  it('offline structured (find/summary/compare) answer is tagged ENGINE.LOCAL_DATA', async () => {
    const nativeAIQuery = vi.fn(async () => ({ ok: true, capability: 'offline-extractive', type: 'find', result: [] }));
    const result = await routeConsultChat({ isOffline: true, cloudCall: vi.fn(), nativeAIQuery, chatText: 'soru' });
    expect(result.engine).toBe(ENGINE.LOCAL_DATA);
    expect(result.structured).toEqual({ type: 'find', result: [] });
  });

  it('throws AllEnginesUnavailableError when the local provider reports failure', async () => {
    const nativeAIQuery = vi.fn(async () => ({ ok: false, error: 'kullanılamıyor' }));
    await expect(routeConsultChat({ isOffline: true, cloudCall: vi.fn(), nativeAIQuery, chatText: 'soru' }))
      .rejects.toBeInstanceOf(AllEnginesUnavailableError);
  });
});
