import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ShieldAlert } from 'lucide-react';
import { api } from '../services/api.js';
import { useLang } from '../services/langContext.jsx';

// Cyber Analysis -- ANATOLIA-Q's entry point into BCI (BOLD Cyber
// Intelligence), a separately deployed product with its own database,
// users, and RBAC (see bci/ and server/src/routes/cyberAnalysis.js). This
// deliberately does NOT reimplement any of BCI's own screens (Dashboard/
// Assets/Scopes/Scans/Findings/Reports/Engines/Quantum & PQC) -- it opens
// BCI's real admin UI (bci/ui) in a new tab instead.
export default function CyberAnalysisPage() {
  const { t } = useLang();
  const [error, setError] = useState(null);
  const [notConfigured, setNotConfigured] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function open() {
      try {
        const status = await api.cyberAnalysisStatus();
        if (!status.available) {
          if (!cancelled) setNotConfigured(true);
          return;
        }
        const { url } = await api.cyberAnalysisUiUrl();
        if (!cancelled) window.open(url, '_blank', 'noopener,noreferrer');
      } catch (err) {
        if (!cancelled) setError(err.message || t('cyberAnalysisUnavailable'));
      }
    }
    open();
    return () => { cancelled = true; };
  }, [t]);

  return (
    <div className="quantum-bg min-h-screen relative p-4 sm:p-6">
      <div className="relative z-10 max-w-2xl mx-auto space-y-4">
        <header className="hud-panel rounded-xl p-4 sm:p-5 flex items-center justify-between gap-3">
          <div>
            <p className="text-gold/70 text-xs tracking-widest uppercase">BOLD Cyber Intelligence</p>
            <h1 className="text-cyan-100 text-lg sm:text-xl tracking-widest">Cyber Analysis</h1>
          </div>
          <Link
            to="/"
            className="border border-cyan-300/35 text-cyan-100 px-3 py-2 rounded flex items-center gap-2 hover:bg-cyan-400/10"
          >
            <ArrowLeft className="w-4 h-4" />
            Dashboard
          </Link>
        </header>

        {error && (
          <div className="hud-panel rounded-xl p-4 border border-red-400/40 text-red-300 text-sm">{error}</div>
        )}

        {notConfigured ? (
          <div className="hud-panel rounded-xl p-4 flex items-center gap-3 text-cyan-100/70">
            <ShieldAlert className="w-5 h-5 text-gold" />
            <span>{t('cyberAnalysisNotConfigured')}</span>
          </div>
        ) : !error && (
          <p className="text-cyan-100/60 text-sm">Opening BCI's admin console in a new tab...</p>
        )}
      </div>
    </div>
  );
}
