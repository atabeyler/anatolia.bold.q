import React, { useEffect, useState } from 'react';
import { ShieldAlert, RefreshCw, ChevronLeft, ChevronRight } from 'lucide-react';
import { api, cyberAnalysisApi } from '../services/api.js';
import { useLang } from '../services/langContext.jsx';

// Cyber Analysis content -- a faithful, in-app port of BCI's own standalone
// admin UI (bci/ui: Dashboard/Assets/Scans/Findings/Reports/Engines/
// Quantum & PQC -- there is no separate "Scopes" page there either), same
// sidebar nav + per-page titles as bci/ui/src/components/Layout.jsx and
// bci/ui/src/pages/*.jsx, restyled in ANATOLIA-Q's own visual language
// rather than a redesign or a link out to a separate app. Every tab goes
// through ANATOLIA-Q's server, which proxies to BCI (services/bciClient.js,
// api.js's cyberAnalysisApi) using the user's own ANATOLIA-Q session (SSO --
// no separate BCI login); the browser never talks to BCI directly or holds
// a BCI token. Never shows the names of the third-party scanners BCI
// orchestrates underneath (spec section 56). All strings route through the
// existing i18n system (useLang/t) -- no hardcoded text.

function useTabs(t) {
  return [
    { id: 'dashboard', navKey: 'cyberNavDashboard', titleKey: 'cyberNavDashboard' },
    { id: 'assets', navKey: 'cyberNavAssets', titleKey: 'cyberNavAssets' },
    { id: 'scans', navKey: 'cyberNavScans', titleKey: 'cyberNavScans' },
    { id: 'findings', navKey: 'cyberNavFindings', titleKey: 'cyberNavFindings' },
    { id: 'reports', navKey: 'cyberNavReports', titleKey: 'cyberNavReports' },
    { id: 'engines', navKey: 'cyberNavEngines', titleKey: 'cyberNavEngines' },
    { id: 'quantum', navKey: 'cyberNavQuantum', titleKey: 'cyberTitleQuantum' },
  ].map((tb) => ({ ...tb, label: t(tb.navKey), title: t(tb.titleKey) }));
}

function scoreTone(score) {
  if (score == null) return 'text-cyan-100/40';
  if (score >= 80) return 'text-emerald-300';
  if (score >= 50) return 'text-gold';
  return 'text-red-400';
}

function Tile({ label, value, tone }) {
  return (
    <div className="hud-panel rounded-xl p-4 flex flex-col items-center gap-1">
      <span className="text-cyan-100/60 text-xs tracking-widest uppercase text-center">{label}</span>
      <span className={`text-3xl font-serif ${tone || 'text-cyan-100'}`}>{value ?? '—'}</span>
    </div>
  );
}

const inputCls = 'w-full bg-black/25 border border-cyan-400/20 rounded px-2.5 py-2 text-[13px] text-cyan-100 focus:border-cyan-300 focus:outline-none';
const btnCls = 'border border-cyan-300/35 text-cyan-100 px-3 py-2 rounded text-[13px] hover:bg-cyan-400/10 disabled:opacity-40 disabled:cursor-not-allowed';
const btnPrimaryCls = 'bg-cyan-400/15 border border-cyan-300/50 text-cyan-100 px-4 py-2 rounded text-[13px] hover:bg-cyan-400/25 disabled:opacity-40 disabled:cursor-not-allowed';
const tableWrap = 'overflow-x-auto';
const th = 'text-left text-[11px] tracking-widest uppercase text-cyan-100/50 px-2 py-2 border-b border-cyan-300/15 whitespace-nowrap';
const td = 'text-[13px] text-cyan-100/85 px-2 py-2 border-b border-cyan-300/10 whitespace-nowrap';

function Panel({ title, children, actions }) {
  return (
    <section className="hud-panel rounded-xl p-4 sm:p-5">
      <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
        <h2 className="text-cyan-100 text-sm tracking-widest uppercase">{title}</h2>
        {actions}
      </div>
      {children}
    </section>
  );
}

function PageTitle({ children }) {
  return <h1 className="text-cyan-100 text-base sm:text-lg tracking-widest uppercase">{children}</h1>;
}

function ErrorNote({ error }) {
  if (!error) return null;
  return <div className="text-red-300 text-[13px] border border-red-400/30 rounded p-2 mb-3">{error}</div>;
}

function Badge({ tone, children }) {
  const tones = {
    ok: 'text-emerald-300',
    warn: 'text-gold',
    danger: 'text-red-400',
    muted: 'text-cyan-100/50',
  };
  return <span className={tones[tone] || tones.muted}>{children}</span>;
}

