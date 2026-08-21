import React, { useEffect, useState } from 'react';
import { Cpu, Download, Trash2, CircleCheck, CircleAlert } from 'lucide-react';
import { isNativeApp, nativeAI } from '../services/nativeBridge.js';

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
// Renders nothing at all on the plain web build, where there is no local
// model to manage in the first place.
//
// This is UI-only: it never touches modelManager.js's download/checksum/
// gating logic, only calls the existing IPC/bridge surface.
export default function LocalAIPanel({ t }) {
  const [status, setStatus] = useState(null); // null = loading
  const [error, setError] = useState('');
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState(null);
  const [removing, setRemoving] = useState(false);

  const refresh = () => {
    if (!isNativeApp) return;
    nativeAI.modelStatus().then((s) => setStatus(s || {})).catch((e) => setError(e?.message || ''));
  };

  useEffect(() => { refresh(); }, []);

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

  if (!isNativeApp) return null;

  const spec = status?.spec;
  const installed = !!status?.installed;
  const capability = status?.capability;
  const capable = capability ? capability.capable !== false : null;

  return (
    <div>
      <p className="text-xs text-gold/60 leading-relaxed mb-3">{t('localAIIntro')}</p>

      {status === null && <p className="text-xs text-cyan-100/50">{t('localAIChecking')}</p>}

      {status !== null && (
        <div className="border border-cyan-300/20 rounded px-2.5 py-2.5 mb-3">
          <div className="flex items-center gap-2">
            {installed ? <CircleCheck className="w-4 h-4 text-emerald-300/80 shrink-0" /> : <CircleAlert className="w-4 h-4 text-amber-300/80 shrink-0" />}
            <span className="text-xs text-cyan-100">{installed ? t('localAIInstalled') : t('localAINotInstalled')}</span>
          </div>
          {spec && <div className="text-[11px] text-cyan-300/50 pl-6 mt-0.5">{spec.label} · {formatBytes(spec.sizeBytes)}</div>}
        </div>
      )}

      {capability && (
        <div className="border border-cyan-300/20 rounded px-2.5 py-2.5 mb-3">
          <div className="text-xs tracking-[0.18em] uppercase text-gold/60 mb-1.5 flex items-center gap-1.5">
            <Cpu className="w-3.5 h-3.5" />{t('localAIDeviceInfo')}
          </div>
          <div className="text-[11px] text-cyan-100/70 space-y-0.5">
            <div>{t('localAIRamLabel')}: {formatBytes(capability.totalMemBytes)}</div>
            {typeof capability.freeDiskBytes === 'number' && <div>{t('localAIDiskLabel')}: {formatBytes(capability.freeDiskBytes)}</div>}
            {typeof capability.cpuCount === 'number' && <div>{t('localAICpuLabel')}: {capability.cpuCount}</div>}
          </div>
          {capable === false && <p className="text-[11px] text-amber-300/80 mt-1.5 leading-relaxed">{t('localAINotCapable')}</p>}
        </div>
      )}

      {error && <p className="text-[11px] text-red-300 mb-2 leading-relaxed">{error}</p>}

      {downloading && (
        <p className="text-[11px] text-cyan-300/70 mb-2">
          {progress && progress.total ? `${t('localAIDownloading')} (${formatBytes(progress.received)} / ${formatBytes(progress.total)})` : t('localAIDownloading')}
        </p>
      )}

      <div className="space-y-2">
        {!installed && (
          <button
            onClick={handleDownload}
            disabled={downloading}
            className="w-full flex items-center justify-center gap-2 text-[12px] border border-cyan-300/30 text-cyan-100 rounded px-2.5 py-2 disabled:opacity-40"
          >
            <Download className="w-4 h-4" />
            {downloading ? t('localAIDownloading') : t('localAIDownloadButton')}
          </button>
        )}
        {installed && (
          <button
            onClick={handleRemove}
            disabled={removing}
            className="w-full flex items-center justify-center gap-2 text-[12px] border border-red-400/30 text-red-200 rounded px-2.5 py-2 disabled:opacity-40"
          >
            <Trash2 className="w-4 h-4" />
            {removing ? t('localAIRemoving') : t('localAIRemoveButton')}
          </button>
        )}
      </div>
    </div>
  );
}
