import React, { useEffect, useState } from 'react';
import { ShieldAlert, RefreshCw } from 'lucide-react';
import { api, cyberAnalysisApi } from '../services/api.js';
import { useLang } from '../services/langContext.jsx';

// Cyber Analysis content -- ANATOLIA-Q's surface for BCI (BOLD Cyber
// Intelligence), a separately deployed product (see bci/ and
// server/src/routes/cyberAnalysis.js). Mirrors BCI's own standalone admin
// UI (bci/ui, tabs: Dashboard/Assets/Scopes/Scans/Findings/Reports/Engines/
// Quantum & PQC) inside ANATOLIA-Q's own visual language instead of linking
// out to a separate app -- every tab here goes through ANATOLIA-Q's server,
// which proxies to BCI (services/bciClient.js, api.js's cyberAnalysisApi);
// the browser never talks to BCI directly or holds a BCI token. Never shows
// the names of the third-party scanners BCI orchestrates underneath (spec
// section 56).

const TABS = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'assets', label: 'Assets' },
  { id: 'scopes', label: 'Scopes' },
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

function ScoreTile({ label, value, tone }) {
  return (
    <div className="hud-panel rounded-xl p-4 flex flex-col items-center gap-1">
      <span className="text-cyan-100/60 text-xs tracking-widest uppercase">{label}</span>
      <span className={`text-3xl font-serif ${tone}`}>{value ?? '—'}</span>
    </div>
  );
}

const inputCls = 'w-full bg-black/25 border border-cyan-400/20 rounded px-2.5 py-2 text-[13px] text-cyan-100 focus:border-cyan-300 focus:outline-none';
const btnCls = 'border border-cyan-300/35 text-cyan-100 px-3 py-2 rounded text-[13px] hover:bg-cyan-400/10 disabled:opacity-40 disabled:cursor-not-allowed';
const tableWrap = 'overflow-x-auto';
const th = 'text-left text-[11px] tracking-widest uppercase text-cyan-100/50 px-2 py-2 border-b border-cyan-300/15';
const td = 'text-[13px] text-cyan-100/85 px-2 py-2 border-b border-cyan-300/10';

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

