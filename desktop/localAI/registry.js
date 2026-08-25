import os from 'node:os';
import path from 'node:path';
import { queryOffline, synthesizeFromArchive } from './offlineExtractive.js';
import { createModelManager } from './modelManager.js';
import { createLLMQuery } from './llmProvider.js';
import { selectTierForDevice } from './modelSpec.js';

// Ordered by preference:
//   1. local-llm    -- real generative inference (Qwen2.5-1.5B-Instruct,
//                       GGUF, via node-llama-cpp). isAvailable() is a cheap
//                       sync "is the model file on disk" check; the
//                       heavier RAM/CPU/disk gate runs per-request inside
//                       llmProvider.js and throws a distinguishable error
//                       if the device turns out unable to run it, which
//                       the Analysis Router (client/src/services/
//                       analysisRouter.js) catches and falls through on.
//   2. offline-extractive -- the original read-only keyword/summary/
//                       compare engine (offlineExtractive.js), unchanged,
//                       always available, and now also the fallback for a
//                       "generate a new analysis" request when local-llm
//                       is unavailable (see synthesizeFromArchive).
//
// provider.js and everything above it (main.js's ai:query IPC handler, the
// renderer) never need to change to pick up a new provider here -- this
// file is the only thing that needs a new entry, per the original seam
// design (see the comment history in provider.js).
let modelsDir = path.join(os.homedir(), '.anatolia-q', 'models');
// Device-tiered model selection (mirrors client/src/mobile/localAI/
// registry.js's own tiering, minus the async native-plugin round-trip).
// Desktop uses both RAM and logical CPU count: fitting 7B in memory is not
// enough if generation would be unusably slow on a low-core machine.
let modelManager = createModelManager({ modelsDir, spec: selectTierForDevice(os.totalmem(), os.cpus().length) });

// Called once from desktop/main.js's startup sequence with Electron's real
// app.getPath('userData')-based path, so the model lives next to the rest
// of this app's user data instead of the ~/.anatolia-q fallback above (that
// fallback exists purely so this module -- and its tests -- work without
// Electron ever being imported here).
export function configureLocalLLM({ modelsDir: dir } = {}) {
  if (dir && dir !== modelsDir) {
    modelsDir = dir;
    modelManager = createModelManager({ modelsDir, spec: selectTierForDevice(os.totalmem(), os.cpus().length) });
  }
  return modelManager;
}

export function getModelManager() {
  return modelManager;
}

const PROVIDERS = [
  {
    capability: 'local-llm',
    isAvailable: () => modelManager.isAvailable(),
    createQuery: (ctx) => createLLMQuery({ ...ctx, modelManager }),
  },
  {
    capability: 'offline-extractive',
    isAvailable: () => true, // no model download or network dependency
    createQuery: ({ db, userId }) => (request) => {
      if (request?.mode === 'generate') {
        return { type: 'archive-synthesis', result: synthesizeFromArchive(db, userId, request) };
      }
      return queryOffline(db, userId, request);
    },
  },
];

export function selectProvider() {
  return PROVIDERS.find((p) => p.isAvailable()) ?? PROVIDERS[PROVIDERS.length - 1];
}

export { PROVIDERS };
