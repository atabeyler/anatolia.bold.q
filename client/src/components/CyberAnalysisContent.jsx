import React, { useEffect, useState } from 'react';
import { ShieldAlert, RefreshCw } from 'lucide-react';
import { api, cyberAnalysisApi } from '../services/api.js';
import { useLang } from '../services/langContext.jsx';

// Cyber Analysis content -- a faithful, in-app port of BCI's own standalone
// admin UI (bci/ui: Dashboard/Assets/Scans/Findings/Reports/Engines/
// Quantum & PQC -- there is no separate "Scopes" page there either) into
// ANATOLIA-Q's own visual language, rather than a redesign or a link out to
// a separate app. Every tab goes through ANATOLIA-Q's server, which proxies
// to BCI (services/bciClient.js, api.js's cyberAnalysisApi) using the
// user's own ANATOLIA-Q session (SSO -- no separate BCI login); the browser
// never talks to BCI directly or holds a BCI token. Never shows the names
// of the third-party scanners BCI orchestrates underneath (spec section 56).

const TABS = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'assets', label: 'Assets' },
  { id: 'scans', label: 'Scans' },
  { id: 'findings', label: 'Findings' },
  { id: 'reports', label: 'Reports' },
  { id: 'engines', label: 'Engines' },
  { id: 'quantum', label: 'Quantum & PQC' },
];

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
function DashboardTab() {
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
      <ErrorNote error={error} />
      <div className="grid grid-cols-3 gap-4">
        <Tile label="Security Score" value={security?.score} tone={scoreTone(security?.score)} />
        <div className="hud-panel rounded-xl p-4 flex flex-col items-center gap-1">
          <span className="text-cyan-100/60 text-xs tracking-widest uppercase">Coverage Score</span>
          <span className={`text-3xl font-serif ${scoreTone(coverage?.score)}`}>{coverage?.score ?? '—'}</span>
          {coverage?.reason && <span className="text-cyan-100/40 text-[11px]">{coverage.reason}</span>}
        </div>
        <Tile label="Open Findings" value={security?.openFindingCount} />
      </div>
    </div>
  );
}

// ─── Assets ─────────────────────────────────────────────────────────────
const ASSET_TYPES = ['DOMAIN', 'HOST', 'WEB_APP', 'API', 'REPOSITORY', 'CONTAINER', 'CLOUD_RESOURCE', 'IDENTITY', 'SERVICE'];