// ─── Dashboard ──────────────────────────────────────────────────────────
function DashboardTab({ t }) {
  const [security, setSecurity] = useState(null);
  const [coverage, setCoverage] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.cyberAnalysisOverview()
      .then((o) => { setSecurity(o.securityScore); setCoverage(o.coverageScore); })
      .catch((err) => setError(err.message));
  }, []);

  return (
    <div className="space-y-4">
      <PageTitle>{t('cyberNavDashboard')}</PageTitle>
      <ErrorNote error={error} />
      <div className="grid grid-cols-3 gap-4">
        <Tile label={t('cyberSecurityScore')} value={security?.score} tone={scoreTone(security?.score)} />
        <div className="hud-panel rounded-xl p-4 flex flex-col items-center gap-1">
          <span className="text-cyan-100/60 text-xs tracking-widest uppercase">{t('cyberCoverageScore')}</span>
          <span className={`text-3xl font-serif ${scoreTone(coverage?.score)}`}>{coverage?.score ?? '—'}</span>
          {coverage?.reason && <span className="text-cyan-100/40 text-[11px]">{coverage.reason}</span>}
        </div>
        <Tile label={t('cyberOpenFindings')} value={security?.openFindingCount} />
      </div>
    </div>
  );
}

// ─── Assets ─────────────────────────────────────────────────────────────
const ASSET_TYPES = ['DOMAIN', 'HOST', 'WEB_APP', 'API', 'REPOSITORY', 'CONTAINER', 'CLOUD_RESOURCE', 'IDENTITY', 'SERVICE'];

