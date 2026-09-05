import React, { useEffect, useRef, useState } from 'react';
import { ShieldAlert, ShieldCheck, RefreshCw, Loader2, Check } from 'lucide-react';
import { api, cyberAnalysisApi } from '../services/api.js';
import { useLang } from '../services/langContext.jsx';

// Cyber Analysis Wizard -- ANATOLIA-Q's dedicated, in-app entry point into
// BCI (BOLD Cyber Intelligence), a separately deployed product with its own
// database, users, and RBAC (see bci/ and server/src/routes/cyberAnalysis.js).
//
// This is NOT a copy of BCI's own standalone admin UI (bci/ui) and NOT the
// generic AnalysisView/AnalysisWizard flow used by the other analysis
// categories -- it's a purpose-built step wizard (target -> authorization
// -> start -> progress -> results) that talks to the real BCI scan/scope/
// findings/reports API through ANATOLIA-Q's server proxy the whole way.
// BCI's own fail-closed scope authorization is never second-guessed here:
// every step either reflects a real backend decision or blocks on one.
const TARGET_TYPES = ['DOMAIN', 'SUBDOMAIN', 'URL', 'IP', 'CIDR', 'REPOSITORY', 'API', 'CLOUD_ACCOUNT', 'CONTAINER', 'KUBERNETES_CLUSTER'];
const SCAN_CLASSES = ['PASSIVE', 'SAFE_ACTIVE', 'AUTHENTICATED', 'RESTRICTED'];
const TERMINAL_STATUSES = ['COMPLETED', 'FAILED', 'CANCELLED', 'TIMED_OUT'];
const POLL_MS = 4000;

function scoreTone(score) {
  if (score == null) return 'text-cyan-100/40';
  if (score >= 80) return 'text-emerald-300';
  if (score >= 50) return 'text-gold';
  return 'text-red-400';
}

const inputCls = 'w-full bg-black/25 border border-cyan-400/20 rounded px-2.5 py-2 text-[13px] text-cyan-100 focus:border-cyan-300 focus:outline-none';
const btnCls = 'border border-cyan-300/35 text-cyan-100 px-3 py-2 rounded text-[13px] hover:bg-cyan-400/10 disabled:opacity-40 disabled:cursor-not-allowed';
const btnPrimaryCls = 'bg-cyan-400/15 border border-cyan-300/50 text-cyan-100 px-4 py-2 rounded text-[13px] hover:bg-cyan-400/25 disabled:opacity-40 disabled:cursor-not-allowed';

function ErrorNote({ error }) {
  if (!error) return null;
  return <div className="text-red-300 text-[13px] border border-red-400/30 rounded p-2 mb-3">{error}</div>;
}

function StatusBadge({ status, t }) {
  const map = {
    QUEUED: { cls: 'text-gold', label: t('cyberWizStatusQueued') },
    ANALYZING: { cls: 'text-cyan-300', label: t('cyberWizStatusAnalyzing') },
    COMPLETED: { cls: 'text-emerald-300', label: t('cyberWizStatusCompleted') },
    FAILED: { cls: 'text-red-400', label: t('cyberWizStatusFailed') },
    TIMED_OUT: { cls: 'text-red-400', label: t('cyberWizStatusTimedOut') },
    CANCELLED: { cls: 'text-cyan-100/50', label: t('cyberWizStatusCancelled') },
  };
  const entry = map[status] || { cls: 'text-cyan-100/50', label: status || '—' };
  return <span className={entry.cls}>{entry.label}</span>;
}

const STEPS = ['target', 'authorization', 'start', 'progress', 'results'];

