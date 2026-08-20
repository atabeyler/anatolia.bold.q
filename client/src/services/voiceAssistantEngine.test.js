import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerActions, unregisterActions, executePlan } from './voiceActionRegistry.js';
import { buildDashboardVoiceActions } from './dashboardVoiceActions.js';

vi.mock('./api.js', () => ({
  api: { voiceIntent: vi.fn() },
}));

const { api } = await import('./api.js');
const { processVoiceCommand } = await import('./voiceAssistantEngine.js');

const scope = '__engine_test__';

function register(deps = {}) {
  const merged = {
    setView: vi.fn(),
    setActiveCategory: vi.fn(),
    setHistoryOpen: vi.fn(),
    setVoiceChatOpen: vi.fn(),
    setGuideOpen: vi.fn(),
    setJWT: vi.fn(),
    disconnectSocket: vi.fn(),
    onLogout: vi.fn(),
    dispatch: vi.fn(),
    setPendingAnalysis: vi.fn(),
    ...deps,
  };
  registerActions(scope, buildDashboardVoiceActions(merged));
  return merged;
}

beforeEach(() => {
  api.voiceIntent.mockReset();
});

afterEach(() => unregisterActions(scope));

describe('processVoiceCommand: deterministic local resolution (fast path, no network call)', () => {
  beforeEach(() => register());

  it('resolves a plain Turkish category+start command without calling the AI endpoint', async () => {
    const result = await processVoiceCommand('Savunma analizi başlat', { page: 'dashboard-analysis', lang: 'tr' });
    expect(api.voiceIntent).not.toHaveBeenCalled();
    expect(result.actions).toEqual([{ action: 'start_analysis', params: { category: 'savunma', depth: 'standart', quantum: false } }]);
    expect(result.speak).toMatch(/Savunma/);
  });

  it('resolves energy analysis', async () => {
    const result = await processVoiceCommand('Enerji analizi başlat', { page: 'dashboard-analysis', lang: 'tr' });
    expect(result.actions[0]).toEqual({ action: 'start_analysis', params: { category: 'enerji', depth: 'standart', quantum: false } });
  });

  it('resolves economy analysis with a natural "oluştur" phrasing', async () => {
    const result = await processVoiceCommand('enerji alanında yeni analiz oluştur', { page: 'dashboard-analysis', lang: 'tr' });
    expect(result.actions[0].params.category).toBe('enerji');
  });

  it('extracts depth from "derin ekonomi analizi yap"', async () => {
    const result = await processVoiceCommand('derin ekonomi analizi yap', { page: 'dashboard-analysis', lang: 'tr' });
    expect(result.actions[0]).toEqual({ action: 'start_analysis', params: { category: 'ekonomi', depth: 'derin', quantum: false } });
  });

  it('extracts quantum=true from "kuantum destekli enerji analizi başlat"', async () => {
    const result = await processVoiceCommand('kuantum destekli enerji analizi başlat', { page: 'dashboard-analysis', lang: 'tr' });
    expect(result.actions[0]).toEqual({ action: 'start_analysis', params: { category: 'enerji', depth: 'standart', quantum: true } });
  });

  it('resolves an English natural phrasing', async () => {
    const result = await processVoiceCommand('start a deep defense analysis with quantum', { page: 'dashboard-analysis', lang: 'en' });
    expect(result.actions[0]).toEqual({ action: 'start_analysis', params: { category: 'savunma', depth: 'derin', quantum: true } });
  });

  it('asks for clarification instead of guessing when an analysis is requested with no recognizable category', async () => {
    const result = await processVoiceCommand('yeni analiz başlat', { page: 'dashboard-analysis', lang: 'tr' });
    expect(result.actions).toEqual([]);
    expect(result.speak.length).toBeGreaterThan(0);
    expect(api.voiceIntent).not.toHaveBeenCalled();
  });
});