function AssetsTab({ t }) {
  const [assets, setAssets] = useState(null);
  const [error, setError] = useState(null);
  const [name, setName] = useState('');
  const [assetType, setAssetType] = useState(ASSET_TYPES[0]);
  const [creating, setCreating] = useState(false);

  function load() {
    cyberAnalysisApi.listAssets().then((r) => setAssets(r.assets)).catch((err) => setError(err.message));
  }
  useEffect(load, []);

  async function onCreate() {
    if (!name.trim()) return;
    setCreating(true);
    setError(null);
    try {
      await cyberAnalysisApi.createAsset({ name: name.trim(), assetType });
      setName('');
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="space-y-4">
      <PageTitle>{t('cyberNavAssets')}</PageTitle>
      <ErrorNote error={error} />
      <Panel title={t('cyberAddAsset')}>
        <div className="grid sm:grid-cols-3 gap-2">
          <input className={inputCls} placeholder={t('cyberNamePlaceholder')} value={name} onChange={(e) => setName(e.target.value)} />
          <select className={inputCls} value={assetType} onChange={(e) => setAssetType(e.target.value)}>
            {ASSET_TYPES.map((at) => <option key={at} value={at}>{at}</option>)}
          </select>
          <button className={btnCls} onClick={onCreate} disabled={creating || !name.trim()}>{t('cyberAddAssetBtn')}</button>
        </div>
      </Panel>
      <Panel title={t('cyberAssetsPanelTitle')}>
        {assets && (
          <div className={tableWrap}>
            <table className="w-full">
              <thead><tr><th className={th}>{t('cyberColName')}</th><th className={th}>{t('cyberColType')}</th><th className={th}>{t('cyberColCriticality')}</th></tr></thead>
              <tbody>
                {assets.map((a) => (
                  <tr key={a.id}>
                    <td className={td}>{a.name}</td>
                    <td className={td}>{a.asset_type}</td>
                    <td className={td}>{a.criticality}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}

// ─── Scans ──────────────────────────────────────────────────────────────
const SCAN_CLASSES = ['PASSIVE', 'SAFE_ACTIVE', 'AUTHENTICATED', 'RESTRICTED'];

function scanStatusTone(status) {
  if (status === 'COMPLETED') return 'ok';
  if (['FAILED', 'TIMED_OUT', 'CANCELLED'].includes(status)) return 'danger';
  return 'warn';
}

const SCAN_TERMINAL_STATUSES = ['COMPLETED', 'FAILED', 'TIMED_OUT', 'CANCELLED'];
const SCAN_POLL_INTERVAL_MS = 3000;
const SCAN_POLL_MAX_ATTEMPTS = 60; // ~3 minutes

function ScansTab({ t, onScanCompleted }) {
  const [jobs, setJobs] = useState(null);
  const [target, setTarget] = useState('');
  const [requestedClass, setRequestedClass] = useState('PASSIVE');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [pendingJobId, setPendingJobId] = useState(null);

  function load() {
    cyberAnalysisApi.listScans().then((r) => setJobs(r.jobs)).catch((err) => setError(err.message));
  }
  useEffect(load, []);

  // Only real backend statuses drive this -- no fabricated progress bars.
  // Polling (and the eventual auto-advance to Findings) stops the moment
  // this tab unmounts, i.e. the moment the user navigates elsewhere, so a
  // scan finishing never yanks a user's attention away from something else.
  useEffect(() => {
    if (!pendingJobId) return;
    let attempts = 0;
    const interval = setInterval(async () => {
      attempts += 1;
      try {
        const { job } = await cyberAnalysisApi.getScan(pendingJobId);
        load();
        if (SCAN_TERMINAL_STATUSES.includes(job.status)) {
          clearInterval(interval);
          setPendingJobId(null);
          if (job.status === 'COMPLETED') onScanCompleted?.();
        } else if (attempts >= SCAN_POLL_MAX_ATTEMPTS) {
          clearInterval(interval);
          setPendingJobId(null);
        }
      } catch {
        clearInterval(interval);
        setPendingJobId(null);
      }
    }, SCAN_POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [pendingJobId]);

  async function onCreate() {
    if (!target.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const { job } = await cyberAnalysisApi.createScan({ target: target.trim(), requestedClass });
      setTarget('');
      load();
      if (job && !SCAN_TERMINAL_STATUSES.includes(job.status)) setPendingJobId(job.id);
    } catch (err) {
      setError(err.data?.reason ? `${err.message}: ${err.data.reason}` : err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      <PageTitle>{t('cyberNavScans')}</PageTitle>
      <ErrorNote error={error} />
      <Panel title={t('cyberStartScan')}>
        <div className="grid sm:grid-cols-3 gap-2 mb-2">
          <input className={inputCls} placeholder={t('cyberTargetPlaceholder')} value={target} onChange={(e) => setTarget(e.target.value)} />
          <select className={inputCls} value={requestedClass} onChange={(e) => setRequestedClass(e.target.value)}>
            {SCAN_CLASSES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <button className={btnCls} onClick={onCreate} disabled={submitting || !target.trim()}>{t('cyberStartScanBtn')}</button>
        </div>
        <p className="text-cyan-100/40 text-xs">{t('cyberScanScopeNote')}</p>
        {pendingJobId && <p className="text-cyan-100/50 text-xs mt-2">{t('cyberScanWatching')}</p>}
      </Panel>
      <Panel title={t('cyberScansPanelTitle')}>
        {jobs && (
          <div className={tableWrap}>
            <table className="w-full">
              <thead><tr><th className={th}>{t('cyberColTarget')}</th><th className={th}>{t('cyberColClass')}</th><th className={th}>{t('cyberColStatus')}</th><th className={th}>{t('cyberColAttempts')}</th></tr></thead>
              <tbody>
                {jobs.map((j) => (
                  <tr key={j.id}>
                    <td className={td}>{j.target}</td>
                    <td className={td}>{j.requested_class}</td>
                    <td className={td}><Badge tone={scanStatusTone(j.status)}>{j.status}</Badge></td>
                    <td className={td}>{j.attempts}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}

// ─── Findings ───────────────────────────────────────────────────────────
function priorityTone(priority) {
  if (priority === 'IMMEDIATE') return 'danger';
  if (priority === '24_HOURS' || priority === 'HIGH_PRIORITY') return 'warn';
  return 'muted';
}

function FindingDetail({ id, onClose, onChanged, t }) {
  const [finding, setFinding] = useState(null);
  const [explanation, setExplanation] = useState(null);
  const [verifyResult, setVerifyResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  function load() {
    cyberAnalysisApi.getFinding(id).then(setFinding).catch((err) => setError(err.message));
  }
  useEffect(load, [id]);

  async function run(action) {
    setBusy(true);
    setError(null);
    try {
      await action();
      load();
      onChanged?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (!finding) return <div className="hud-panel rounded-xl p-4 text-cyan-100/60 text-sm">{t('cyberLoading')}</div>;
  const { finding: f, sources } = finding;

  return (
    <div className="hud-panel rounded-xl p-4 sm:p-5 space-y-3">
      <div className="flex justify-between items-start gap-3">
        <div>
          <h3 className="text-cyan-100 text-sm">{f.title}</h3>
          <p className="text-cyan-100/50 text-xs">{f.target} · {f.category}</p>
        </div>
        <button className={btnCls} onClick={onClose}>{t('cyberClose')}</button>
      </div>
      <ErrorNote error={error} />
      <div className="grid grid-cols-4 gap-2">
        <Tile label={t('cyberColRisk')} value={f.risk_score ?? '—'} />
        <Tile label={t('cyberColConfidence')} value={f.confidence_score} />
        <Tile label={t('cyberColStatus')} value={f.status} />
        <Tile label={t('cyberColVerification')} value={f.verification_status} />
      </div>
      <p className="text-cyan-100/70 text-[13px]"><strong>{t('cyberSourcesLabel')}</strong> {sources.map((s) => s.engine_id).join(', ') || t('cyberSourcesNone')}</p>
      <div className="flex gap-2 flex-wrap">
        <button className={btnCls} disabled={busy} onClick={() => run(async () => setExplanation(await cyberAnalysisApi.explainFinding(id)))}>{t('cyberExplain')}</button>
        <button className={btnCls} disabled={busy} onClick={() => run(async () => setVerifyResult(await cyberAnalysisApi.verifyFindingFix(id)))}>{t('cyberVerifyFix')}</button>
        <button className={btnCls} disabled={busy} onClick={() => run(() => cyberAnalysisApi.confirmFinding(id))}>{t('cyberConfirm')}</button>
        <button className={btnCls} disabled={busy} onClick={() => run(() => cyberAnalysisApi.markFalsePositive(id))}>{t('cyberMarkFalsePositive')}</button>
      </div>
      {explanation && <p className="text-cyan-100/70 text-[13px] border border-cyan-300/20 rounded p-2">{explanation.text} <em className="text-cyan-100/40">({explanation.source})</em></p>}
      {verifyResult && <p className="text-cyan-100/70 text-[13px] border border-cyan-300/20 rounded p-2">{t('cyberVerifyResultLabel')} <strong>{verifyResult.result}</strong> — {verifyResult.detail}</p>}
    </div>
  );
}

function FindingsTab({ t }) {
  const [findings, setFindings] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [error, setError] = useState(null);

  function load() {
    api.cyberAnalysisFindings().then((r) => setFindings(r.findings)).catch((err) => setError(err.message));
  }
  useEffect(load, []);

  return (
    <div className="space-y-4">
      <PageTitle>{t('cyberNavFindings')}</PageTitle>
      <ErrorNote error={error} />
      {selectedId && <FindingDetail id={selectedId} onClose={() => setSelectedId(null)} onChanged={load} t={t} />}
      <Panel title={t('cyberFindingsPanelTitle', { count: findings?.length ?? 0 })}>
        {findings && findings.length === 0 ? (
          <p className="text-cyan-100/50 text-sm">{t('cyberAnalysisNoFindings')}</p>
        ) : findings && (
          <div className={tableWrap}>
            <table className="w-full">
              <thead><tr><th className={th}>{t('cyberColTitle')}</th><th className={th}>{t('cyberColTarget')}</th><th className={th}>{t('cyberColPriority')}</th><th className={th}>{t('cyberColRisk')}</th><th className={th}>{t('cyberColStatus')}</th></tr></thead>
              <tbody>
                {findings.map((f) => (
                  <tr key={f.id} className="cursor-pointer hover:bg-cyan-400/5" onClick={() => setSelectedId(f.id)}>
                    <td className={td}>{f.title}</td>
                    <td className={td}>{f.target}</td>
                    <td className={td}>{f.priority && <Badge tone={priorityTone(f.priority)}>{f.priority}</Badge>}</td>
                    <td className={td}>{f.risk_score ?? '—'}</td>
                    <td className={td}>{f.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}

// ─── Reports ────────────────────────────────────────────────────────────
const REPORT_TYPES = ['EXECUTIVE', 'TECHNICAL', 'REMEDIATION', 'AUDIT'];

function ReportsTab({ t }) {
  const [reports, setReports] = useState(null);
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState(null);
  const [generating, setGenerating] = useState(false);

  function load() {
    cyberAnalysisApi.listReports().then((r) => setReports(r.reports)).catch((err) => setError(err.message));
  }
  useEffect(load, []);

  async function onGenerate(reportType) {
    setGenerating(true);
    setError(null);
    try {
      await cyberAnalysisApi.generateReport(reportType);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setGenerating(false);
    }
  }

  async function view(id) {
    setSelected(await cyberAnalysisApi.getReport(id));
  }

  return (
    <div className="space-y-4">
      <PageTitle>{t('cyberNavReports')}</PageTitle>
      <ErrorNote error={error} />
      <Panel title={t('cyberGenerateReport')}>
        <div className="flex gap-2 flex-wrap">
          {REPORT_TYPES.map((rt) => (
            <button key={rt} className={btnCls} disabled={generating} onClick={() => onGenerate(rt)}>{t('cyberGenerateBtn', { type: rt })}</button>
          ))}
        </div>
      </Panel>

      {selected && (
        <Panel title={selected.report.report_type} actions={<button className={btnCls} onClick={() => setSelected(null)}>{t('cyberClose')}</button>}>
          <p className="text-cyan-100/50 text-xs mb-2">
            {t('cyberHashLabel')} {selected.report.content_hash.slice(0, 16)}… · {t('cyberIntegrityLabel')}{' '}
            <Badge tone={selected.report.integrityValid ? 'ok' : 'danger'}>{selected.report.integrityValid ? t('cyberIntegrityValid') : t('cyberIntegrityTampered')}</Badge>
          </p>
          <pre className="whitespace-pre-wrap text-[11px] max-h-[300px] overflow-auto text-cyan-100/70 border border-cyan-300/15 rounded p-2">
            {JSON.stringify(selected.report.content, null, 2)}
          </pre>
        </Panel>
      )}

      <Panel title={t('cyberReportsPanelTitle')}>
        {reports && (
          <div className={tableWrap}>
            <table className="w-full">
              <thead><tr><th className={th}>{t('cyberColType')}</th><th className={th}>{t('cyberColGenerated')}</th><th className={th}>{t('cyberColBciVersion')}</th><th className={th}></th></tr></thead>
              <tbody>
                {reports.map((r) => (
                  <tr key={r.id}>
                    <td className={td}>{r.report_type}</td>
                    <td className={td}>{new Date(r.created_at).toLocaleString()}</td>
                    <td className={td}>{r.bci_version}</td>
                    <td className={td}><button className={btnCls} onClick={() => view(r.id)}>{t('cyberView')}</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}

// ─── Engines ────────────────────────────────────────────────────────────
function engineStatusTone(status) {
  if (status === 'HEALTHY') return 'ok';
  if (status === 'DEGRADED') return 'warn';
  return 'danger';
}

function EnginesTab({ t }) {
  const [engines, setEngines] = useState(null);
  const [error, setError] = useState(null);
  const [checking, setChecking] = useState(false);

  function load() {
    cyberAnalysisApi.listEngines().then((r) => setEngines(r.engines)).catch((err) => setError(err.message));
  }
  useEffect(load, []);

  async function onHealthCheck() {
    setChecking(true);
    setError(null);
    try {
      await cyberAnalysisApi.runEngineHealthCheck();
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="space-y-4">
      <PageTitle>{t('cyberNavEngines')}</PageTitle>
      <ErrorNote error={error} />
      <Panel title={t('cyberEnginesPanelTitle')} actions={<button className={btnCls} disabled={checking} onClick={onHealthCheck}>{checking ? t('cyberChecking') : t('cyberRunHealthCheck')}</button>}>
        {engines && (
          <div className={tableWrap}>
            <table className="w-full">
              <thead><tr><th className={th}>{t('cyberColEngine')}</th><th className={th}>{t('cyberColStatus')}</th><th className={th}>{t('cyberColVersion')}</th><th className={th}>{t('cyberColIntrusiveness')}</th><th className={th}>{t('cyberColLicense')}</th><th className={th}>{t('cyberColLastChecked')}</th></tr></thead>
              <tbody>
                {engines.map((e) => (
                  <tr key={e.id}>
                    <td className={td}>{e.name}</td>
                    <td className={td}><Badge tone={engineStatusTone(e.status)}>{e.status || t('cyberUnknown')}</Badge></td>
                    <td className={td}>{e.version || '—'}</td>
                    <td className={td}>{e.intrusiveness}</td>
                    <td className={td}>{e.license}</td>
                    <td className={td}>{e.last_checked_at ? new Date(e.last_checked_at).toLocaleString() : t('cyberNever')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}

// ─── Quantum & PQC ──────────────────────────────────────────────────────
function QuantumTab({ t }) {
  const [providers, setProviders] = useState([]);
  const [policy, setPolicy] = useState(null);
  const [benchmarks, setBenchmarks] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [inventory, setInventory] = useState([]);
  const [readiness, setReadiness] = useState(null);
  const [cbom, setCbom] = useState(null);
  const [error, setError] = useState(null);

  const [effortBudget, setEffortBudget] = useState(10);
  const [optimizing, setOptimizing] = useState(false);
  const [optimizeResult, setOptimizeResult] = useState(null);

  const [discoverTarget, setDiscoverTarget] = useState('');
  const [discoverPort, setDiscoverPort] = useState('');
  const [discoverProtocol, setDiscoverProtocol] = useState('TLS');
  const [discovering, setDiscovering] = useState(false);

  const [jwtToken, setJwtToken] = useState('');
  const [jwtDiscovering, setJwtDiscovering] = useState(false);

  function load() {
    Promise.all([
      cyberAnalysisApi.listQuantumProviders(),
      cyberAnalysisApi.getQuantumPolicy(),
      cyberAnalysisApi.listQuantumBenchmarks(),
      cyberAnalysisApi.listQuantumJobs(),
      cyberAnalysisApi.listCryptoInventory(),
      cyberAnalysisApi.getPqcReadiness(),
      cyberAnalysisApi.getCbom(),
    ])
      .then(([p, pol, b, j, inv, r, c]) => {
        setProviders(p.providers);
        setPolicy(pol.policy);
        setBenchmarks(b.benchmarks);
        setJobs(j.jobs);
        setInventory(inv.findings);
        setReadiness(r);
        setCbom(c);
      })
      .catch((err) => setError(err.message));
  }
  useEffect(load, []);

  async function onSavePolicy() {
    setError(null);
    try {
      await cyberAnalysisApi.setQuantumPolicy(policy);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function onOptimize() {
    setOptimizing(true);
    setError(null);
    try {
      const result = await cyberAnalysisApi.runRemediationOptimize(Number(effortBudget));
      setOptimizeResult(result);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setOptimizing(false);
    }
  }

  async function onDiscover() {
    if (!discoverTarget.trim()) return;
    setDiscovering(true);
    setError(null);
    try {
      await cyberAnalysisApi.discoverCrypto(discoverTarget.trim(), discoverPort ? Number(discoverPort) : undefined, discoverProtocol);
      setDiscoverTarget('');
      setDiscoverPort('');
      load();
    } catch (err) {
      setError(err.data?.reason ? `${err.message}: ${err.data.reason}` : err.message);
    } finally {
      setDiscovering(false);
    }
  }

  async function onDiscoverJwt() {
    if (!jwtToken.trim()) return;
    setJwtDiscovering(true);
    setError(null);
    try {
      await cyberAnalysisApi.discoverJwtCrypto(jwtToken.trim());
      setJwtToken('');
      load();
    } catch (err) {
      setError(err.data?.reason ? `${err.message}: ${err.data.reason}` : err.message);
    } finally {
      setJwtDiscovering(false);
    }
  }

  return (
    <div className="space-y-4">
      <PageTitle>{t('cyberTitleQuantum')}</PageTitle>
      <ErrorNote error={error} />
      <p className="text-cyan-100/50 text-[13px]">{t('cyberQuantumIntro')}</p>

      <Panel title={t('cyberQuantumGatewayTitle')}>
        <div className={tableWrap}>
          <table className="w-full">
            <thead><tr><th className={th}>{t('cyberColProvider')}</th><th className={th}>{t('cyberColHealth')}</th><th className={th}>{t('cyberColDetail')}</th></tr></thead>
            <tbody>
              {providers.map((p) => (
                <tr key={p.id}>
                  <td className={td}>{p.id}</td>
                  <td className={td}><Badge tone={p.status === 'AVAILABLE' ? 'ok' : p.status === 'DEGRADED' ? 'warn' : p.status === 'NOT_CONFIGURED' ? 'muted' : 'danger'}>{p.status}</Badge></td>
                  <td className={`${td} text-cyan-100/40`}>{p.detail || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {policy && (
          <div className="flex flex-wrap items-end gap-4 mt-4 pt-4 border-t border-cyan-300/10">
            <label className="flex items-center gap-2 text-[13px] text-cyan-100/80">
              <input type="checkbox" checked={policy.allowQuantumSimulator} onChange={(e) => setPolicy({ ...policy, allowQuantumSimulator: e.target.checked })} />
              {t('cyberAllowSimulator')}
            </label>
            <label className="flex items-center gap-2 text-[13px] text-cyan-100/80">
              <input type="checkbox" checked={policy.allowQuantumHardware} onChange={(e) => setPolicy({ ...policy, allowQuantumHardware: e.target.checked })} />
              {t('cyberAllowHardware')}
            </label>
            <div>
              <label className="block text-cyan-100/50 text-xs mb-1">{t('cyberMaxClassification')}</label>
              <select className={inputCls} value={policy.maxExternalDataClassification} onChange={(e) => setPolicy({ ...policy, maxExternalDataClassification: e.target.value })}>
                {['PUBLIC', 'INTERNAL', 'CONFIDENTIAL', 'SECRET'].map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <button className={btnPrimaryCls} onClick={onSavePolicy}>{t('cyberSavePolicy')}</button>
          </div>
        )}
      </Panel>

      <Panel title={t('cyberOptimizationsTitle')}>
        <div className="flex items-end gap-2 mb-3">
          <div>
            <label className="block text-cyan-100/50 text-xs mb-1">{t('cyberEffortBudget')}</label>
            <input type="number" min="1" className={inputCls} value={effortBudget} onChange={(e) => setEffortBudget(e.target.value)} />
          </div>
          <button className={btnCls} disabled={optimizing} onClick={onOptimize}>{optimizing ? t('cyberRunning') : t('cyberRunOptimizer')}</button>
        </div>
        {optimizeResult && (
          <div className="border border-cyan-300/20 rounded p-3 text-[13px] space-y-1">
            <div>{t('cyberVerdictLabel')} <Badge tone={optimizeResult.verdict === 'QUANTUM_BENEFIT_OBSERVED_FOR_THIS_WORKLOAD' ? 'ok' : 'muted'}>{optimizeResult.verdict || 'N/A'}</Badge></div>
            {optimizeResult.note && <div className="text-cyan-100/40">{optimizeResult.note}</div>}
            {optimizeResult.optimizationObjective != null && (
              <div title="The optimizer's own objective value for the selected findings -- not a measured real-world risk reduction.">
                {t('cyberOptimizationObjectiveLabel')} {optimizeResult.optimizationObjective}
              </div>
            )}
            {optimizeResult.selection?.length > 0 && (
              <ul className="list-disc list-inside text-cyan-100/70">
                {optimizeResult.selection.map((s) => <li key={s.id || s.title}>{s.title || s.id}</li>)}
              </ul>
            )}
          </div>
        )}

        <h3 className="text-cyan-100/70 text-xs tracking-widest uppercase mt-4 mb-2">{t('cyberRecentBenchmarks')}</h3>
        <div className={tableWrap}>
          <table className="w-full">
            <thead><tr><th className={th}>{t('cyberColSource')}</th><th className={th}>{t('cyberColVerdict')}</th><th className={th}>{t('cyberColCreated')}</th></tr></thead>
            <tbody>
              {benchmarks.map((b) => (
                <tr key={b.id}>
                  <td className={td}>{b.workload_source}</td>
                  <td className={td}><Badge tone={b.verdict === 'QUANTUM_BENEFIT_OBSERVED_FOR_THIS_WORKLOAD' ? 'ok' : 'muted'}>{b.verdict}</Badge></td>
                  <td className={td}>{new Date(b.created_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <h3 className="text-cyan-100/70 text-xs tracking-widest uppercase mt-4 mb-2">{t('cyberQuantumJobs')}</h3>
        <div className={tableWrap}>
          <table className="w-full">
            <thead><tr><th className={th}>{t('cyberColProvider')}</th><th className={th}>{t('cyberColMode')}</th><th className={th}>{t('cyberColStatus')}</th><th className={th}>{t('cyberColFallbackReason')}</th><th className={th}>{t('cyberColSubmitted')}</th></tr></thead>
            <tbody>
              {jobs.map((j) => (
                <tr key={j.id}>
                  <td className={td}>{j.provider}</td>
                  <td className={td}>{j.mode || '—'}</td>
                  <td className={td}><Badge tone={j.status === 'COMPLETED' ? 'ok' : j.status === 'FAILED' ? 'danger' : 'muted'}>{j.status}</Badge></td>
                  <td className={`${td} text-cyan-100/40`}>{j.fallback_reason || '—'}</td>
                  <td className={td}>{new Date(j.submitted_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel title={t('cyberPostQuantumSecurity')}>
        <div className="grid sm:grid-cols-4 gap-2 mb-2">
          <select className={inputCls} value={discoverProtocol} onChange={(e) => setDiscoverProtocol(e.target.value)}>
            <option value="TLS">TLS</option>
            <option value="SSH">SSH</option>
          </select>
          <input className={inputCls} placeholder="example.com" value={discoverTarget} onChange={(e) => setDiscoverTarget(e.target.value)} />
          <input className={inputCls} type="number" placeholder={discoverProtocol === 'SSH' ? '22' : '443'} value={discoverPort} onChange={(e) => setDiscoverPort(e.target.value)} />
          <button className={btnCls} disabled={discovering || !discoverTarget.trim()} onClick={onDiscover}>{discovering ? t('cyberProbing') : t('cyberDiscoverCrypto')}</button>
        </div>
        <p className="text-cyan-100/40 text-xs mb-3">{t('cyberCryptoScopeNote')}</p>

        <div className="flex gap-2 mb-4">
          <input className={inputCls} placeholder={t('cyberJwtPlaceholder')} value={jwtToken} onChange={(e) => setJwtToken(e.target.value)} />
          <button className={btnCls} disabled={jwtDiscovering || !jwtToken.trim()} onClick={onDiscoverJwt}>{jwtDiscovering ? t('cyberDecoding') : t('cyberDiscoverJwt')}</button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          <Tile label={t('cyberPqcReadinessScore')} value={readiness?.readinessScore ?? '—'} tone={scoreTone(readiness?.readinessScore)} />
          <Tile label={t('cyberQuantumVulnerable')} value={readiness?.quantumVulnerableCount ?? '—'} />
          <Tile label={t('cyberUnclassified')} value={readiness?.unclassifiedCount ?? '—'} />
          <Tile label={t('cyberCbomComponents')} value={cbom?.componentCount ?? '—'} />
        </div>
        {readiness?.note && <p className="text-cyan-100/40 text-xs mb-3">{readiness.note}</p>}

        <h3 className="text-cyan-100/70 text-xs tracking-widest uppercase mb-2">{t('cyberCryptoInventory')}</h3>
        <div className={tableWrap}>
          <table className="w-full">
            <thead><tr><th className={th}>{t('cyberColTarget')}</th><th className={th}>{t('cyberColAlgorithm')}</th><th className={th}>{t('cyberColKeySize')}</th><th className={th}>{t('cyberColQuantumVulnerable')}</th><th className={th}>{t('cyberColDiscovered')}</th></tr></thead>
            <tbody>
              {inventory.map((f) => (
                <tr key={f.id}>
                  <td className={td}>{f.target}</td>
                  <td className={td}>{f.algorithm_id}</td>
                  <td className={td}>{f.key_size_bits ?? '—'}</td>
                  <td className={td}><Badge tone={f.quantum_vulnerable === true ? 'danger' : f.quantum_vulnerable === false ? 'ok' : 'muted'}>{f.quantum_vulnerable === null ? t('cyberUnknown') : String(f.quantum_vulnerable)}</Badge></td>
                  <td className={td}>{new Date(f.discovered_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <h3 className="text-cyan-100/70 text-xs tracking-widest uppercase mt-4 mb-2">{t('cyberMigrationRoadmap')}</h3>
        <div className={tableWrap}>
          <table className="w-full">
            <thead><tr><th className={th}>{t('cyberColTarget')}</th><th className={th}>{t('cyberColAlgorithm')}</th><th className={th}>{t('cyberColPriority')}</th><th className={th}>{t('cyberColHarvestNowDecryptLater')}</th></tr></thead>
            <tbody>
              {(readiness?.roadmap || []).map((r) => (
                <tr key={r.target}>
                  <td className={td}>{r.target}</td>
                  <td className={td}>{r.algorithmId}</td>
                  <td className={td}>{r.priority}</td>
                  <td className={td}>{r.harvestNowDecryptLater ? <Badge tone="warn">{t('cyberFutureExposure')}</Badge> : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}

export default function CyberAnalysisContent() {
  const { t } = useLang();
  const TABS = useTabs(t);
  const [tab, setTab] = useState('dashboard');
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  async function loadStatus() {
    setLoading(true);
    setError(null);
    try {
      const s = await api.cyberAnalysisStatus();
      setStatus(s);
    } catch (err) {
      setError(err.message || t('cyberAnalysisUnavailable'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadStatus(); }, []);

  const ActiveTab = {
    dashboard: DashboardTab,
    assets: AssetsTab,
    scans: ScansTab,
    findings: FindingsTab,
    reports: ReportsTab,
    engines: EnginesTab,
    quantum: QuantumTab,
  }[tab];

  const activeIndex = TABS.findIndex((tb) => tb.id === tab);
  const goPrev = () => { if (activeIndex > 0) setTab(TABS[activeIndex - 1].id); };
  const goNext = () => { if (activeIndex < TABS.length - 1) setTab(TABS[activeIndex + 1].id); };
  const activeTabProps = tab === 'scans' ? { t, onScanCompleted: () => setTab('findings') } : { t };

  // Enter = next tab, Backspace = previous tab, same physical keys on every
  // desktop OS/keyboard layout (unlike PageUp/PageDown or Alt+Arrow, which
  // vary or collide with browser/OS bindings). Guarded so typing, submitting
  // a form with Enter, deleting text with Backspace, or activating a
  // focused button/link with Enter (e.g. "Start scan") never also triggers
  // tab navigation on top of its own action -- only unmodified keypresses
  // outside any interactive control step the wizard.
  useEffect(() => {
    if (!status?.available) return undefined;
    function onKeyDown(e) {
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      const el = e.target;
      const isInteractive = el?.closest?.('input, textarea, select, button, a, [role="button"], [contenteditable="true"]');
      if (isInteractive) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        goNext();
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        goPrev();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [status?.available, activeIndex, TABS.length]);

  return (
    <div className="space-y-4">
      <header className="hud-panel rounded-xl p-4 sm:p-5 flex items-center justify-between gap-3">
        <div>
          <p className="text-gold/70 text-xs tracking-widest uppercase">BOLD Cyber Intelligence</p>
          <h1 className="text-cyan-100 text-lg sm:text-xl tracking-widest">Cyber Analysis</h1>
        </div>
        <button
          onClick={loadStatus}
          className="border border-cyan-300/35 text-cyan-100 px-3 py-2 rounded flex items-center gap-2 hover:bg-cyan-400/10"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          {t('cyberAnalysisRefresh')}
        </button>
      </header>

      {error && (
        <div className="hud-panel rounded-xl p-4 border border-red-400/40 text-red-300 text-sm">{error}</div>
      )}

      {status && !status.available ? (
        <div className="hud-panel rounded-xl p-4 flex items-center gap-3 text-cyan-100/70">
          <ShieldAlert className="w-5 h-5 text-gold" />
          <span>{t('cyberAnalysisNotConfigured')}</span>
        </div>
      ) : status?.available ? (
        <div className="flex flex-col sm:flex-row gap-4">
          <nav className="hud-panel rounded-xl p-2 flex sm:flex-col gap-1 sm:w-48 shrink-0 overflow-x-auto sm:overflow-visible">
            {TABS.map((tb) => (
              <button
                key={tb.id}
                onClick={() => setTab(tb.id)}
                className={`px-3 py-2 rounded text-[12px] tracking-wide uppercase transition text-left whitespace-nowrap ${
                  tab === tb.id ? 'bg-cyan-400/15 text-cyan-100 border border-cyan-300/40' : 'text-cyan-100/50 hover:text-cyan-100/80'
                }`}
              >
                {tb.label}
              </button>
            ))}
          </nav>

          <div className="flex-1 min-w-0 space-y-3">
            <div className="flex justify-end gap-2">
              <button
                onClick={goPrev}
                disabled={activeIndex <= 0}
                className="border border-cyan-300/35 text-cyan-100 px-3 py-1.5 rounded flex items-center gap-1 text-[12px] hover:bg-cyan-400/10 disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <ChevronLeft className="w-3.5 h-3.5" /> {t('cyberPrevTab')}
              </button>
              <button
                onClick={goNext}
                disabled={activeIndex >= TABS.length - 1}
                className="border border-cyan-300/35 text-cyan-100 px-3 py-1.5 rounded flex items-center gap-1 text-[12px] hover:bg-cyan-400/10 disabled:opacity-30 disabled:cursor-not-allowed"
              >
                {t('cyberNextTab')} <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
            <ActiveTab {...activeTabProps} />
          </div>
        </div>
      ) : null}
    </div>
  );
}