function AssetsTab() {
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
      <ErrorNote error={error} />
      <Panel title="Add Asset">
        <div className="grid sm:grid-cols-3 gap-2">
          <input className={inputCls} placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
          <select className={inputCls} value={assetType} onChange={(e) => setAssetType(e.target.value)}>
            {ASSET_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <button className={btnCls} onClick={onCreate} disabled={creating || !name.trim()}>Add asset</button>
        </div>
      </Panel>
      <Panel title="Assets">
        {assets && (
          <div className={tableWrap}>
            <table className="w-full">
              <thead><tr><th className={th}>Name</th><th className={th}>Type</th><th className={th}>Criticality</th></tr></thead>
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

function ScansTab() {
  const [jobs, setJobs] = useState(null);
  const [target, setTarget] = useState('');
  const [requestedClass, setRequestedClass] = useState('PASSIVE');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  function load() {
    cyberAnalysisApi.listScans().then((r) => setJobs(r.jobs)).catch((err) => setError(err.message));
  }
  useEffect(load, []);

  async function onCreate() {
    if (!target.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await cyberAnalysisApi.createScan({ target: target.trim(), requestedClass });
      setTarget('');
      load();
    } catch (err) {
      setError(err.data?.reason ? `${err.message}: ${err.data.reason}` : err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      <ErrorNote error={error} />
      <Panel title="Start Scan">
        <div className="grid sm:grid-cols-3 gap-2 mb-2">
          <input className={inputCls} placeholder="Target (e.g. example.com)" value={target} onChange={(e) => setTarget(e.target.value)} />
          <select className={inputCls} value={requestedClass} onChange={(e) => setRequestedClass(e.target.value)}>
            {SCAN_CLASSES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <button className={btnCls} onClick={onCreate} disabled={submitting || !target.trim()}>Start scan</button>
        </div>
        <p className="text-cyan-100/40 text-xs">A scan only starts if the target is covered by an APPROVED authorized scope for the requested class.</p>
      </Panel>
      <Panel title="Scans">
        {jobs && (
          <div className={tableWrap}>
            <table className="w-full">
              <thead><tr><th className={th}>Target</th><th className={th}>Class</th><th className={th}>Status</th><th className={th}>Attempts</th></tr></thead>
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

function FindingDetail({ id, onClose, onChanged }) {
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

  if (!finding) return <div className="hud-panel rounded-xl p-4 text-cyan-100/60 text-sm">Loading…</div>;
  const { finding: f, sources } = finding;

  return (
    <div className="hud-panel rounded-xl p-4 sm:p-5 space-y-3">
      <div className="flex justify-between items-start gap-3">
        <div>
          <h3 className="text-cyan-100 text-sm">{f.title}</h3>
          <p className="text-cyan-100/50 text-xs">{f.target} · {f.category}</p>
        </div>
        <button className={btnCls} onClick={onClose}>Close</button>
      </div>
      <ErrorNote error={error} />
      <div className="grid grid-cols-4 gap-2">
        <Tile label="Risk" value={f.risk_score ?? '—'} />
        <Tile label="Confidence" value={f.confidence_score} />
        <Tile label="Status" value={f.status} />
        <Tile label="Verification" value={f.verification_status} />
      </div>
      <p className="text-cyan-100/70 text-[13px]"><strong>Sources:</strong> {sources.map((s) => s.engine_id).join(', ') || 'none'}</p>
      <div className="flex gap-2 flex-wrap">
        <button className={btnCls} disabled={busy} onClick={() => run(async () => setExplanation(await cyberAnalysisApi.explainFinding(id)))}>Explain</button>
        <button className={btnCls} disabled={busy} onClick={() => run(async () => setVerifyResult(await cyberAnalysisApi.verifyFindingFix(id)))}>Verify fix</button>
        <button className={btnCls} disabled={busy} onClick={() => run(() => cyberAnalysisApi.confirmFinding(id))}>Confirm</button>
        <button className={btnCls} disabled={busy} onClick={() => run(() => cyberAnalysisApi.markFalsePositive(id))}>Mark false positive</button>
      </div>
      {explanation && <p className="text-cyan-100/70 text-[13px] border border-cyan-300/20 rounded p-2">{explanation.text} <em className="text-cyan-100/40">({explanation.source})</em></p>}
      {verifyResult && <p className="text-cyan-100/70 text-[13px] border border-cyan-300/20 rounded p-2">Verify result: <strong>{verifyResult.result}</strong> — {verifyResult.detail}</p>}
    </div>
  );
}

function FindingsTab() {
  const { t } = useLang();
  const [findings, setFindings] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [error, setError] = useState(null);

  function load() {
    api.cyberAnalysisFindings().then((r) => setFindings(r.findings)).catch((err) => setError(err.message));
  }
  useEffect(load, []);

  return (
    <div className="space-y-4">
      <ErrorNote error={error} />
      {selectedId && <FindingDetail id={selectedId} onClose={() => setSelectedId(null)} onChanged={load} />}
      <Panel title={`Findings (${findings?.length ?? 0})`}>
        {findings && findings.length === 0 ? (
          <p className="text-cyan-100/50 text-sm">{t('cyberAnalysisNoFindings')}</p>
        ) : findings && (
          <div className={tableWrap}>
            <table className="w-full">
              <thead><tr><th className={th}>Title</th><th className={th}>Target</th><th className={th}>Priority</th><th className={th}>Risk</th><th className={th}>Status</th></tr></thead>
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

function ReportsTab() {
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
      <ErrorNote error={error} />
      <Panel title="Generate Report">
        <div className="flex gap-2 flex-wrap">
          {REPORT_TYPES.map((rt) => (
            <button key={rt} className={btnCls} disabled={generating} onClick={() => onGenerate(rt)}>Generate {rt}</button>
          ))}
        </div>
      </Panel>

      {selected && (
        <Panel title={selected.report.report_type} actions={<button className={btnCls} onClick={() => setSelected(null)}>Close</button>}>
          <p className="text-cyan-100/50 text-xs mb-2">
            hash: {selected.report.content_hash.slice(0, 16)}… · integrity:{' '}
            <Badge tone={selected.report.integrityValid ? 'ok' : 'danger'}>{selected.report.integrityValid ? 'valid' : 'TAMPERED'}</Badge>
          </p>
          <pre className="whitespace-pre-wrap text-[11px] max-h-[300px] overflow-auto text-cyan-100/70 border border-cyan-300/15 rounded p-2">
            {JSON.stringify(selected.report.content, null, 2)}
          </pre>
        </Panel>
      )}

      <Panel title="Reports">
        {reports && (
          <div className={tableWrap}>
            <table className="w-full">
              <thead><tr><th className={th}>Type</th><th className={th}>Generated</th><th className={th}>BCI Version</th><th className={th}></th></tr></thead>
              <tbody>
                {reports.map((r) => (
                  <tr key={r.id}>
                    <td className={td}>{r.report_type}</td>
                    <td className={td}>{new Date(r.created_at).toLocaleString()}</td>
                    <td className={td}>{r.bci_version}</td>
                    <td className={td}><button className={btnCls} onClick={() => view(r.id)}>View</button></td>
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

function EnginesTab() {
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
      <ErrorNote error={error} />
      <Panel title="Engines" actions={<button className={btnCls} disabled={checking} onClick={onHealthCheck}>{checking ? 'Checking…' : 'Run health check'}</button>}>
        {engines && (
          <div className={tableWrap}>
            <table className="w-full">
              <thead><tr><th className={th}>Engine</th><th className={th}>Status</th><th className={th}>Version</th><th className={th}>Intrusiveness</th><th className={th}>License</th><th className={th}>Last checked</th></tr></thead>
              <tbody>
                {engines.map((e) => (
                  <tr key={e.id}>
                    <td className={td}>{e.name}</td>
                    <td className={td}><Badge tone={engineStatusTone(e.status)}>{e.status || 'UNKNOWN'}</Badge></td>
                    <td className={td}>{e.version || '—'}</td>
                    <td className={td}>{e.intrusiveness}</td>
                    <td className={td}>{e.license}</td>
                    <td className={td}>{e.last_checked_at ? new Date(e.last_checked_at).toLocaleString() : 'never'}</td>
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
function QuantumTab() {
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
      <ErrorNote error={error} />
      <p className="text-cyan-100/50 text-[13px]">
        BCI's value is not "using quantum computers" — it is unifying discovery, risk, and remediation
        decisions in one platform. Quantum compute is one optional backend, used only where a real,
        measured benefit exists; every org defaults to classical, and nothing below is styled as more
        certain than what was actually measured.
      </p>

      <Panel title="Quantum Compute Gateway">
        <div className={tableWrap}>
          <table className="w-full">
            <thead><tr><th className={th}>Provider</th><th className={th}>Health</th><th className={th}>Detail</th></tr></thead>
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
              Allow local quantum simulator
            </label>
            <label className="flex items-center gap-2 text-[13px] text-cyan-100/80">
              <input type="checkbox" checked={policy.allowQuantumHardware} onChange={(e) => setPolicy({ ...policy, allowQuantumHardware: e.target.checked })} />
              Allow external IBM Quantum hardware
            </label>
            <div>
              <label className="block text-cyan-100/50 text-xs mb-1">Max external data classification</label>
              <select className={inputCls} value={policy.maxExternalDataClassification} onChange={(e) => setPolicy({ ...policy, maxExternalDataClassification: e.target.value })}>
                {['PUBLIC', 'INTERNAL', 'CONFIDENTIAL', 'SECRET'].map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <button className={btnPrimaryCls} onClick={onSavePolicy}>Save policy</button>
          </div>
        )}
      </Panel>

      <Panel title="Quantum Optimizations (Remediation)">
        <div className="flex items-end gap-2 mb-3">
          <div>
            <label className="block text-cyan-100/50 text-xs mb-1">Effort budget</label>
            <input type="number" min="1" className={inputCls} value={effortBudget} onChange={(e) => setEffortBudget(e.target.value)} />
          </div>
          <button className={btnCls} disabled={optimizing} onClick={onOptimize}>{optimizing ? 'Running…' : 'Run optimizer'}</button>
        </div>
        {optimizeResult && (
          <div className="border border-cyan-300/20 rounded p-3 text-[13px] space-y-1">
            <div>Verdict: <Badge tone={optimizeResult.verdict === 'QUANTUM_BENEFIT_OBSERVED_FOR_THIS_WORKLOAD' ? 'ok' : 'muted'}>{optimizeResult.verdict || 'N/A'}</Badge></div>
            {optimizeResult.note && <div className="text-cyan-100/40">{optimizeResult.note}</div>}
            {optimizeResult.optimizationObjective != null && (
              <div title="The optimizer's own objective value for the selected findings -- not a measured real-world risk reduction.">
                Optimization objective: {optimizeResult.optimizationObjective}
              </div>
            )}
            {optimizeResult.selection?.length > 0 && (
              <ul className="list-disc list-inside text-cyan-100/70">
                {optimizeResult.selection.map((s) => <li key={s.id || s.title}>{s.title || s.id}</li>)}
              </ul>
            )}
          </div>
        )}

        <h3 className="text-cyan-100/70 text-xs tracking-widest uppercase mt-4 mb-2">Recent Benchmarks</h3>
        <div className={tableWrap}>
          <table className="w-full">
            <thead><tr><th className={th}>Source</th><th className={th}>Verdict</th><th className={th}>Created</th></tr></thead>
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

        <h3 className="text-cyan-100/70 text-xs tracking-widest uppercase mt-4 mb-2">Quantum Jobs</h3>
        <div className={tableWrap}>
          <table className="w-full">
            <thead><tr><th className={th}>Provider</th><th className={th}>Mode</th><th className={th}>Status</th><th className={th}>Fallback reason</th><th className={th}>Submitted</th></tr></thead>
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

      <Panel title="Post-Quantum Security">
        <div className="grid sm:grid-cols-4 gap-2 mb-2">
          <select className={inputCls} value={discoverProtocol} onChange={(e) => setDiscoverProtocol(e.target.value)}>
            <option value="TLS">TLS</option>
            <option value="SSH">SSH</option>
          </select>
          <input className={inputCls} placeholder="example.com" value={discoverTarget} onChange={(e) => setDiscoverTarget(e.target.value)} />
          <input className={inputCls} type="number" placeholder={discoverProtocol === 'SSH' ? '22' : '443'} value={discoverPort} onChange={(e) => setDiscoverPort(e.target.value)} />
          <button className={btnCls} disabled={discovering || !discoverTarget.trim()} onClick={onDiscover}>{discovering ? 'Probing…' : 'Discover crypto'}</button>
        </div>
        <p className="text-cyan-100/40 text-xs mb-3">
          TLS/SSH discovery only runs against a target covered by an APPROVED authorized scope — the same authorization bar as starting a scan.
        </p>

        <div className="flex gap-2 mb-4">
          <input className={inputCls} placeholder="eyJhbGciOi... (JWT header only is decoded, never verified)" value={jwtToken} onChange={(e) => setJwtToken(e.target.value)} />
          <button className={btnCls} disabled={jwtDiscovering || !jwtToken.trim()} onClick={onDiscoverJwt}>{jwtDiscovering ? 'Decoding…' : 'Discover JWT alg'}</button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          <Tile label="PQC Readiness Score" value={readiness?.readinessScore ?? '—'} tone={scoreTone(readiness?.readinessScore)} />
          <Tile label="Quantum-Vulnerable" value={readiness?.quantumVulnerableCount ?? '—'} />
          <Tile label="Unclassified" value={readiness?.unclassifiedCount ?? '—'} />
          <Tile label="CBOM Components" value={cbom?.componentCount ?? '—'} />
        </div>
        {readiness?.note && <p className="text-cyan-100/40 text-xs mb-3">{readiness.note}</p>}

        <h3 className="text-cyan-100/70 text-xs tracking-widest uppercase mb-2">Crypto Inventory</h3>
        <div className={tableWrap}>
          <table className="w-full">
            <thead><tr><th className={th}>Target</th><th className={th}>Algorithm</th><th className={th}>Key size</th><th className={th}>Quantum-vulnerable</th><th className={th}>Discovered</th></tr></thead>
            <tbody>
              {inventory.map((f) => (
                <tr key={f.id}>
                  <td className={td}>{f.target}</td>
                  <td className={td}>{f.algorithm_id}</td>
                  <td className={td}>{f.key_size_bits ?? '—'}</td>
                  <td className={td}><Badge tone={f.quantum_vulnerable === true ? 'danger' : f.quantum_vulnerable === false ? 'ok' : 'muted'}>{f.quantum_vulnerable === null ? 'UNKNOWN' : String(f.quantum_vulnerable)}</Badge></td>
                  <td className={td}>{new Date(f.discovered_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <h3 className="text-cyan-100/70 text-xs tracking-widest uppercase mt-4 mb-2">Migration Roadmap</h3>
        <div className={tableWrap}>
          <table className="w-full">
            <thead><tr><th className={th}>Target</th><th className={th}>Algorithm</th><th className={th}>Priority</th><th className={th}>Harvest-now-decrypt-later</th></tr></thead>
            <tbody>
              {(readiness?.roadmap || []).map((r) => (
                <tr key={r.target}>
                  <td className={td}>{r.target}</td>
                  <td className={td}>{r.algorithmId}</td>
                  <td className={td}>{r.priority}</td>
                  <td className={td}>{r.harvestNowDecryptLater ? <Badge tone="warn">future exposure</Badge> : '—'}</td>
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
      ) : (
        <>
          <nav className="hud-panel rounded-xl p-2 flex flex-wrap gap-1">
            {TABS.map((tb) => (
              <button
                key={tb.id}
                onClick={() => setTab(tb.id)}
                className={`px-3 py-1.5 rounded text-[12px] tracking-wide uppercase transition ${
                  tab === tb.id ? 'bg-cyan-400/15 text-cyan-100 border border-cyan-300/40' : 'text-cyan-100/50 hover:text-cyan-100/80'
                }`}
              >
                {tb.label}
              </button>
            ))}
          </nav>

          {tab === 'dashboard' && <DashboardTab />}
          {tab === 'assets' && <AssetsTab />}
          {tab === 'scans' && <ScansTab />}
          {tab === 'findings' && <FindingsTab />}
          {tab === 'reports' && <ReportsTab />}
          {tab === 'engines' && <EnginesTab />}
          {tab === 'quantum' && <QuantumTab />}
        </>
      )}
    </div>
  );
}
