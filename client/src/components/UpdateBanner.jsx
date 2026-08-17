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
    if (isDesktop) return desktopUpdate.onAvailable((result) => setInfo(result));
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
