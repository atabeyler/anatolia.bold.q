import { queryOffline, synthesizeFromArchive } from './offlineExtractive.js';
import { createModelManager } from './modelManager.js';
import { createLLMQuery } from './llmProvider.js';

// Mirrors desktop/localAI/registry.js's ordering and seam:
//   1. local-llm         -- real generative inference via a native
//                            Capacitor plugin (see llmRuntime.js -- the
//                            plugin itself is a documented follow-up, not
//                            built in this sandbox; see the final report).
//   2. offline-extractive -- unchanged, always available, and the fallback
//                            for a "generate a new analysis" request too
//                            (synthesizeFromArchive).
//
// isModelInstalled() is async (Capacitor's Filesystem API has no sync
// variant), but selectProvider()'s isAvailable() contract must stay
// synchronous to match every other provider -- refreshInstalledState()
// below updates a cached flag; call it once at app start and after any
// Model Manager UI action (install/remove), same pattern
// mobileBridge.js already uses for connectivity state.
const modelManager = createModelManager();
let installedCache = false;

export async function refreshInstalledState() {
  installedCache = await modelManager.isModelInstalled();
  return installedCache;
}

export function getModelManager() {
  return modelManager;
}

const PROVIDERS = [
  {
    capability: 'local-llm',
    isAvailable: () => modelManager.isAvailableSync(installedCache),
    createQuery: (ctx) => createLLMQuery({ ...ctx, modelManager, isInstalled: installedCache }),
  },
  {
    capability: 'offline-extractive',
    isAvailable: () => true,
    createQuery: ({ db, userId }) => (request) => {
      if (request?.mode === 'generate') {
        return synthesizeFromArchive(db, userId, request).then((result) => ({ type: 'archive-synthesis', result }));
      }
      return queryOffline(db, userId, request);
    },
  },
];

export function selectProvider() {
  return PROVIDERS.find((p) => p.isAvailable()) ?? PROVIDERS[PROVIDERS.length - 1];
}

export const _internal = { PROVIDERS };
