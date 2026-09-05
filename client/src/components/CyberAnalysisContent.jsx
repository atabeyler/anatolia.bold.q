import React, { useEffect, useState } from 'react';
import { ShieldAlert, RefreshCw, ChevronLeft, ChevronRight } from 'lucide-react';
import { api, cyberAnalysisApi } from '../services/api.js';
import { useLang } from '../services/langContext.jsx';
import CyberNewAnalysisWizard from './CyberNewAnalysisWizard.jsx';

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

// "flow" is the real operational journey (Command Center -> Assets ->
// Scans -> Findings -> Reports) -- Enter/Esc/Prev/Next only ever step
// through this group. "technical" (Engines, Quantum & PQC) are standalone
// status/config panels with no sequence to them; reachable from the
// sidebar but outside the guided flow, matching the product rule that
// Motorlar/Quantum must never look like analysis steps in the main nav.
function useTabs(t) {
  return [
    { id: 'dashboard', navKey: 'cyberCommandCenter', titleKey: 'cyberCommandCenter', group: 'flow' },
    { id: 'assets', navKey: 'cyberNavAssets', titleKey: 'cyberNavAssets', group: 'flow' },
    { id: 'scans', navKey: 'cyberNavScans', titleKey: 'cyberNavScans', group: 'flow' },
    { id: 'findings', navKey: 'cyberNavFindings', titleKey: 'cyberNavFindings', group: 'flow' },
    { id: 'reports', navKey: 'cyberNavReports', titleKey: 'cyberNavReports', group: 'flow' },
    { id: 'engines', navKey: 'cyberNavEngines', titleKey: 'cyberNavEngines', group: 'technical' },
    { id: 'quantum', navKey: 'cyberNavQuantum', titleKey: 'cyberTitleQuantum', group: 'technical' },
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

// ─── Komuta Merkezi (Command Center) ───────────────────────────────────
// Every number here comes from an existing, already-real endpoint --
// nothing new is fabricated for this screen. Aggregation (counts, "in
// progress" vs "recently completed", critical/high vs everything else)
// happens client-side over real list responses (assets/scans/findings/
// reports/engines), the same data every other tab already reads.
const IN_PROGRESS_SCAN_STATUSES = ['QUEUED', 'DISCOVERY', 'ANALYZING', 'NORMALIZING', 'VERIFYING', 'CORRELATING', 'SCORING', 'REPORTING'];
const HIGH_PRIORITY_LEVELS = ['IMMEDIATE', '24_HOURS', 'HIGH_PRIORITY'];

function DashboardTab({ t, onNewAnalysis }) {
  const [security, setSecurity] = useState(null);
  const [coverage, setCoverage] = useState(null);
  const [activeAssetCount, setActiveAssetCount] = useState(null);
  const [criticalHighCount, setCriticalHighCount] = useState(null);
  const [inProgressScans, setInProgressScans] = useState(null);
  const [recentScans, setRecentScans] = useState(null);
  const [recentReports, setRecentReports] = useState(null);
  const [offlineEngineCount, setOfflineEngineCount] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.cyberAnalysisOverview()
      .then((o) => { setSecurity(o.securityScore); setCoverage(o.coverageScore); })
      .catch((err) => setError(err.message));
    cyberAnalysisApi.listAssets('ACTIVE').then((r) => setActiveAssetCount(r.assets.length)).catch(() => {});
    api.cyberAnalysisFindings().then((r) => {
      setCriticalHighCount(r.findings.filter((f) => HIGH_PRIORITY_LEVELS.includes(f.priority)).length);
    }).catch(() => {});
    cyberAnalysisApi.listScans().then((r) => {
      setInProgressScans(r.jobs.filter((j) => IN_PROGRESS_SCAN_STATUSES.includes(j.status)));
      setRecentScans(r.jobs.filter((j) => j.status === 'COMPLETED').slice(0, 5));
    }).catch(() => {});
    cyberAnalysisApi.listReports().then((r) => setRecentReports(r.reports.slice(0, 5))).catch(() => {});
    cyberAnalysisApi.listEngines().then((r) => {
      setOfflineEngineCount(r.engines.filter((e) => e.status === 'OFFLINE' || e.status === 'DEGRADED').length);
    }).catch(() => {});
  }, []);

  return (
    <div className="space-y-4">
      <PageTitle>{t('cyberCommandCenter')}</PageTitle>
      <ErrorNote error={error} />

      {offlineEngineCount === 0 ? (
        <div className="hud-panel rounded-xl p-3 text-emerald-300 text-[13px] tracking-wide text-center">{t('cyberSystemOperational')}</div>
      ) : offlineEngineCount > 0 ? (
        <div className="hud-panel rounded-xl p-3 border border-gold/30 text-gold text-[13px] text-center">{t('cyberSystemDegraded', { count: offlineEngineCount })}</div>
      ) : null}

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        <Tile label={t('cyberSecurityScore')} value={security?.score} tone={scoreTone(security?.score)} />
        <div className="hud-panel rounded-xl p-4 flex flex-col items-center gap-1">
          <span className="text-cyan-100/60 text-xs tracking-widest uppercase">{t('cyberCoverageScore')}</span>
          <span className={`text-3xl font-serif ${scoreTone(coverage?.score)}`}>{coverage?.score ?? '—'}</span>
          {coverage?.reason && <span className="text-cyan-100/40 text-[11px]">{coverage.reason}</span>}
        </div>
        <Tile label={t('cyberOpenFindings')} value={security?.openFindingCount} />
        <Tile label={t('cyberActiveAssets')} value={activeAssetCount} />
        <Tile label={t('cyberCriticalHighRisks')} value={criticalHighCount} tone={criticalHighCount > 0 ? 'text-red-400' : undefined} />
        <Tile label={t('cyberInProgressAnalyses')} value={inProgressScans?.length} />
      </div>

      <button onClick={onNewAnalysis} className={`${btnPrimaryCls} w-full text-center py-3 text-sm tracking-widest`}>
        {t('cyberNewAnalysis')}
      </button>

      <Panel title={t('cyberRecentAnalyses')}>
        {recentScans && (recentScans.length === 0 ? (
          <p className="text-cyan-100/40 text-sm">{t('cyberNoneYet')}</p>
        ) : (
          <div className={tableWrap}>
            <table className="w-full">
              <thead><tr><th className={th}>{t('cyberColTarget')}</th><th className={th}>{t('cyberColClass')}</th><th className={th}>{t('cyberColStatus')}</th></tr></thead>
              <tbody>
                {recentScans.map((j) => (
                  <tr key={j.id}>
                    <td className={td}>{j.target}</td>
                    <td className={td}>{j.requested_class}</td>
                    <td className={td}><Badge tone={scanStatusTone(j.status)}>{scanStatusLabel(t, j.status)}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </Panel>

      <Panel title={t('cyberRecentReports')}>
        {recentReports && (recentReports.length === 0 ? (
          <p className="text-cyan-100/40 text-sm">{t('cyberNoneYet')}</p>
        ) : (
          <div className={tableWrap}>
            <table className="w-full">
              <thead><tr><th className={th}>{t('cyberColType')}</th><th className={th}>{t('cyberColGenerated')}</th></tr></thead>
              <tbody>
                {recentReports.map((r) => (
                  <tr key={r.id}>
                    <td className={td}>{r.report_type}</td>
                    <td className={td}>{new Date(r.created_at).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </Panel>
    </div>
  );
}

// ─── Assets ─────────────────────────────────────────────────────────────
const ASSET_TYPES = ['DOMAIN', 'HOST', 'WEB_APP', 'API', 'REPOSITORY', 'CONTAINER', 'CLOUD_RESOURCE', 'IDENTITY', 'SERVICE'];
// Real target strings go into asset_identifiers (bci/src/routes/assets.js),
// not a column on assets itself -- risk.js/coverageScore.js/securityGraph.js
// etc. already find "which asset does this scan/finding belong to" by
// matching asset_identifiers.value against the target string, so this
// identifier_type is just a readable label alongside that value, never
// consulted by the matching itself. Loosely mirrors the identifier_type
// examples in 0004_assets.sql's own comment (DOMAIN/IP/CIDR/REPO_URL/
// CLOUD_ACCOUNT_ID).
const IDENTIFIER_TYPE_BY_ASSET_TYPE = {
  DOMAIN: 'DOMAIN',
  HOST: 'IP',
  WEB_APP: 'URL',
  API: 'URL',
  REPOSITORY: 'REPO_URL',
  CONTAINER: 'IMAGE',
  CLOUD_RESOURCE: 'CLOUD_ACCOUNT_ID',
  IDENTITY: 'IDENTITY',
  SERVICE: 'SERVICE',
};

// priorityTone is defined once, below, in the Findings section -- reused
// here too (function declarations hoist) since asset detail's priority
// breakdown uses BCI's same priority scale.

// Inline confirm bar rather than a native window.confirm() -- consistent
// with the rest of this UI (no browser-chrome dialogs anywhere else) and
// keeps the "reversible, no data lost" wording directly next to the action
// instead of a terse browser prompt.
function ConfirmBar({ body, confirmLabel, cancelLabel, onConfirm, onCancel }) {
  return (
    <div className="border border-gold/30 rounded p-3 flex flex-col sm:flex-row sm:items-center gap-2 justify-between">
      <p className="text-cyan-100/80 text-[13px]">{body}</p>
      <div className="flex gap-2 shrink-0">
        <button className={btnPrimaryCls} onClick={onConfirm}>{confirmLabel}</button>
        <button className={btnCls} onClick={onCancel}>{cancelLabel}</button>
      </div>
    </div>
  );
}

function AssetDetail({ id, t, onClose, onChanged, onStartScan }) {
  const [asset, setAsset] = useState(null);
  const [summary, setSummary] = useState(null);
  const [history, setHistory] = useState(null);
  const [reports, setReports] = useState(null);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [editCriticality, setEditCriticality] = useState('MEDIUM');
  const [saving, setSaving] = useState(false);
  const [generatingReport, setGeneratingReport] = useState(false);
  const [confirmingStatus, setConfirmingStatus] = useState(null); // 'ARCHIVED' | 'ACTIVE' | null

  function load() {
    Promise.all([cyberAnalysisApi.getAsset(id), cyberAnalysisApi.getAssetSummary(id)])
      .then(([a, s]) => {
        setAsset(a);
        setSummary(s.summary);
        setEditName(a.asset.name);
        setEditCriticality(a.asset.criticality);
      })
      .catch((err) => setError(err.message));
    cyberAnalysisApi.getAssetHistory(id).then((r) => setHistory(r.history)).catch(() => {});
    cyberAnalysisApi.listReports(id).then((r) => setReports(r.reports)).catch(() => {});
  }
  useEffect(load, [id]);

  async function onGenerateReport(reportType) {
    setGeneratingReport(true);
    setError(null);
    try {
      await cyberAnalysisApi.generateReport(reportType, { assetId: id });
      cyberAnalysisApi.listReports(id).then((r) => setReports(r.reports));
    } catch (err) {
      setError(err.message);
    } finally {
      setGeneratingReport(false);
    }
  }

  async function saveEdit() {
    if (!editName.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await cyberAnalysisApi.updateAsset(id, { name: editName.trim(), criticality: editCriticality });
      setEditing(false);
      load();
      onChanged?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function applyStatus(status) {
    setSaving(true);
    setError(null);
    try {
      await cyberAnalysisApi.updateAsset(id, { status });
      setConfirmingStatus(null);
      load();
      onChanged?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (!asset) return <div className="hud-panel rounded-xl p-4 text-cyan-100/60 text-sm">{t('cyberLoading')}</div>;
  const { asset: a, identifiers, technologies } = asset;
  const primaryTarget = identifiers[0]?.value ?? null;

  return (
    <div className="hud-panel rounded-xl p-4 sm:p-5 space-y-3">
      <div className="flex justify-between items-start gap-3">
        <div>
          <h3 className="text-cyan-100 text-sm flex items-center gap-2">
            {a.name}
            {a.status === 'ARCHIVED' && <Badge tone="warn">{t('cyberArchivedBadge')}</Badge>}
          </h3>
          <p className="text-cyan-100/50 text-xs">{a.asset_type} · {t('cyberColCreated')}: {new Date(a.created_at).toLocaleString()}</p>
        </div>
        <button className={btnCls} onClick={onClose}>{t('cyberClose')}</button>
      </div>
      <ErrorNote error={error} />

      {editing ? (
        <div className="grid sm:grid-cols-3 gap-2 items-end border border-cyan-300/15 rounded p-3">
          <div>
            <label className="block text-cyan-100/50 text-xs mb-1">{t('cyberColName')}</label>
            <input className={inputCls} value={editName} onChange={(e) => setEditName(e.target.value)} />
          </div>
          <div>
            <label className="block text-cyan-100/50 text-xs mb-1">{t('cyberColCriticality')}</label>
            <select className={inputCls} value={editCriticality} onChange={(e) => setEditCriticality(e.target.value)}>
              {['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="flex gap-2">
            <button className={btnPrimaryCls} disabled={saving || !editName.trim()} onClick={saveEdit}>{t('cyberSaveChanges')}</button>
            <button className={btnCls} onClick={() => setEditing(false)}>{t('cyberCancel')}</button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <Tile label={t('cyberColCriticality')} value={a.criticality} />
          <Tile label={t('cyberFindingCount')} value={summary?.findingCount ?? '—'} />
          <Tile label={t('cyberOpenFindings')} value={summary?.openFindingCount ?? '—'} />
          <Tile label={t('cyberRiskScoreLabel')} value={summary?.riskScore ?? '—'} tone={scoreTone(summary?.riskScore)} />
        </div>
      )}

      <div>
        <h4 className="text-cyan-100/70 text-xs tracking-widest uppercase mb-1">{t('cyberLastScan')}</h4>
        {summary?.lastScan ? (
          <p className="text-cyan-100/80 text-[13px]">
            {new Date(summary.lastScan.created_at).toLocaleString()} · <Badge tone={scanStatusTone(summary.lastScan.status)}>{scanStatusLabel(t, summary.lastScan.status)}</Badge>
          </p>
        ) : (
          <p className="text-cyan-100/40 text-[13px]">{t('cyberNeverScanned')}</p>
        )}
      </div>

      {summary && Object.keys(summary.priorityBreakdown).length > 0 && (
        <div>
          <h4 className="text-cyan-100/70 text-xs tracking-widest uppercase mb-1">{t('cyberPriorityBreakdown')}</h4>
          <div className="flex flex-wrap gap-2">
            {Object.entries(summary.priorityBreakdown).map(([priority, count]) => (
              <Badge key={priority} tone={priorityTone(priority)}>{priority}: {count}</Badge>
            ))}
          </div>
        </div>
      )}

      <div>
        <h4 className="text-cyan-100/70 text-xs tracking-widest uppercase mb-1">{t('cyberIdentifiers')}</h4>
        <p className="text-cyan-100/80 text-[13px]">{identifiers.length ? identifiers.map((i) => `${i.identifier_type}: ${i.value}`).join(' · ') : t('cyberNoIdentifiers')}</p>
      </div>
      {technologies.length > 0 && (
        <div>
          <h4 className="text-cyan-100/70 text-xs tracking-widest uppercase mb-1">{t('cyberTechnologies')}</h4>
          <p className="text-cyan-100/80 text-[13px]">{technologies.map((tc) => tc.version ? `${tc.name} ${tc.version}` : tc.name).join(' · ')}</p>
        </div>
      )}

      <div>
        <h4 className="text-cyan-100/70 text-xs tracking-widest uppercase mb-1">{t('cyberAnalysisHistory')}</h4>
        {history && (history.length === 0 ? (
          <p className="text-cyan-100/40 text-[13px]">{t('cyberNoHistoryYet')}</p>
        ) : (
          <div className={tableWrap}>
            <table className="w-full">
              <thead><tr><th className={th}>{t('cyberColCreated')}</th><th className={th}>{t('cyberRiskScoreLabel')}</th><th className={th}>{t('cyberOpenFindings')}</th></tr></thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.id}>
                    <td className={td}>{new Date(h.computed_at).toLocaleString()}</td>
                    <td className={td}><span className={scoreTone(h.risk_score)}>{h.risk_score ?? '—'}</span></td>
                    <td className={td}>{h.open_finding_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>

      <div>
        <div className="flex items-center justify-between mb-1">
          <h4 className="text-cyan-100/70 text-xs tracking-widest uppercase">{t('cyberColReportsForAsset')}</h4>
        </div>
        <div className="flex gap-1.5 flex-wrap mb-2">
          {REPORT_TYPES.filter((rt) => rt !== 'AUDIT').map((rt) => (
            <button key={rt} className={btnCls} disabled={generatingReport} onClick={() => onGenerateReport(rt)}>{t('cyberGenerateBtn', { type: rt })}</button>
          ))}
        </div>
        {reports && (reports.length === 0 ? (
          <p className="text-cyan-100/40 text-[13px]">{t('cyberNoneYet')}</p>
        ) : (
          <div className={tableWrap}>
            <table className="w-full">
              <thead><tr><th className={th}>{t('cyberColType')}</th><th className={th}>{t('cyberColGenerated')}</th></tr></thead>
              <tbody>
                {reports.map((r) => (
                  <tr key={r.id}>
                    <td className={td}>{r.report_type}</td>
                    <td className={td}>{new Date(r.created_at).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>

      {confirmingStatus && (
        <ConfirmBar
          body={confirmingStatus === 'ARCHIVED' ? t('cyberConfirmArchiveBody') : t('cyberConfirmRestoreBody')}
          confirmLabel={confirmingStatus === 'ARCHIVED' ? t('cyberYesArchive') : t('cyberYesRestore')}
          cancelLabel={t('cyberCancel')}
          onConfirm={() => applyStatus(confirmingStatus)}
          onCancel={() => setConfirmingStatus(null)}
        />
      )}

      <div className="flex gap-2 flex-wrap pt-2 border-t border-cyan-300/10">
        <button
          className={btnPrimaryCls}
          disabled={!primaryTarget}
          title={primaryTarget ? undefined : t('cyberNoTargetYet')}
          onClick={() => primaryTarget && onStartScan(primaryTarget)}
        >
          {t('cyberStartScanBtn')}
        </button>
        {!editing && <button className={btnCls} onClick={() => setEditing(true)}>{t('cyberEdit')}</button>}
        {a.status === 'ACTIVE' ? (
          <button className={btnCls} onClick={() => setConfirmingStatus('ARCHIVED')}>{t('cyberArchive')}</button>
        ) : (
          <button className={btnCls} onClick={() => setConfirmingStatus('ACTIVE')}>{t('cyberRestore')}</button>
        )}
      </div>
    </div>
  );
}

function AssetsTab({ t, onValidityChange, onStartScan }) {
  const [assets, setAssets] = useState(null);
  const [error, setError] = useState(null);
  const [name, setName] = useState('');
  const [target, setTarget] = useState('');
  const [assetType, setAssetType] = useState(ASSET_TYPES[0]);
  const [creating, setCreating] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [selectedId, setSelectedId] = useState(null);

  function load() {
    cyberAnalysisApi.listAssets(showArchived ? 'ARCHIVED' : 'ACTIVE').then((r) => setAssets(r.assets)).catch((err) => setError(err.message));
  }
  useEffect(load, [showArchived]);

  // The wizard's Next/Enter only unlocks once this step's required fields
  // (name + a real target to register as the asset's first identifier) are
  // actually filled in.
  useEffect(() => { onValidityChange?.(name.trim().length > 0 && target.trim().length > 0); }, [name, target]);

  async function onCreate() {
    if (!name.trim() || !target.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const { asset } = await cyberAnalysisApi.createAsset({ name: name.trim(), assetType });
      // A real target/identifier is what lets risk scoring, coverage score,
      // the security graph, and "Start Scan" below all find this asset --
      // without it the asset would just be an inert name+type row, invisible
      // to the rest of BCI's intelligence pipeline (see IDENTIFIER_TYPE_BY_
      // ASSET_TYPE above).
      await cyberAnalysisApi.addAssetIdentifier(asset.id, {
        identifierType: IDENTIFIER_TYPE_BY_ASSET_TYPE[assetType] || assetType,
        value: target.trim(),
      });
      setName('');
      setTarget('');
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
      {selectedId && (
        <AssetDetail
          id={selectedId}
          t={t}
          onClose={() => setSelectedId(null)}
          onChanged={load}
          onStartScan={(startTarget) => { setSelectedId(null); onStartScan(startTarget); }}
        />
      )}
      <Panel title={t('cyberAddAsset')}>
        <div className="grid sm:grid-cols-4 gap-2">
          <input className={inputCls} placeholder={t('cyberNamePlaceholder')} value={name} onChange={(e) => setName(e.target.value)} />
          <input className={inputCls} placeholder={t('cyberAssetTargetPlaceholder')} value={target} onChange={(e) => setTarget(e.target.value)} />
          <select className={inputCls} value={assetType} onChange={(e) => setAssetType(e.target.value)}>
            {ASSET_TYPES.map((at) => <option key={at} value={at}>{at}</option>)}
          </select>
          <button className={btnCls} onClick={onCreate} disabled={creating || !name.trim() || !target.trim()}>{t('cyberAddAssetBtn')}</button>
        </div>
      </Panel>
      <Panel
        title={t('cyberAssetsPanelTitle')}
        actions={
          <label className="flex items-center gap-2 text-[12px] text-cyan-100/60">
            <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
            {t('cyberShowArchived')}
          </label>
        }
      >
        {assets && (
          <div className={tableWrap}>
            <table className="w-full">
              <thead>
                <tr>
                  <th className={th}>{t('cyberColName')}</th>
                  <th className={th}>{t('cyberColTarget')}</th>
                  <th className={th}>{t('cyberColType')}</th>
                  <th className={th}>{t('cyberColCriticality')}</th>
                  <th className={th}>{t('cyberColActions')}</th>
                </tr>
              </thead>
              <tbody>
                {assets.map((a) => (
                  <tr key={a.id}>
                    <td className={td}>{a.name}</td>
                    <td className={`${td} text-cyan-100/60`}>{a.target || '—'}</td>
                    <td className={td}>{a.asset_type}</td>
                    <td className={td}>{a.criticality}</td>
                    <td className={td}>
                      <div className="flex gap-1.5 flex-wrap">
                        <button className={btnCls} onClick={() => setSelectedId(a.id)}>{t('cyberSelect')}</button>
                        <button
                          className={btnCls}
                          disabled={!a.target}
                          title={a.target ? undefined : t('cyberNoTargetYet')}
                          onClick={() => a.target && onStartScan(a.target)}
                        >
                          {t('cyberStartScanBtn')}
                        </button>
                      </div>
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

// ─── Scans ──────────────────────────────────────────────────────────────
const SCAN_CLASSES = ['PASSIVE', 'SAFE_ACTIVE', 'AUTHENTICATED', 'RESTRICTED'];

// NO_COVERAGE is its own real backend status (see bci/src/worker.js) --
// the job function finished without error, but analysisPlanner.js selected
// zero engines for this target type/class (e.g. DOMAIN + PASSIVE), so
// nothing was actually analyzed. It must never render the same as
// COMPLETED (which now only ever means at least one engine really ran) --
// "0 findings because nothing ran" and "0 findings because a real scan
// found nothing" are different facts and must look different.
function scanStatusTone(status) {
  if (status === 'COMPLETED') return 'ok';
  if (status === 'NO_COVERAGE') return 'warn';
  if (['FAILED', 'TIMED_OUT', 'CANCELLED'].includes(status)) return 'danger';
  return 'warn';
}

function scanStatusLabel(t, status) {
  return status === 'NO_COVERAGE' ? t('cyberScanNoCoverage') : status;
}

const SCAN_TERMINAL_STATUSES = ['COMPLETED', 'NO_COVERAGE', 'FAILED', 'TIMED_OUT', 'CANCELLED'];
const SCAN_POLL_INTERVAL_MS = 3000;
const SCAN_POLL_MAX_ATTEMPTS = 60; // ~3 minutes

function ScansTab({ t, onScanCompleted, onValidityChange, initialTarget, onInitialTargetConsumed }) {
  const [jobs, setJobs] = useState(null);
  // Lazy initializer: reads the asset's target exactly once, at the moment
  // "Start Scan" on an asset remounts this tab -- a manual sidebar switch
  // back to Scans later must not keep re-prefilling a stale asset target
  // over whatever the user is now typing, see onInitialTargetConsumed below.
  const [target, setTarget] = useState(() => initialTarget || '');
  const [requestedClass, setRequestedClass] = useState('PASSIVE');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [pendingJobId, setPendingJobId] = useState(null);
  // onCreate() clears the target input right after a successful submit
  // (below) -- without this flag, that would immediately re-trigger the
  // validity effect with an now-empty field and disable Next/Enter right
  // after the user just completed the step's real action.
  const [hasSubmittedOnce, setHasSubmittedOnce] = useState(false);

  useEffect(() => {
    if (initialTarget) onInitialTargetConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function load() {
    cyberAnalysisApi.listScans().then((r) => setJobs(r.jobs)).catch((err) => setError(err.message));
  }
  useEffect(load, []);

  // The wizard's Next/Enter only unlocks once this step's required field
  // (the scan target) is actually filled in -- or a scan has already been
  // started this visit, since that's the step's real completion condition.
  useEffect(() => { onValidityChange?.(target.trim().length > 0 || hasSubmittedOnce); }, [target, hasSubmittedOnce]);

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
      setHasSubmittedOnce(true);
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
                  <React.Fragment key={j.id}>
                    <tr>
                      <td className={td}>{j.target}</td>
                      <td className={td}>{j.requested_class}</td>
                      <td className={td}><Badge tone={scanStatusTone(j.status)}>{scanStatusLabel(t, j.status)}</Badge></td>
                      <td className={td}>{j.attempts}</td>
                    </tr>
                    {j.status === 'NO_COVERAGE' && (
                      <tr>
                        <td className={td} colSpan={4}>
                          <p className="text-gold/70 text-[11px] normal-case">{t('cyberScanNoCoverageDetail')}</p>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
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
const REPORT_TYPES = ['EXECUTIVE', 'TECHNICAL', 'REMEDIATION', 'AUDIT', 'FULL'];

function ReportsTab({ t }) {
  const [reports, setReports] = useState(null);
  const [assets, setAssets] = useState(null);
  const [assetFilter, setAssetFilter] = useState('');
  const [generateAssetId, setGenerateAssetId] = useState('');
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState(null);
  const [generating, setGenerating] = useState(false);

  function load() {
    cyberAnalysisApi.listReports(assetFilter || undefined).then((r) => setReports(r.reports)).catch((err) => setError(err.message));
  }
  useEffect(load, [assetFilter]);
  useEffect(() => { cyberAnalysisApi.listAssets().then((r) => setAssets(r.assets)).catch(() => {}); }, []);

  function assetName(assetId) {
    if (!assetId) return '—';
    return assets?.find((a) => a.id === assetId)?.name || assetId;
  }

  async function onGenerate(reportType) {
    setGenerating(true);
    setError(null);
    try {
      // AUDIT is deliberately never asset-scoped (see reports/builders.js) --
      // its own ledger covers org-level activity a single asset can't
      // meaningfully narrow.
      await cyberAnalysisApi.generateReport(reportType, reportType !== 'AUDIT' && generateAssetId ? { assetId: generateAssetId } : {});
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
        <div className="mb-2">
          <label className="block text-cyan-100/50 text-xs mb-1">{t('cyberColAsset')}</label>
          <select className={inputCls} value={generateAssetId} onChange={(e) => setGenerateAssetId(e.target.value)}>
            <option value="">{t('cyberAllAssets')}</option>
            {assets?.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
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
            {selected.report.asset_id && <> · {t('cyberColAsset')}: {assetName(selected.report.asset_id)}</>}
          </p>
          <pre className="whitespace-pre-wrap text-[11px] max-h-[300px] overflow-auto text-cyan-100/70 border border-cyan-300/15 rounded p-2">
            {JSON.stringify(selected.report.content, null, 2)}
          </pre>
        </Panel>
      )}

      <Panel
        title={t('cyberReportsPanelTitle')}
        actions={
          <select className={`${inputCls} w-auto`} value={assetFilter} onChange={(e) => setAssetFilter(e.target.value)}>
            <option value="">{t('cyberAllAssets')}</option>
            {assets?.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        }
      >
        {reports && (
          <div className={tableWrap}>
            <table className="w-full">
              <thead><tr><th className={th}>{t('cyberColType')}</th><th className={th}>{t('cyberColAsset')}</th><th className={th}>{t('cyberColGenerated')}</th><th className={th}>{t('cyberColBciVersion')}</th><th className={th}></th></tr></thead>
              <tbody>
                {reports.map((r) => (
                  <tr key={r.id}>
                    <td className={td}>{r.report_type}</td>
                    <td className={`${td} text-cyan-100/60`}>{assetName(r.asset_id)}</td>
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
  const [wizardOpen, setWizardOpen] = useState(false);

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

  // Whether the active tab's own required field(s) are filled in -- gates
  // both the Next button and the Enter key. Reset to true synchronously by
  // changeTab (below) whenever the tab changes -- not via a useEffect keyed
  // on `tab`, since that would fire after the newly-mounted tab's own
  // validity effect and stomp its (possibly false) value back to true. A
  // tab with a required field (Assets, Scans) then overrides it to false
  // via onValidityChange until that field has a value. Tabs with nothing to
  // fill in (Dashboard, Findings, Reports, Engines, Quantum) never call
  // onValidityChange, so they stay advanceable.
  const [canAdvance, setCanAdvance] = useState(true);
  function changeTab(id) {
    setCanAdvance(true);
    setTab(id);
  }

  // Handoff from Assets' "Start Scan" -- the target of the selected asset,
  // carried over to Scans so the user never retypes a target that's already
  // registered on a real asset. Cleared the instant ScansTab reads it (see
  // its onInitialTargetConsumed), so a later plain sidebar switch to Scans
  // (not via "Start Scan") never re-prefills a stale target.
  const [pendingScanTarget, setPendingScanTarget] = useState(null);
  const startScanFor = (target) => {
    setPendingScanTarget(target);
    changeTab('scans');
  };

  // Prev/Next/Enter/Esc only ever step through the flow group (Command
  // Center -> Assets -> Scans -> Findings -> Reports) -- Engines and
  // Quantum & PQC are standalone technical panels with no sequence, not
  // steps 6/7 of an analysis. Landing on one of them (via the sidebar)
  // hides the Prev/Next row entirely rather than pretending they fit a
  // position in the flow.
  const flowTabs = TABS.filter((tb) => tb.group === 'flow');
  const activeFlowIndex = flowTabs.findIndex((tb) => tb.id === tab);
  const isFlowTab = activeFlowIndex !== -1;
  const goPrev = () => { if (activeFlowIndex > 0) changeTab(flowTabs[activeFlowIndex - 1].id); };
  const goNext = () => { if (activeFlowIndex < flowTabs.length - 1 && canAdvance) changeTab(flowTabs[activeFlowIndex + 1].id); };
  const activeTabProps = {
    t,
    onValidityChange: setCanAdvance,
    ...(tab === 'dashboard' ? { onNewAnalysis: () => setWizardOpen(true) } : {}),
    ...(tab === 'assets' ? { onStartScan: startScanFor } : {}),
    ...(tab === 'scans' ? {
      onScanCompleted: () => changeTab('findings'),
      initialTarget: pendingScanTarget,
      onInitialTargetConsumed: () => setPendingScanTarget(null),
    } : {}),
  };

  // Esc = previous step, Enter = next step -- the same physical keys on
  // every desktop OS/keyboard layout, and neither has a native meaning
  // inside these single-line inputs (no textarea, no native form submit),
  // so both work everywhere with no need to click an empty area first.
  // Enter still respects canAdvance -- pressing it while a required field
  // is empty does nothing, same as the disabled Next button. Inert outside
  // the flow group (Engines/Quantum), same as the hidden Prev/Next row.
  useEffect(() => {
    if (!status?.available || !isFlowTab) return undefined;
    function onKeyDown(e) {
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      if (e.key === 'Enter') {
        if (!canAdvance) return;
        e.preventDefault();
        goNext();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        goPrev();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [status?.available, isFlowTab, activeFlowIndex, flowTabs.length, canAdvance]);

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
            {TABS.map((tb, i) => (
              <React.Fragment key={tb.id}>
                {tb.group === 'technical' && TABS[i - 1]?.group === 'flow' && (
                  <div className="hidden sm:block border-t border-cyan-300/10 my-1 pt-1">
                    <span className="text-cyan-100/30 text-[10px] tracking-widest uppercase px-3">{t('cyberTechnicalGroup')}</span>
                  </div>
                )}
                <button
                  onClick={() => changeTab(tb.id)}
                  className={`px-3 py-2 rounded text-[12px] tracking-wide uppercase transition text-left whitespace-nowrap ${
                    tab === tb.id ? 'bg-cyan-400/15 text-cyan-100 border border-cyan-300/40' : 'text-cyan-100/50 hover:text-cyan-100/80'
                  }`}
                >
                  {tb.label}
                </button>
              </React.Fragment>
            ))}
          </nav>

          <div className="flex-1 min-w-0 space-y-3">
            {isFlowTab && (
              <>
                <div className="flex justify-end gap-2">
                  <button
                    onClick={goPrev}
                    disabled={activeFlowIndex <= 0}
                    className="border border-cyan-300/35 text-cyan-100 px-3 py-1.5 rounded flex items-center gap-1 text-[12px] hover:bg-cyan-400/10 disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <ChevronLeft className="w-3.5 h-3.5" /> {t('cyberPrevTab')}
                  </button>
                  <button
                    onClick={goNext}
                    disabled={activeFlowIndex >= flowTabs.length - 1 || !canAdvance}
                    className="border border-cyan-300/35 text-cyan-100 px-3 py-1.5 rounded flex items-center gap-1 text-[12px] hover:bg-cyan-400/10 disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    {t('cyberNextTab')} <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
                <p className="text-cyan-100/30 text-[11px] text-right -mt-2">{t('cyberKeyboardHint')}</p>
              </>
            )}
            <ActiveTab {...activeTabProps} />
          </div>
        </div>
      ) : null}

      {wizardOpen && (
        <CyberNewAnalysisWizard
          onClose={() => setWizardOpen(false)}
          onGoToFindings={() => { setWizardOpen(false); changeTab('findings'); }}
        />
      )}
    </div>
  );
}