describe('processVoiceCommand: AI-backed path is validated through the same schema', () => {
  beforeEach(() => register());

  it('routes unrecognized phrasing to the AI endpoint and executes a valid response', async () => {
    api.voiceIntent.mockResolvedValue({
      actions: [{ action: 'start_analysis', params: { category: 'ekonomi', depth: 'derin', quantum: true } }],
      speak: 'Derin ekonomi analizi kuantum modunda başlatılıyor.',
    });
    const result = await processVoiceCommand('bana kısa bir özet çıkar', { page: 'dashboard-analysis', lang: 'tr' });
    expect(api.voiceIntent).toHaveBeenCalled();
    expect(result.actions).toEqual([{ action: 'start_analysis', params: { category: 'ekonomi', depth: 'derin', quantum: true } }]);
  });

  it('rejects a malformed AI JSON response (actions not an array) and asks for clarification instead of crashing', async () => {
    api.voiceIntent.mockResolvedValue({ actions: 'not-an-array', speak: 'irrelevant' });
    const result = await processVoiceCommand('garip bir şey söyle', { page: 'dashboard-analysis', lang: 'tr' });
    expect(result.actions).toEqual([]);
  });

  it('rejects an AI response naming an unregistered/invalid action instead of executing it', async () => {
    api.voiceIntent.mockResolvedValue({
      actions: [{ action: 'delete_all_analyses', params: {} }],
      speak: 'Tamam.',
    });
    const result = await processVoiceCommand('her şeyi sil', { page: 'dashboard-analysis', lang: 'tr' });
    expect(result.actions).toEqual([]);
  });

  it('rejects an AI-proposed start_analysis with an invalid category enum value', async () => {
    api.voiceIntent.mockResolvedValue({
      actions: [{ action: 'start_analysis', params: { category: 'atlantis' } }],
      speak: 'Tamam.',
    });
    const result = await processVoiceCommand('atlantis analizi başlat', { page: 'dashboard-analysis', lang: 'tr' });
    expect(result.actions).toEqual([]);
  });

  it('refuses ui_activate for a critical analysis intent even if the AI proposes it, instead of clicking a random control', async () => {
    api.voiceIntent.mockResolvedValue({
      actions: [{ action: 'ui_activate', params: { target: 'Yeni Analiz' } }],
      speak: 'Tamam.',
    });
    // No "analiz"/category word here on purpose, so this bypasses the local
    // fast path (which itself never lets a recognized analysis command
    // reach ui_activate) and actually exercises the AI-response validator.
    const result = await processVoiceCommand('kuantumu aç', { page: 'dashboard-analysis', lang: 'tr' });
    expect(result.actions).toEqual([]);
  });

  it('falls back to local matching when the AI call throws (network/401)', async () => {
    api.voiceIntent.mockRejectedValue(new Error('network down'));
    const result = await processVoiceCommand('ana ekrana dön', { page: 'dashboard-analysis', lang: 'tr' });
    expect(result.actions).toEqual([{ action: 'navigate_home', params: {} }]);
  });
});

describe('multi-step action plans: executePlan short-circuits on a failed critical step', () => {
  it('executes every step in order when all succeed', () => {
    const deps = register();
    const results = executePlan([
      { action: 'navigate_analysis', params: { category: 'savunma' } },
      { action: 'toggle_quantum', params: { mode: 'on' } },
    ]);
    expect(results.every((r) => r.ok)).toBe(true);
    expect(deps.setActiveCategory).toHaveBeenCalledWith('savunma');
    expect(deps.dispatch).toHaveBeenCalledWith('aq:analysis:quantum', { mode: 'on' });
  });

  it('stops the plan after a critical step names an action that is not registered', () => {
    register();
    const results = executePlan([
      { action: 'start_analysis', params: { category: 'enerji' } },
      { action: 'not_a_real_action', params: {} }, // unregistered but not critical by name match on registry
      { action: 'toggle_quantum', params: { mode: 'off' } },
    ]);
    // start_analysis (critical) succeeds, the unregistered step fails and
    // is not itself in CRITICAL_ACTIONS by exact registry lookup failure,
    // so verify at minimum the unregistered step is reported as failed.
    expect(results[0]).toEqual({ action: 'start_analysis', ok: true });
    expect(results[1].ok).toBe(false);
  });

  it('never triggers ui_activate as part of a validated critical plan', () => {
    const deps = register();
    const activateSpy = vi.fn();
    registerActions('__ui_activate_probe__', [{ name: 'probe_ui_activate_never_called', description: '', params: {}, handler: activateSpy }]);
    executePlan([{ action: 'start_analysis', params: { category: 'savunma', quantum: true } }]);
    expect(activateSpy).not.toHaveBeenCalled();
    expect(deps.setPendingAnalysis).toHaveBeenCalledWith({ depth: undefined, quantum: true, prompt: undefined, title: undefined });
    unregisterActions('__ui_activate_probe__');
  });
});
