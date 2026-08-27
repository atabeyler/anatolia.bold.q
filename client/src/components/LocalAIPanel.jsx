import React, { useEffect, useState } from 'react';
import { Cpu, Download, Trash2, CircleCheck, CircleAlert } from 'lucide-react';
import { isNativeApp, nativeAI } from '../services/nativeBridge.js';
import { isLocalModeForced, setLocalModeForced, subscribeLocalModePreference } from '../services/localModePreference.js';

// Human-readable byte formatting for RAM/disk/model-size figures shown in
// this panel -- no existing shared helper for this in the codebase (checked),
// so it's local and intentionally simple (GB with one decimal, MB below 1 GB).
function formatBytes(bytes) {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return '—';
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

// Settings > Local AI: model-manager UI for the local LLM (task: Local
// Model Manager). Desktop (Electron, via desktop/localAI/modelManager.js +
// desktop/main.js's ai:model* IPC handlers) and Android (Capacitor, via
// client/src/mobile/localAI/) share the exact same nativeAI surface (see
// services/nativeBridge.js), so this one component drives both -- desktop
// is the tested path (see LocalAIPanel.test.jsx); the Android path reuses
// mobileBridge.js's already-implemented/tested ai.model* methods but this
// specific UI has not been exercised against a real Capacitor/Android
// runtime in this session (documented in the final report).
//
// The shared local-mode preference renders everywhere so browser, Android,
// and desktop expose the same Settings affordance. Plain web still cannot
// download/run the native model, so the model-manager controls remain native
// only.
//
// This is UI-only: it never touches modelManager.js's download/checksum/
// gating logic, only calls the existing IPC/bridge surface.
export default function LocalAIPanel({ t }) {
  const [status, setStatus] = useState(null); // null = loading
  const [error, setError] = useState('');
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState(null);
  const [removing, setRemoving] = useState(false);
  const [tiers, setTiers] = useState([]);
  const [selectingTier, setSelectingTier] = useState(false);
  const [forceLocalMode, setForceLocalModeState] = useState(() => isLocalModeForced());

  const refresh = () => {
    if (!isNativeApp) return;
    nativeAI.modelStatus().then((s) => setStatus(s || {})).catch((e) => setError(e?.message || ''));
  };

  useEffect(() => { refresh(); }, []);

  // Loaded once -- the pinned tier list itself never changes at runtime,
  // only which one is currently selected (status.spec, refreshed above).
  useEffect(() => {
    if (!isNativeApp) return;
    // Promise.resolve(...) rather than a bare `?.().then(...)` chain: the
    // underlying bridge call itself can synchronously return undefined
    // (an older/mocked bridge without this method), not just be missing
    // outright, and undefined.then would throw before .catch could ever
    // attach to it.
    Promise.resolve(nativeAI.modelTiers?.()).then((list) => setTiers(list || [])).catch(() => {});
  }, []);

  useEffect(() => subscribeLocalModePreference(setForceLocalModeState), []);

  const toggleLocalMode = () => {
    const next = setLocalModeForced(!forceLocalMode);
    setForceLocalModeState(next);
  };

  // Desktop reports download progress via a separate IPC event (see
  // desktop/preload.cjs's onModelDownloadProgress); Android's bridge takes
  // an onProgress callback directly in modelDownload() below instead (see
  // mobileBridge.js). Subscribing to both here costs nothing on whichever
  // platform doesn't use this path -- desktopAI/mobileAI's `bridge?.`-style
  // guards make the unused one a safe no-op.
  useEffect(() => {
    if (!isNativeApp) return undefined;
    // Android's bridge doesn't expose this listener (progress arrives via
    // the direct callback passed to modelDownload() instead) -- optional
    // so this stays a safe no-op there rather than throwing.
    return nativeAI.onModelDownloadProgress?.(setProgress) || (() => {});
  }, []);

  const handleDownload = async () => {
    setError('');
    setDownloading(true);
    setProgress(null);
    try {
      const result = await nativeAI.modelDownload(setProgress);
      if (result && result.ok === false) {
        setError(result.error || t('localAIDownloadFailed'));
      } else {
        refresh();
      }
    } catch (e) {
      setError(e?.message || t('localAIDownloadFailed'));
    } finally {
      setDownloading(false);
      setProgress(null);
    }
  };

  // Repoints the backend's modelManager at a different pinned tier --
  // never downloads or deletes a file itself (see registry.js's
  // setModelTier comment). Only offered while no model is installed (see
  // the render below), so this always leaves the panel showing the normal
  // Download button next, now pointed at the newly-selected tier's spec.
  const handleSelectTier = async (tier) => {
    setError('');
    setSelectingTier(true);
    try {
      const result = await nativeAI.modelSelectTier(tier);
      if (result && result.ok === false) {
        setError(result.error || t('localAITierSelectFailed'));
      } else {
        refresh();
      }
    } catch (e) {
      setError(e?.message || t('localAITierSelectFailed'));
    } finally {
      setSelectingTier(false);
    }
  };

  const handleRemove = async () => {
    setError('');
    setRemoving(true);
    try {
      await nativeAI.modelRemove();
      refresh();
    } catch (e) {
      setError(e?.message || t('localAIRemoveFailed'));
    } finally {
      setRemoving(false);
    }
  };

  const spec = status?.spec;
  const installed = !!status?.installed;
  const capability = status?.capability;
  const capable = capability ? capability.capable !== false : null;
  const partialBytes = Number(status?.partialBytes) || 0;

  return (
    <div>
      <div className="border border-cyan-300/20 rounded px-2.5 py-2.5 mb-3">
        <button
          onClick={toggleLocalMode}
          className="w-full flex items-center justify-between gap-3 text-left text-[14px] text-cyan-100"
          aria-pressed={forceLocalMode}
        >
          <span>
            <span className="block tracking-[0.16em] uppercase text-gold/70">{t('localAIModeTitle')}</span>
            <span className="block text-[14px] text-cyan-100/60 mt-1">{t(isNativeApp ? 'localAIModeNativeHint' : 'localAIModeWebHint')}</span>
          </span>
          <span className={`shrink-0 rounded border px-2 py-1 text-[11px] tracking-[0.18em] uppercase ${forceLocalMode ? 'border-emerald-300/40 text-emerald-200 bg-emerald-400/10' : 'border-cyan-300/20 text-cyan-100/50'}`}>
            {forceLocalMode ? t('localAIModeOn') : t('localAIModeOff')}
          </span>
        </button>
      </div>

      {!isNativeApp && <p className="text-xs text-gold/60 leading-relaxed mb-3">{t('localAIWebUnavailable')}</p>}

      {isNativeApp && (
        <>
      <p className="text-xs text-gold/60 leading-relaxed mb-3">{t('localAIIntro')}</p>

      {status === null && <p className="text-xs text-cyan-100/50">{t('localAIChecking')}</p>}

      {status !== null && (
        <div className="border border-cyan-300/20 rounded px-2.5 py-2.5 mb-3">
          <div className="flex items-center gap-2">
            {installed ? <CircleCheck className="w-4 h-4 text-emerald-300/80 shrink-0" /> : <CircleAlert className="w-4 h-4 text-amber-300/80 shrink-0" />}
            <span className="text-xs text-cyan-100">{installed ? t('localAIInstalled') : t('localAINotInstalled')}</span>
          </div>
          {spec && <div className="text-[14px] text-cyan-300/50 pl-6 mt-0.5">{spec.displayLabel || spec.label} · {formatBytes(spec.sizeBytes)}</div>}
          {!installed && partialBytes > 0 && spec && (
            <div className="text-[14px] text-amber-300/70 pl-6 mt-1">{t('localAIPartialDownload')}: {formatBytes(partialBytes)} / {formatBytes(spec.sizeBytes)}</div>
          )}
        </div>
      )}

      {capability && (
        <div className="border border-cyan-300/20 rounded px-2.5 py-2.5 mb-3">
          <div className="text-xs tracking-[0.18em] uppercase text-gold/60 mb-1.5 flex items-center gap-1.5">
            <Cpu className="w-3.5 h-3.5" />{t('localAIDeviceInfo')}
          </div>
          <div className="text-[14px] text-cyan-100/70 space-y-0.5">
            <div>{t('localAIRamLabel')}: {formatBytes(capability.totalMemBytes)}</div>
            {typeof capability.freeDiskBytes === 'number' && <div>{t('localAIDiskLabel')}: {formatBytes(capability.freeDiskBytes)}</div>}
            {typeof capability.cpuCount === 'number' && <div>{t('localAICpuLabel')}: {capability.cpuCount}</div>}
          </div>
          {capable === false && <p className="text-[14px] text-amber-300/80 mt-1.5 leading-relaxed">{t('localAINotCapable')}</p>}
        </div>
      )}

      {error && <p className="text-[14px] text-red-300 mb-2 leading-relaxed">{error}</p>}

      {downloading && (
        <p className="text-[14px] text-cyan-300/70 mb-2">
          {progress && progress.total ? `${t('localAIDownloading')} (${formatBytes(progress.received)} / ${formatBytes(progress.total)})` : t('localAIDownloading')}
        </p>
      )}

      {/* Only offered while nothing is installed -- switching tiers with a
          model already on disk would leave the old file orphaned (see
          registry.js's setModelTier comment); the user removes the current
          model first, which naturally lands here to pick the next one. */}
      {!installed && tiers.length > 0 && (
        <div className="border border-cyan-300/20 rounded px-2.5 py-2.5 mb-3">
          <div className="text-xs tracking-[0.18em] uppercase text-gold/60 mb-1.5">{t('localAITierPickerTitle')}</div>
          <div className="space-y-1.5">
            {tiers.map((tier) => {
              const selected = spec?.id === tier.id;
              return (
                <button
                  key={tier.tier}
                  onClick={() => handleSelectTier(tier.tier)}
                  disabled={selectingTier || downloading}
                  aria-pressed={selected}
                  className={`w-full flex items-center justify-between gap-2 text-left text-[14px] rounded border px-2.5 py-2 disabled:opacity-40 ${
                    selected ? 'border-cyan-300/50 text-cyan-100 bg-cyan-400/10' : 'border-cyan-300/20 text-cyan-100/70'
                  }`}
                >
                  <span>{tier.displayLabel || tier.label}</span>
                  <span className="text-[14px] text-cyan-300/50 shrink-0">{formatBytes(tier.sizeBytes)}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="space-y-2">
        {!installed && (
          <button
            onClick={handleDownload}
            disabled={downloading}
            className="w-full flex items-center justify-center gap-2 text-[14px] border border-cyan-300/30 text-cyan-100 rounded px-2.5 py-2 disabled:opacity-40"
          >
            <Download className="w-4 h-4" />
            {downloading ? t('localAIDownloading') : partialBytes > 0 ? t('localAIResumeButton') : t('localAIDownloadButton')}
          </button>
        )}
        {installed && (
          <button
            onClick={handleRemove}
            disabled={removing}
            className="w-full flex items-center justify-center gap-2 text-[14px] border border-red-400/30 text-red-200 rounded px-2.5 py-2 disabled:opacity-40"
          >
            <Trash2 className="w-4 h-4" />
            {removing ? t('localAIRemoving') : t('localAIRemoveButton')}
          </button>
        )}
      </div>
        </>
      )}
    </div>
  );
}
