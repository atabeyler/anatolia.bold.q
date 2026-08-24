import { queryOffline, synthesizeFromArchive } from './offlineExtractive.js';
import { createModelManager } from './modelManager.js';
import { createLLMQuery } from './llmProvider.js';
import { MODEL_TIERS, selectTierForDevice } from './modelSpec.js';
import { getNativeDeviceInfo } from './llmRuntime.js';

// Mirrors desktop/localAI/registry.js's ordering and seam:
//   1. local-llm         -- real generative inference via a native
//                            Capacitor plugin (LocalLLM, see llmRuntime.js
//                            and mobile/android/app/src/main/java/.../
//                            localllm/LocalLLMPlugin.kt).
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
//
// Device-tiered model selection (task spec point 4): modelManager starts
// pointed at the MID tier (the same model desktop pins, a safe default
// while device RAM is still unknown) and refreshInstalledState() -- which
// mobileBridge.js's mobileAI.modelStatus/modelDownload/modelRemove already
// call -- also re-reads real device RAM via the native plugin and swaps in
// the right tier's ModelManager before any install-state or capability
// check runs. A device the native plugin can't (or doesn't yet) report RAM
// for stays on the MID tier's own capability gate, which fails safe
// (deviceCapability.js's no_ram_signal reason) rather than assuming a tier
// fits.
let modelManager = createModelManager({ spec: MODEL_TIERS.mid });
let installedCache = false;
let deviceInfoCache = null;

export async function refreshInstalledState() {
  deviceInfoCache = await getNativeDeviceInfo();
  const tierSpec = selectTierForDevice(deviceInfoCache) || MODEL_TIERS.mid;
  // Always rebuild against the freshly-read deviceInfo, not only when the
  // tier changes -- the starting modelManager (line 33) is already pinned
  // to the MID tier, so for the (very common) case of a device that also
  // lands on MID, tierSpec.id === modelManager.spec.id and a
  // change-gated rebuild would never run. Gating the rebuild on a tier
  // change meant the real native RAM reading (deviceInfoCache) was NEVER
  // attached to modelManager after the very first construction --
  // checkCapability() always ran with deviceInfo: undefined, which is why
  // Settings > Local AI's device-capacity/RAM field stayed "—" even once
  // getDeviceInfo() itself was working correctly on the native side.
  modelManager = createModelManager({ spec: tierSpec, deviceInfo: { nativeDeviceInfo: deviceInfoCache } });
  installedCache = await modelManager.isModelInstalled();
  return installedCache;
}

export function getModelManager() {
  return modelManager;
}

// Informational only (diagnostics/Settings UI) -- the actual gating always
// goes through modelManager.checkCapability(), never this cache directly.
export function getDeviceInfo() {
  return deviceInfoCache;
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
