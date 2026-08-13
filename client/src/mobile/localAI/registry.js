import { queryOffline } from './offlineExtractive.js';

// Ordered by preference. A future local model provider would be inserted
// BEFORE offlineExtractive here as { capability, isAvailable, createQuery }
// -- isAvailable() reports whether it's actually usable on this device, so
// selectProvider() automatically falls back to offlineExtractive when it
// isn't. provider.js and everything above it never need to change to pick
// up a new provider here -- this file is the only thing that needs a new
// entry. Mirrors desktop/localAI/registry.js.
//
// No model/binary is bundled at this stage (out of scope per the current
// task) -- this registry only prepares the seam for one.
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
