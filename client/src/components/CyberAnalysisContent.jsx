import React, { useEffect, useState } from 'react';
import { ShieldAlert, ShieldCheck, RefreshCw } from 'lucide-react';
import { api } from '../services/api.js';
import { useLang } from '../services/langContext.jsx';

// Cyber Analysis content -- ANATOLIA-Q's surface for BCI (BOLD Cyber
// Intelligence), a separately deployed product (see bci/ and
// server/src/routes/cyberAnalysis.js). Shows BCI's own scores/findings;
// never the names of the third-party scanners BCI orchestrates underneath
// (spec section 56). Extracted from CyberAnalysisPage so the same content
// can be embedded as the "siber" analysis category (AnalysisView.jsx)
// as well as served at the standalone /cyber-analysis route.
function ScoreTile({ label, value, tone }) {
  return (
    <div className="hud-panel rounded-xl p-4 flex flex-col items-center gap-1">
      <span className="text-cyan-100/60 text-xs tracking-widest uppercase">{label}</span>
      <span className={`text-3xl font-serif ${tone}`}>{value ?? '—'}</span>
    </div>
  );
}

function scoreTone(score) {
  if (score == null) return 'text-cyan-100/40';
  if (score >= 80) return 'text-emerald-300';
  if (score >= 50) return 'text-gold';
  return 'text-red-400';
}

export default function CyberAnalysisContent() {
  const { t } = useLang();
  const [status, setStatus] = useState(null);
  const [overview, setOverview] = useState(null);
  const [findings, setFindings] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const s = await api.cyberAnalysisStatus();
      setStatus(s);
      if (s.available) {
        const [o, f] = await Promise.all([api.cyberAnalysisOverview(), api.cyberAnalysisFindings()]);
        setOverview(o);
        setFindings(f.findings || []);
      }
    } catch (err) {
      setError(err.message || t('cyberAnalysisUnavailable'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  return (
    <div className="space-y-4">
      <header className="hud-panel rounded-xl p-4 sm:p-5 flex items-center justify-between gap-3">
        <div>
          <p className="text-gold/70 text-xs tracking-widest uppercase">BOLD Cyber Intelligence</p>
          <h1 className="text-cyan-100 text-lg sm:text-xl tracking-widest">Cyber Analysis</h1>
        </div>
        <button
          onClick={load}
          className="border border-cyan-300/35 text-cyan-100 px-3 py-2 rounded flex items-center gap-2 hover:bg-cyan-400/10"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          {t('cyberAnalysisRefresh')}
        </button>
      </header>

      {error && (
        <div className="hud-panel rounded-xl p-4 border border-red-400/40 text-red-300 text-sm">{error}</div>
      )}

      {status && !status.available && (
        <div className="hud-panel rounded-xl p-4 flex items-center gap-3 text-cyan-100/70">
          <ShieldAlert className="w-5 h-5 text-gold" />
          <span>{t('cyberAnalysisNotConfigured')}</span>
        </div>
      )}

      {overview && (
        <div className="grid grid-cols-2 gap-4">
          <ScoreTile label="Security Score" value={overview.securityScore?.score} tone={scoreTone(overview.securityScore?.score)} />
          <ScoreTile label="Coverage Score" value={overview.coverageScore?.score} tone={scoreTone(overview.coverageScore?.score)} />
        </div>
      )}

      {findings && (
        <section className="hud-panel rounded-xl p-4 sm:p-5">
          <h2 className="text-cyan-100 text-sm tracking-widest uppercase mb-4 flex items-center gap-2">
            <ShieldCheck className="w-4 h-4" />
            Findings ({findings.length})
          </h2>
          {findings.length === 0 ? (
            <p className="text-cyan-100/50 text-sm">{t('cyberAnalysisNoFindings')}</p>
          ) : (
            <div className="space-y-2">
              {findings.map((f) => (
                <div key={f.id} className="border border-cyan-300/20 rounded p-3 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-cyan-100 text-sm">{f.title}</p>
                    <p className="text-cyan-100/50 text-xs">{f.target} · {f.category}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-gold text-sm">{f.priority || '—'}</p>
                    <p className="text-cyan-100/50 text-xs">Risk {f.risk_score ?? '—'}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