function DashboardTab({ status }) {
  const { t } = useLang();
  const [overview, setOverview] = useState(null);
  const [findings, setFindings] = useState(null);
  const [error, setError] = useState(null);

  async function load() {
    setError(null);
    try {
      const [o, f] = await Promise.all([api.cyberAnalysisOverview(), api.cyberAnalysisFindings()]);
      setOverview(o);
      setFindings(f.findings || []);
    } catch (err) {
      setError(err.message || t('cyberAnalysisUnavailable'));
    }
  }

  useEffect(() => { if (status?.available) load(); }, [status]);

  if (status && !status.available) {
    return (
      <div className="hud-panel rounded-xl p-4 flex items-center gap-3 text-cyan-100/70">
        <ShieldAlert className="w-5 h-5 text-gold" />
        <span>{t('cyberAnalysisNotConfigured')}</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <ErrorNote error={error} />
      {overview && (
        <div className="grid grid-cols-2 gap-4">
          <ScoreTile label="Security Score" value={overview.securityScore?.score} tone={scoreTone(overview.securityScore?.score)} />
          <ScoreTile label="Coverage Score" value={overview.coverageScore?.score} tone={scoreTone(overview.coverageScore?.score)} />
        </div>
      )}
      {findings && (
        <Panel title={`Findings (${findings.length})`}>
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
        </Panel>
      )}
    </div>
  );
}

const ASSET_TYPES = ['DOMAIN', 'HOST', 'WEB_APP', 'API', 'REPOSITORY', 'CONTAINER', 'CLOUD_RESOURCE', 'IDENTITY', 'SERVICE'];
const CRITICALITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

function AssetsTab() {
  const [assets, setAssets] = useState(null);
  const [error, setError] = useState(null);
  const [name, setName] = useState('');
  const [assetType, setAssetType] = useState(ASSET_TYPES[0]);
  const [criticality, setCriticality] = useState('MEDIUM');
  const [saving, setSaving] = useState(false);

  async function load() {
    try {
      const r = await cyberAnalysisApi.listAssets();
      setAssets(r.assets || []);
    } catch (err) {
      setError(err.message);
    }
  }
  useEffect(() => { load(); }, []);

  async function create() {
    if (!name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await cyberAnalysisApi.createAsset({ name: name.trim(), assetType, criticality });
      setName('');
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <ErrorNote error={error} />
      <Panel title="Add Asset">
        <div className="grid sm:grid-cols-4 gap-2">
          <input className={inputCls} placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
          <select className={inputCls} value={assetType} onChange={(e) => setAssetType(e.target.value)}>
            {ASSET_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <select className={inputCls} value={criticality} onChange={(e) => setCriticality(e.target.value)}>
            {CRITICALITIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <button className={btnCls} onClick={create} disabled={saving || !name.trim()}>{saving ? '...' : 'Add'}</button>
        </div>
      </Panel>
      <Panel title={`Assets (${assets?.length ?? 0})`}>
        {!assets ? null : assets.length === 0 ? <p className="text-cyan-100/50 text-sm">No assets yet.</p> : (
          <div className={tableWrap}>
            <table className="w-full">
              <thead><tr><th className={th}>Name</th><th className={th}>Type</th><th className={th}>Criticality</th><th className={th}>Created</th></tr></thead>
              <tbody>
                {assets.map((a) => (
                  <tr key={a.id}>
                    <td className={td}>{a.name}</td>
                    <td className={td}>{a.asset_type}</td>
                    <td className={td}>{a.criticality}</td>
                    <td className={td}>{new Date(a.created_at).toLocaleString()}</td>
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

const TARGET_TYPES = ['DOMAIN', 'SUBDOMAIN', 'URL', 'IP', 'CIDR', 'REPOSITORY', 'API', 'CLOUD_ACCOUNT', 'CONTAINER', 'KUBERNETES_CLUSTER'];
const SCAN_CLASSES = ['PASSIVE', 'SAFE_ACTIVE', 'AUTHENTICATED', 'RESTRICTED'];

function ScopesTab() {
  const [scopes, setScopes] = useState(null);
  const [error, setError] = useState(null);
  const [name, setName] = useState('');
  const [target, setTarget] = useState('');
  const [targetType, setTargetType] = useState(TARGET_TYPES[0]);
  const [allowedClasses, setAllowedClasses] = useState(['PASSIVE']);
  const [saving, setSaving] = useState(false);

  async function load() {
    try {
      const r = await cyberAnalysisApi.listScopes();
      setScopes(r.scopes || []);
    } catch (err) {
      setError(err.message);
    }
  }
  useEffect(() => { load(); }, []);

  async function create() {
    if (!name.trim() || !target.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await cyberAnalysisApi.createScope({ name: name.trim(), target: target.trim(), targetType, allowedScanClasses: allowedClasses, intrusiveness: allowedClasses[0] || 'PASSIVE' });
      setName(''); setTarget('');
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function approve(id) {
    setError(null);
    try { await cyberAnalysisApi.approveScope(id); await load(); } catch (err) { setError(err.message); }
  }
  async function reject(id) {
    setError(null);
    try { await cyberAnalysisApi.rejectScope(id); await load(); } catch (err) { setError(err.message); }
  }

  return (
    <div className="space-y-4">
      <ErrorNote error={error} />
      <Panel title="Propose Scope">
        <p className="text-cyan-100/50 text-xs mb-2">A scan can only run against a target covered by an APPROVED scope.</p>
        <div className="grid sm:grid-cols-5 gap-2 mb-2">
          <input className={inputCls} placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
          <input className={inputCls} placeholder="Target (e.g. example.com)" value={target} onChange={(e) => setTarget(e.target.value)} />
          <select className={inputCls} value={targetType} onChange={(e) => setTargetType(e.target.value)}>
            {TARGET_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <select className={inputCls} value={allowedClasses[0]} onChange={(e) => setAllowedClasses([e.target.value])}>
            {SCAN_CLASSES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <button className={btnCls} onClick={create} disabled={saving || !name.trim() || !target.trim()}>{saving ? '...' : 'Propose'}</button>
        </div>
      </Panel>
      <Panel title={`Scopes (${scopes?.length ?? 0})`}>
        {!scopes ? null : scopes.length === 0 ? <p className="text-cyan-100/50 text-sm">No scopes yet.</p> : (
          <div className={tableWrap}>
            <table className="w-full">
              <thead><tr><th className={th}>Name</th><th className={th}>Target</th><th className={th}>Status</th><th className={th}></th></tr></thead>
              <tbody>
                {scopes.map((s) => (
                  <tr key={s.id}>
                    <td className={td}>{s.name}</td>
                    <td className={td}>{s.target} <span className="text-cyan-100/40">({s.target_type})</span></td>
                    <td className={td}>
                      <span className={s.status === 'APPROVED' ? 'text-emerald-300' : s.status === 'REJECTED' ? 'text-red-400' : 'text-gold'}>{s.status}</span>
                    </td>
                    <td className={td}>
                      {s.status === 'PENDING' && (
                        <div className="flex gap-2">
                          <button className={btnCls} onClick={() => approve(s.id)}>Approve</button>
                          <button className={btnCls} onClick={() => reject(s.id)}>Reject</button>
                        </div>
                      )}
                    </td>
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

function ScansTab() {
  const [scans, setScans] = useState(null);
  const [error, setError] = useState(null);
  const [target, setTarget] = useState('');
  const [requestedClass, setRequestedClass] = useState(SCAN_CLASSES[0]);
  const [saving, setSaving] = useState(false);

  async function load() {
    try {
      const r = await cyberAnalysisApi.listScans();
      setScans(r.jobs || []);
    } catch (err) {
      setError(err.message);
    }
  }
  useEffect(() => { load(); }, []);

  async function create() {
    if (!target.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await cyberAnalysisApi.createScan({ target: target.trim(), requestedClass });
      setTarget('');
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function cancel(id) {
    setError(null);
    try { await cyberAnalysisApi.cancelScan(id); await load(); } catch (err) { setError(err.message); }
  }

  return (
    <div className="space-y-4">
      <ErrorNote error={error} />
      <Panel title="Start Scan">
        <p className="text-cyan-100/50 text-xs mb-2">Requires an APPROVED scope covering this target -- see the Scopes tab.</p>
        <div className="grid sm:grid-cols-3 gap-2">
          <input className={inputCls} placeholder="Target" value={target} onChange={(e) => setTarget(e.target.value)} />
          <select className={inputCls} value={requestedClass} onChange={(e) => setRequestedClass(e.target.value)}>
            {SCAN_CLASSES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <button className={btnCls} onClick={create} disabled={saving || !target.trim()}>{saving ? '...' : 'Start Scan'}</button>
        </div>
      </Panel>
      <Panel title={`Scans (${scans?.length ?? 0})`}>
        {!scans ? null : scans.length === 0 ? <p className="text-cyan-100/50 text-sm">No scans yet.</p> : (
          <div className={tableWrap}>
            <table className="w-full">
              <thead><tr><th className={th}>Target</th><th className={th}>Status</th><th className={th}>Created</th><th className={th}></th></tr></thead>
              <tbody>
                {scans.map((j) => (
                  <tr key={j.id}>
                    <td className={td}>{j.target}</td>
                    <td className={td}>{j.status}</td>
                    <td className={td}>{j.created_at ? new Date(j.created_at).toLocaleString() : '—'}</td>
                    <td className={td}>
                      {['PENDING', 'RUNNING'].includes(j.status) && (
                        <button className={btnCls} onClick={() => cancel(j.id)}>Cancel</button>
                      )}
                    </td>
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

function FindingsTab() {
  const { t } = useLang();
  const [findings, setFindings] = useState(null);
  const [error, setError] = useState(null);

  async function load() {
    try {
      const r = await api.cyberAnalysisFindings();
      setFindings(r.findings || []);
    } catch (err) {
      setError(err.message);
    }
  }
  useEffect(() => { load(); }, []);

  async function act(id, fn) {
    setError(null);
    try { await fn(id); await load(); } catch (err) { setError(err.message); }
  }

  return (
    <div className="space-y-4">
      <ErrorNote error={error} />
      <Panel title={`Findings (${findings?.length ?? 0})`}>
        {!findings ? null : findings.length === 0 ? <p className="text-cyan-100/50 text-sm">{t('cyberAnalysisNoFindings')}</p> : (
          <div className="space-y-2">
            {findings.map((f) => (
              <div key={f.id} className="border border-cyan-300/20 rounded p-3 flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <p className="text-cyan-100 text-sm">{f.title}</p>
                  <p className="text-cyan-100/50 text-xs">{f.target} · {f.category}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-gold text-sm">{f.priority || '—'}</span>
                  <button className={btnCls} onClick={() => act(f.id, cyberAnalysisApi.confirmFinding)}>Confirm</button>
                  <button className={btnCls} onClick={() => act(f.id, cyberAnalysisApi.markFalsePositive)}>False Positive</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}

const REPORT_TYPES = ['EXECUTIVE', 'TECHNICAL', 'REMEDIATION', 'AUDIT'];

function ReportsTab() {
  const [reports, setReports] = useState(null);
  const [error, setError] = useState(null);
  const [reportType, setReportType] = useState(REPORT_TYPES[0]);
  const [saving, setSaving] = useState(false);

  async function load() {
    try {
      const r = await cyberAnalysisApi.listReports();
      setReports(r.reports || []);
    } catch (err) {
      setError(err.message);
    }
  }
  useEffect(() => { load(); }, []);

  async function generate() {
    setSaving(true);
    setError(null);
    try {
      await cyberAnalysisApi.generateReport(reportType);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <ErrorNote error={error} />
      <Panel title="Generate Report">
        <div className="grid sm:grid-cols-3 gap-2">
          <select className={inputCls} value={reportType} onChange={(e) => setReportType(e.target.value)}>
            {REPORT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <button className={btnCls} onClick={generate} disabled={saving}>{saving ? '...' : 'Generate'}</button>
        </div>
      </Panel>
      <Panel title={`Reports (${reports?.length ?? 0})`}>
        {!reports ? null : reports.length === 0 ? <p className="text-cyan-100/50 text-sm">No reports yet.</p> : (
          <div className={tableWrap}>
            <table className="w-full">
              <thead><tr><th className={th}>Type</th><th className={th}>Created</th></tr></thead>
              <tbody>
                {reports.map((r) => (
                  <tr key={r.id}>
                    <td className={td}>{r.report_type}</td>
                    <td className={td}>{r.created_at ? new Date(r.created_at).toLocaleString() : '—'}</td>
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

function EnginesTab() {
  const [engines, setEngines] = useState(null);
  const [error, setError] = useState(null);
  const [running, setRunning] = useState(false);

  async function load() {
    try {
      const r = await cyberAnalysisApi.listEngines();
      setEngines(r.engines || []);
    } catch (err) {
      setError(err.message);
    }
  }
  useEffect(() => { load(); }, []);

  async function healthCheck() {
    setRunning(true);
    setError(null);
    try {
      await cyberAnalysisApi.runEngineHealthCheck();
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="space-y-4">
      <ErrorNote error={error} />
      <Panel title={`Engines (${engines?.length ?? 0})`} actions={
        <button className={btnCls} onClick={healthCheck} disabled={running}>{running ? '...' : 'Run Health Check'}</button>
      }>
        {!engines ? null : engines.length === 0 ? <p className="text-cyan-100/50 text-sm">No engines registered.</p> : (
          <div className={tableWrap}>
            <table className="w-full">
              <thead><tr><th className={th}>Engine</th><th className={th}>Status</th><th className={th}>Intrusiveness</th></tr></thead>
              <tbody>
                {engines.map((e) => (
                  <tr key={e.id}>
                    <td className={td}>{e.name || e.id}</td>
                    <td className={td}>
                      <span className={e.status === 'ONLINE' ? 'text-emerald-300' : 'text-red-400'}>{e.status || '—'}</span>
                    </td>
                    <td className={td}>{e.intrusiveness || '—'}</td>
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

function QuantumTab() {
  const [providers, setProviders] = useState(null);
  const [error, setError] = useState(null);
  const [target, setTarget] = useState('');
  const [port, setPort] = useState('443');
  const [discovering, setDiscovering] = useState(false);
  const [inventory, setInventory] = useState(null);
  const [readiness, setReadiness] = useState(null);

  async function load() {
    try {
      const [p, inv, rd] = await Promise.all([
        cyberAnalysisApi.listQuantumProviders(),
        cyberAnalysisApi.listCryptoInventory(),
        cyberAnalysisApi.getPqcReadiness(),
      ]);
      setProviders(p.providers || []);
      setInventory(inv.inventory || []);
      setReadiness(rd);
    } catch (err) {
      setError(err.message);
    }
  }
  useEffect(() => { load(); }, []);

  async function discover() {
    if (!target.trim()) return;
    setDiscovering(true);
    setError(null);
    try {
      await cyberAnalysisApi.discoverCrypto(target.trim(), port ? Number(port) : undefined);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setDiscovering(false);
    }
  }

  return (
    <div className="space-y-4">
      <ErrorNote error={error} />
      <Panel title="Quantum Compute Gateway">
        {!providers ? null : (
          <div className={tableWrap}>
            <table className="w-full">
              <thead><tr><th className={th}>Provider</th><th className={th}>Health</th></tr></thead>
              <tbody>
                {providers.map((p) => (
                  <tr key={p.id || p.provider}>
                    <td className={td}>{p.id || p.provider}</td>
                    <td className={td}>
                      <span className={p.status === 'AVAILABLE' ? 'text-emerald-300' : 'text-cyan-100/50'}>{p.status || '—'}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      <Panel title="Post-Quantum Security -- Discover Crypto">
        <p className="text-cyan-100/50 text-xs mb-2">Discovery only runs against a target covered by an APPROVED authorized scope (Scopes tab) -- same rule as starting a scan.</p>
        <div className="grid sm:grid-cols-3 gap-2 mb-4">
          <input className={inputCls} placeholder="Target (TLS host)" value={target} onChange={(e) => setTarget(e.target.value)} />
          <input className={inputCls} placeholder="Port" value={port} onChange={(e) => setPort(e.target.value)} />
          <button className={btnCls} onClick={discover} disabled={discovering || !target.trim()}>{discovering ? '...' : 'Discover'}</button>
        </div>
        {readiness && (
          <div className="grid grid-cols-2 gap-3 mb-4">
            <ScoreTile label="PQC Readiness" value={readiness.score ?? '—'} tone={scoreTone(readiness.score)} />
            <ScoreTile label="Quantum-Vulnerable" value={readiness.quantumVulnerableCount ?? inventory?.filter((i) => i.quantum_vulnerable).length ?? 0} tone="text-red-400" />
          </div>
        )}
        {inventory && inventory.length > 0 && (
          <div className={tableWrap}>
            <table className="w-full">
              <thead><tr><th className={th}>Target</th><th className={th}>Algorithm</th><th className={th}>Quantum-Vulnerable</th></tr></thead>
              <tbody>
                {inventory.map((c, i) => (
                  <tr key={i}>
                    <td className={td}>{c.target}</td>
                    <td className={td}>{c.algorithm}</td>
                    <td className={td}>
                      <span className={c.quantum_vulnerable ? 'text-red-400' : 'text-emerald-300'}>{String(Boolean(c.quantum_vulnerable))}</span>
                    </td>
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

          {tab === 'dashboard' && <DashboardTab status={status} />}
          {tab === 'assets' && <AssetsTab />}
          {tab === 'scopes' && <ScopesTab />}
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
