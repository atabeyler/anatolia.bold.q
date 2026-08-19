import React, { useEffect, useState } from 'react';
import { Download, X } from 'lucide-react';
import { isDesktop, desktopUpdate } from '../services/desktopBridge.js';
import { isMobileApp, mobileUpdate } from '../services/mobileBridge.js';

// Native-app-only (desktop + Android): checks this app's own server for a
// newer published version (never GitHub directly, see
// server/src/routes/version.js) and asks the user before doing anything.
// Desktop drives the whole download/install itself via IPC
// (desktop/appUpdate.js); Android downloads the APK itself and hands it to
// the system package installer via a FileProvider intent (see
// mobileBridge.js's mobileUpdate.approve) rather than routing the download
// through Chrome. Renders nothing on the web build or once dismissed/no
// update found.
export default function UpdateBanner() {
  const [info, setInfo] = useState(null);
  const [stage, setStage] = useState('idle'); // idle | downloading | ready | error | dismissed
  const [progress, setProgress] = useState(null);

  useEffect(() => {
    if (isDesktop) {
      let cancelled = false;
      (async () => {
        try {
          const result = await desktopUpdate.getAvailable?.();
          if (!cancelled && result?.version) setInfo(result);
        } catch {
          // The banner still works via the push event below; this is only a
          // best-effort startup recheck so a missing bridge method must not
          // crash the UI.
        }
      })();
      return desktopUpdate.onAvailable((result) => setInfo(result));
    }
    if (isMobileApp) {
      let cancelled = false;
      mobileUpdate.check().then((result) => {
        if (!cancelled && result?.available) setInfo(result);
      });
      return () => { cancelled = true; };
    }
    return undefined;
  }, []);

  useEffect(() => {
    if (!isDesktop) return undefined;
    return desktopUpdate.onProgress(setProgress);
  }, []);

  if (!info || stage === 'dismissed') return null;

  const approve = async () => {
    if (isDesktop) {
      setStage('downloading');
      const result = await desktopUpdate.approve();
      setStage(result?.ok ? 'ready' : 'error');
    } else if (isMobileApp) {
      setStage('downloading');
      try {
        await mobileUpdate.approve(info.url);
        setStage('dismissed'); // Android's own install prompt takes over from here
      } catch {
        setStage('error');
      }
    }
  };

  const install = () => desktopUpdate.install();

  const pct = progress?.total ? Math.round((progress.received / progress.total) * 100) : null;

  if (isDesktop) {
    return (
      <div className="fixed inset-0 z-[97] flex items-center justify-center px-4 py-6 bg-slate-950/45 backdrop-blur-sm">
        <div className="w-full max-w-lg rounded-2xl border border-cyan-400/30 bg-slate-950/95 shadow-[0_24px_80px_rgba(0,0,0,0.55)] overflow-hidden">
          <div className="px-5 py-4 border-b border-cyan-400/20 bg-gradient-to-r from-cyan-950/90 to-slate-950/90 flex items-start gap-3">
            <Download className="w-5 h-5 shrink-0 text-cyan-300 mt-0.5" />
            <div className="min-w-0 flex-1">
              <div className="text-xs uppercase tracking-[0.35em] text-cyan-200/80">Desktop Update</div>
              <div className="mt-1 text-base sm:text-lg text-cyan-50 font-medium">
                {stage === 'idle' && `Yeni sürüm mevcut: v${info.version}`}
                {stage === 'downloading' && `İndiriliyor${pct !== null ? ` (%${pct})` : '…'}`}
                {stage === 'ready' && `v${info.version} indirildi.`}
                {stage === 'error' && 'İndirme başarısız oldu.'}
              </div>
              {stage === 'idle' && info.notes && (
                <p className="mt-2 text-xs sm:text-sm text-cyan-100/70 whitespace-pre-wrap">
                  {info.notes}
                </p>
              )}
            </div>
            <button onClick={() => setStage('dismissed')} className="shrink-0 text-cyan-100/75 hover:text-cyan-50" aria-label="Kapat">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="px-5 py-4 flex flex-col sm:flex-row sm:items-center gap-3 sm:justify-between">
            <div className="text-xs text-cyan-100/70 leading-5">
              {stage === 'idle' && 'Güncelleme arka planda indirilip kurulum için hazırlanabilir.'}
              {stage === 'downloading' && 'Lütfen indirme tamamlanana kadar bekleyin.'}
              {stage === 'ready' && 'Kurulumu başlatmak için yeniden başlatma gerekli.'}
              {stage === 'error' && 'İndirme başarısız oldu, tekrar deneyebilirsiniz.'}
            </div>
            <div className="flex items-center gap-2 justify-end">
              {stage === 'idle' && (
                <button onClick={approve} className="border border-cyan-400/50 px-4 py-2 rounded-lg text-sm text-cyan-50 hover:bg-cyan-400/10 shrink-0">
                  Güncelle
                </button>
              )}
              {stage === 'ready' && (
                <button onClick={install} className="border border-cyan-400/50 px-4 py-2 rounded-lg text-sm text-cyan-50 hover:bg-cyan-400/10 shrink-0">
                  Kur ve Yeniden Başlat
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed top-0 inset-x-0 z-[97] bg-cyan-950/95 border-b border-cyan-400/40 text-cyan-100 px-4 py-2 flex items-center justify-center gap-3 text-xs tracking-wide">
      <Download className="w-4 h-4 shrink-0" />
      {stage === 'idle' && (
        <>
          <span>Yeni sürüm mevcut: v{info.version}</span>
          <button onClick={approve} className="border border-cyan-400/50 px-3 py-1 rounded hover:bg-cyan-400/10 shrink-0">
            Güncelle
          </button>
        </>
      )}
      {stage === 'downloading' && <span>İndiriliyor{pct !== null ? ` (%${pct})` : '…'}</span>}
      {stage === 'ready' && (
        <>
          <span>v{info.version} indirildi.</span>
          <button onClick={install} className="border border-cyan-400/50 px-3 py-1 rounded hover:bg-cyan-400/10 shrink-0">
            Kur ve Yeniden Başlat
          </button>
        </>
      )}
      {stage === 'error' && <span>İndirme başarısız oldu.</span>}
      <button onClick={() => setStage('dismissed')} className="ml-2 shrink-0" aria-label="Kapat">
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