export default function CyberAnalysisWizard() {
  const { t } = useLang();
  const [status, setStatus] = useState(null); // { available }
  const [checkingStatus, setCheckingStatus] = useState(true);
  const [statusError, setStatusError] = useState(null);

  const [step, setStep] = useState(0);
  const [target, setTarget] = useState('');
  const [targetType, setTargetType] = useState(TARGET_TYPES[0]);
  const [requestedClass, setRequestedClass] = useState(SCAN_CLASSES[0]);

  const [checkingAuth, setCheckingAuth] = useState(false);
  const [authDecision, setAuthDecision] = useState(null); // { decision: 'ALLOW'|'DENY', reason }
  const [authError, setAuthError] = useState(null);

  const [proposingScope, setProposingScope] = useState(false);
  const [scopeName, setScopeName] = useState('');
  const [scopeError, setScopeError] = useState(null);
  const [scopeProposed, setScopeProposed] = useState(false);

  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState(null);
  const [job, setJob] = useState(null);

  const [overview, setOverview] = useState(null);
  const [findings, setFindings] = useState(null);
  const [resultsError, setResultsError] = useState(null);

  const [generatingReport, setGeneratingReport] = useState(false);
  const [reportError, setReportError] = useState(null);
  const [reportGenerated, setReportGenerated] = useState(false);

  const pollRef = useRef(null);

  async function loadStatus() {
    setCheckingStatus(true);
    setStatusError(null);
    try {
      const s = await api.cyberAnalysisStatus();
      setStatus(s);
    } catch (err) {
      setStatusError(err.message || t('cyberWizUnavailableTitle'));
    } finally {
      setCheckingStatus(false);
    }
  }
  useEffect(() => { loadStatus(); }, []);

  async function checkAuthorization() {
    if (!target.trim()) return;
    setCheckingAuth(true);
    setAuthError(null);
    setAuthDecision(null);
    setScopeProposed(false);
    try {
      const decision = await cyberAnalysisApi.evaluateScope(target.trim(), requestedClass);
      setAuthDecision(decision);
    } catch (err) {
      setAuthError(err.message);
    } finally {
      setCheckingAuth(false);
    }
  }

  async function proposeScope() {
    if (!scopeName.trim() || !target.trim()) return;
    setProposingScope(true);
    setScopeError(null);
    try {
      await cyberAnalysisApi.createScope({
        name: scopeName.trim(),
        target: target.trim(),
        targetType,
        allowedScanClasses: [requestedClass],
        intrusiveness: requestedClass,
      });
      setScopeProposed(true);
    } catch (err) {
      setScopeError(err.message);
    } finally {
      setProposingScope(false);
    }
  }

  async function startScan() {
    setStarting(true);
    setStartError(null);
    try {
      const result = await cyberAnalysisApi.createScan({ target: target.trim(), requestedClass });
      setJob(result.job);
      setStep(3);
    } catch (err) {
      setStartError(err.message);
    } finally {
      setStarting(false);
    }
  }

  // Polls the real scan job status -- no fabricated percentage, just the
  // backend's own QUEUED/ANALYZING/COMPLETED/FAILED/TIMED_OUT/CANCELLED.
  useEffect(() => {
    if (step !== 3 || !job?.id) return;
    let cancelled = false;
    async function poll() {
      try {
        const { job: updated } = await cyberAnalysisApi.getScan(job.id);
        if (cancelled) return;
        setJob(updated);
        if (TERMINAL_STATUSES.includes(updated.status)) {
          if (pollRef.current) clearTimeout(pollRef.current);
          if (updated.status === 'COMPLETED') setStep(4);
          return;
        }
      } catch {
        // A transient poll failure isn't a scan failure -- just retry.
      }
      if (!cancelled) pollRef.current = setTimeout(poll, POLL_MS);
    }
    poll();
    return () => { cancelled = true; if (pollRef.current) clearTimeout(pollRef.current); };
  }, [step, job?.id]);

  useEffect(() => {
    if (step !== 4) return;
    let cancelled = false;
    (async () => {
      try {
        const [ov, f] = await Promise.all([api.cyberAnalysisOverview(), api.cyberAnalysisFindings()]);
        if (cancelled) return;
        setOverview(ov);
        setFindings(f.findings || []);
      } catch (err) {
        if (!cancelled) setResultsError(err.message);
      }
    })();
    return () => { cancelled = true; };
  }, [step]);

  async function generateReport() {
    setGeneratingReport(true);
    setReportError(null);
    try {
      await cyberAnalysisApi.generateReport('TECHNICAL');
      setReportGenerated(true);
    } catch (err) {
      setReportError(err.message);
    } finally {
      setGeneratingReport(false);
    }
  }

  function reset() {
    setStep(0);
    setTarget('');
    setTargetType(TARGET_TYPES[0]);
    setRequestedClass(SCAN_CLASSES[0]);
    setAuthDecision(null);
    setAuthError(null);
    setScopeProposed(false);
    setScopeName('');
    setJob(null);
    setOverview(null);
    setFindings(null);
    setReportGenerated(false);
  }

  if (checkingStatus) {
    return (
      <div className="hud-panel rounded-xl p-6 flex items-center justify-center gap-2 text-cyan-100/60">
        <Loader2 className="w-4 h-4 animate-spin" />
        <span>{t('cyberAnalysisRefresh')}</span>
      </div>
    );
  }

  if (statusError || (status && !status.available)) {
    return (
      <div className="hud-panel rounded-xl p-6 flex flex-col items-center gap-3 text-center">
        <ShieldAlert className="w-8 h-8 text-gold" />
        <p className="text-cyan-100/80 text-sm">{statusError || t('cyberWizUnavailableTitle')}</p>
        <button className={btnCls} onClick={loadStatus}>
          <RefreshCw className="w-4 h-4 inline mr-1.5" />
          {t('cyberWizRetry')}
        </button>
      </div>
    );
  }

  const findingsForTarget = findings ? findings.filter((f) => f.target === target.trim()) : [];
  const otherFindings = findings ? findings.filter((f) => f.target !== target.trim()) : [];

  return (
    <div className="space-y-4">
      <header className="hud-panel rounded-xl p-4 sm:p-5">
        <p className="text-gold/70 text-xs tracking-widest uppercase">BOLD Cyber Intelligence</p>
        <h1 className="text-cyan-100 text-lg sm:text-xl tracking-widest mb-3">{t('cyberWizTitle')}</h1>
        <div className="flex flex-wrap gap-2">
          {STEPS.map((s, i) => (
            <div
              key={s}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] tracking-wide uppercase border ${
                i === step ? 'border-cyan-300/50 bg-cyan-400/15 text-cyan-100' : i < step ? 'border-emerald-400/30 text-emerald-300/80' : 'border-cyan-300/10 text-cyan-100/35'
              }`}
            >
              {i < step ? <Check className="w-3 h-3" /> : <span>{i + 1}</span>}
              {t(`cyberWizStep${s.charAt(0).toUpperCase()}${s.slice(1)}`)}
            </div>
          ))}
        </div>
      </header>

      {step === 0 && (
        <section className="hud-panel rounded-xl p-4 sm:p-5 space-y-3">
          <div>
            <label className="text-cyan-100/60 text-xs tracking-widest uppercase block mb-1">{t('cyberWizTargetLabel')}</label>
            <input className={inputCls} value={target} onChange={(e) => setTarget(e.target.value)} placeholder={t('cyberWizTargetPh')} />
          </div>
          <div>
            <label className="text-cyan-100/60 text-xs tracking-widest uppercase block mb-1">{t('cyberWizTargetTypeLabel')}</label>
            <select className={inputCls} value={targetType} onChange={(e) => setTargetType(e.target.value)}>
              {TARGET_TYPES.map((tt) => <option key={tt} value={tt}>{tt}</option>)}
            </select>
          </div>
          <div className="flex justify-end">
            <button className={btnPrimaryCls} onClick={() => setStep(1)} disabled={!target.trim()}>{t('cyberWizNext')}</button>
          </div>
        </section>
      )}

      {step === 1 && (
        <section className="hud-panel rounded-xl p-4 sm:p-5 space-y-3">
          <ErrorNote error={authError} />
          <div>
            <label className="text-cyan-100/60 text-xs tracking-widest uppercase block mb-1">{t('cyberWizScanClassLabel')}</label>
            <select className={inputCls} value={requestedClass} onChange={(e) => setRequestedClass(e.target.value)}>
              {SCAN_CLASSES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <button className={btnCls} onClick={checkAuthorization} disabled={checkingAuth}>
            {checkingAuth ? <Loader2 className="w-4 h-4 inline animate-spin mr-1.5" /> : null}
            {t('cyberWizCheckAuthorization')}
          </button>

          {authDecision && (
            <div className={`rounded p-3 border text-[13px] ${authDecision.decision === 'ALLOW' ? 'border-emerald-400/30 text-emerald-300' : 'border-red-400/30 text-red-300'}`}>
              {authDecision.decision === 'ALLOW' ? (
                <span className="flex items-center gap-2"><ShieldCheck className="w-4 h-4" />{t('cyberWizAuthAllowed')}</span>
              ) : (
                <div className="space-y-2">
                  <span className="flex items-center gap-2"><ShieldAlert className="w-4 h-4" />{t('cyberWizAuthDenied')} {authDecision.reason ? `(${authDecision.reason})` : ''}</span>
                  {!scopeProposed ? (
                    <div className="space-y-2 pt-1">
                      <p className="text-cyan-100/50 text-xs">{t('cyberWizProposeScope')}</p>
                      <ErrorNote error={scopeError} />
                      <div className="flex gap-2">
                        <input className={inputCls} placeholder={t('cyberWizScopeNameLabel')} value={scopeName} onChange={(e) => setScopeName(e.target.value)} />
                        <button className={btnCls} onClick={proposeScope} disabled={proposingScope || !scopeName.trim()}>{t('cyberWizProposeSubmit')}</button>
                      </div>
                    </div>
                  ) : (
                    <p className="text-gold text-xs pt-1">{t('cyberWizScopePendingNote')}</p>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="flex justify-between">
            <button className={btnCls} onClick={() => setStep(0)}>{t('cyberWizBack')}</button>
            <button className={btnPrimaryCls} onClick={() => setStep(2)} disabled={!authDecision || authDecision.decision !== 'ALLOW'}>{t('cyberWizNext')}</button>
          </div>
        </section>
      )}

      {step === 2 && (
        <section className="hud-panel rounded-xl p-4 sm:p-5 space-y-3">
          <ErrorNote error={startError} />
          <dl className="grid grid-cols-2 gap-2 text-[13px]">
            <dt className="text-cyan-100/50">{t('cyberWizTargetLabel')}</dt><dd className="text-cyan-100">{target}</dd>
            <dt className="text-cyan-100/50">{t('cyberWizTargetTypeLabel')}</dt><dd className="text-cyan-100">{targetType}</dd>
            <dt className="text-cyan-100/50">{t('cyberWizScanClassLabel')}</dt><dd className="text-cyan-100">{requestedClass}</dd>
          </dl>
          <div className="flex justify-between">
            <button className={btnCls} onClick={() => setStep(1)}>{t('cyberWizBack')}</button>
            <button className={btnPrimaryCls} onClick={startScan} disabled={starting}>
              {starting ? <Loader2 className="w-4 h-4 inline animate-spin mr-1.5" /> : null}
              {starting ? t('cyberWizStarting') : t('cyberWizStartScan')}
            </button>
          </div>
        </section>
      )}

      {step === 3 && job && (
        <section className="hud-panel rounded-xl p-6 flex flex-col items-center gap-3 text-center">
          <Loader2 className="w-8 h-8 text-cyan-300 animate-spin" />
          <p className="text-cyan-100 text-lg"><StatusBadge status={job.status} t={t} /></p>
          <p className="text-cyan-100/50 text-xs">{target}</p>
        </section>
      )}

      {step === 4 && (
        <div className="space-y-4">
          <ErrorNote error={resultsError} />
          {overview && (
            <div className="grid grid-cols-2 gap-4">
              <div className="hud-panel rounded-xl p-4 flex flex-col items-center gap-1">
                <span className="text-cyan-100/60 text-xs tracking-widest uppercase">{t('cyberWizSecurityScore')}</span>
                <span className={`text-3xl font-serif ${scoreTone(overview.securityScore?.score)}`}>{overview.securityScore?.score ?? '—'}</span>
              </div>
              <div className="hud-panel rounded-xl p-4 flex flex-col items-center gap-1">
                <span className="text-cyan-100/60 text-xs tracking-widest uppercase">{t('cyberWizCoverageScore')}</span>
                <span className={`text-3xl font-serif ${scoreTone(overview.coverageScore?.score)}`}>{overview.coverageScore?.score ?? '—'}</span>
              </div>
            </div>
          )}

          <section className="hud-panel rounded-xl p-4 sm:p-5">
            <h2 className="text-cyan-100 text-sm tracking-widest uppercase mb-3">{t('cyberWizFindingsTitle')} ({findingsForTarget.length})</h2>
            {findings && findingsForTarget.length === 0 ? (
              <p className="text-cyan-100/50 text-sm">{t('cyberWizNoFindings')}</p>
            ) : (
              <div className="space-y-2">
                {findingsForTarget.map((f) => (
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
            {otherFindings.length > 0 && (
              <p className="text-cyan-100/35 text-xs mt-3">{otherFindings.length} additional finding(s) from other targets in this organization.</p>
            )}
          </section>

          <section className="hud-panel rounded-xl p-4 sm:p-5">
            <h2 className="text-cyan-100 text-sm tracking-widest uppercase mb-3">{t('cyberWizReportsTitle')}</h2>
            <ErrorNote error={reportError} />
            {reportGenerated ? (
              <p className="text-emerald-300 text-sm">✓ {t('cyberWizGenerateReport')}</p>
            ) : (
              <button className={btnCls} onClick={generateReport} disabled={generatingReport}>
                {generatingReport ? <Loader2 className="w-4 h-4 inline animate-spin mr-1.5" /> : null}
                {t('cyberWizGenerateReport')}
              </button>
            )}
          </section>

          <div className="flex justify-end">
            <button className={btnPrimaryCls} onClick={reset}>{t('cyberWizNewAnalysis')}</button>
          </div>
        </div>
      )}
    </div>
  );
}
