import { queryOffline } from './offlineExtractive.js';

// Ordered by preference. A future local LLM provider (e.g. via
// node-llama-cpp) would be inserted BEFORE offlineExtractive here as
// { capability: 'local-llm', isAvailable, createQuery } -- isAvailable()
// reports whether a model is actually downloaded/loadable on this machine,
// so selectProvider() automatically falls back to offlineExtractive when
// it isn't (no model yet, insufficient hardware, load failure, ...).
// provider.js and everything above it (main.js's ai:query IPC handler,
// the renderer) never need to change to pick up a new provider here --
// this file is the only thing that needs a new entry.
//
// No LLM model/binary is bundled at this stage (out of scope per the
// current task) -- this registry only prepares the seam for one.
const PROVIDERS = [
  {
    capability: 'offline-extractive',
    isAvailable: () => true, // no model download or network dependency
    createQuery: ({ db, userId }) => (request) => queryOffline(db, userId, request),
  },
];

export function selectProvider() {
  return PROVIDERS.find((p) => p.isAvailable()) ?? PROVIDERS[PROVIDERS.length - 1];
}
