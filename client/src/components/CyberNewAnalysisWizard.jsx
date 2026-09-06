import React, { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { api, cyberAnalysisApi } from '../services/api.js';
import { useLang } from '../services/langContext.jsx';

// The dedicated 5-step "New Analysis" wizard (Asset -> Engines -> Quantum
// -> Scan -> Report). This is NOT the persistent Assets/Scans/Engines/
// Quantum tabs renamed -- it is its own overlay with its own state machine,
// carrying real asset/target/plan data forward step to step, and its plan
// becomes immutable the moment a scan job is actually created (step 4):
// going back after that would let a user silently change what an
// in-flight job is analyzing, so the wizard simply doesn't allow it.
//
// Real backend contract this UI honors (BCI recommends, the user decides,
// only the real selection ever executes):
//   1. Step 2 (Engines): analysisPlanner.js still computes the real
//      recommended+compatible+healthy plan for (target type, requested
//      class), but jobQueue.js's enqueueScan() now accepts a real
//      selectedEngineIds -- a non-empty subset of that recommendation,
//      each entry independently required to be HEALTHY. Anything outside
//      the recommendation, or unhealthy, is rejected server-side; the UI
//      only lets the user narrow the checked set, never widen it.
//   2. Step 3 (Quantum): the Remediation Optimizer (bci/src/quantum) is
//      still the only thing that ever runs a quantum/quantum-inspired
//      computation, and it still only runs post-scan over real findings
//      -- so the mode picked here is a real *preference* carried forward
//      (scan_jobs.selected_compute_mode at creation, then passed as
//      preferredMode to the optimizer in step 5), never an execution that
//      happens during the scan itself. decideExecutionMode() in
//      executionPolicy.js is the sole authority on what actually runs --
//      org policy and live provider health can still force a fallback,
//      which step 5 reports honestly (selected vs. actual mode, and why).
//   3. Only genuinely backend-supported optimize parameters are exposed:
//      effortBudget and dataClassification (quantum.js's optimizeSchema).
//      No frontend-only parameter is invented.
const STEPS = ['asset', 'engines', 'quantum', 'scan', 'result'];
const COMPUTE_MODES = ['CLASSICAL', 'QUANTUM_INSPIRED', 'QUANTUM_SIMULATOR', 'QUANTUM_HARDWARE'];
const DATA_CLASSIFICATIONS = ['PUBLIC', 'INTERNAL', 'CONFIDENTIAL', 'SECRET'];
// Provider id that implements each compute mode (bci/src/quantum/registry.js).
const PROVIDER_ID_BY_MODE = {
  CLASSICAL: 'classical',
  QUANTUM_INSPIRED: 'quantum_inspired',
  QUANTUM_SIMULATOR: 'quantum_simulator',
  QUANTUM_HARDWARE: 'ibm_quantum',
};
const ASSET_TYPES = ['DOMAIN', 'HOST', 'WEB_APP', 'API', 'REPOSITORY', 'CONTAINER', 'CLOUD_RESOURCE', 'IDENTITY', 'SERVICE'];
const IDENTIFIER_TYPE_BY_ASSET_TYPE = {
  DOMAIN: 'DOMAIN', HOST: 'IP', WEB_APP: 'URL', API: 'URL', REPOSITORY: 'REPO_URL',
  CONTAINER: 'IMAGE', CLOUD_RESOURCE: 'CLOUD_ACCOUNT_ID', IDENTITY: 'IDENTITY', SERVICE: 'SERVICE',
};
const SCAN_CLASSES = ['PASSIVE', 'SAFE_ACTIVE', 'AUTHENTICATED', 'RESTRICTED'];
const HIGH_PRIORITY_LEVELS = ['IMMEDIATE', '24_HOURS', 'HIGH_PRIORITY'];
const TERMINAL_SCAN_STATUSES = ['COMPLETED', 'NO_COVERAGE', 'FAILED', 'TIMED_OUT', 'CANCELLED'];

// Best-effort, advisory-only, always user-editable suggestion from the
// target string's shape -- never authoritative (real enforcement is
// server-side typed-scope matching, bci/src/lib/targetMatcher.js, which
// this never calls or substitutes for). Matches the product rule: BCI may
// suggest, the user decides.
function guessAssetType(value) {
  const v = value.trim();
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\/\d{1,2}$/.test(v)) return 'CLOUD_RESOURCE';
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(v)) return 'HOST';
  if (/^https?:\/\//i.test(v)) return 'WEB_APP';
  if (/github\.com|gitlab\.com|bitbucket\.org/i.test(v)) return 'REPOSITORY';
  if (/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(v)) return 'DOMAIN';
  return 'DOMAIN';
}

const inputCls = 'w-full bg-black/25 border border-cyan-400/20 rounded px-2.5 py-2 text-[13px] text-cyan-100 focus:border-cyan-300 focus:outline-none';
const btnCls = 'border border-cyan-300/35 text-cyan-100 px-3 py-2 rounded text-[13px] hover:bg-cyan-400/10 disabled:opacity-40 disabled:cursor-not-allowed';
const btnPrimaryCls = 'bg-cyan-400/15 border border-cyan-300/50 text-cyan-100 px-4 py-2 rounded text-[13px] hover:bg-cyan-400/25 disabled:opacity-40 disabled:cursor-not-allowed';
const tableWrap = 'overflow-x-auto';
const th = 'text-left text-[11px] tracking-widest uppercase text-cyan-100/50 px-2 py-2 border-b border-cyan-300/15 whitespace-nowrap';
const td = 'text-[13px] text-cyan-100/85 px-2 py-2 border-b border-cyan-300/10 whitespace-nowrap';

function Panel({ title, children }) {
  return (
    <section className="hud-panel rounded-xl p-4 sm:p-5">
      <h2 className="text-cyan-100 text-sm tracking-widest uppercase mb-3">{title}</h2>
      {children}
    </section>
  );
}

function Badge({ tone, children }) {
  const tones = { ok: 'text-emerald-300', warn: 'text-gold', danger: 'text-red-400', muted: 'text-cyan-100/50' };
  return <span className={tones[tone] || tones.muted}>{children}</span>;
}

function ErrorNote({ error }) {
  if (!error) return null;
  return <div className="text-red-300 text-[13px] border border-red-400/30 rounded p-2 mb-3">{error}</div>;
}

function scoreTone(score) {
  if (score == null) return 'text-cyan-100/40';
  if (score >= 80) return 'text-emerald-300';
  if (score >= 50) return 'text-gold';
  return 'text-red-400';
}

function scanStatusTone(status) {
  if (status === 'COMPLETED') return 'ok';
  if (status === 'NO_COVERAGE') return 'warn';
  if (['FAILED', 'TIMED_OUT', 'CANCELLED'].includes(status)) return 'danger';
  return 'warn';
}

function engineStatusTone(status) {
  if (status === 'HEALTHY') return 'ok';
  if (status === 'DEGRADED') return 'warn';
  if (status === 'UNKNOWN') return 'muted';
  return 'danger';
}

export default function CyberNewAnalysisWizard({ onClose, onGoToFindings }) {
  const { t } = useLang();
  const [step, setStep] = useState(0);
  const [error, setError] = useState(null);

  // Step 1 -- Asset
  const [mode, setMode] = useState('existing');
  const [assets, setAssets] = useState(null);
  const [selectedAssetId, setSelectedAssetId] = useState(null);
  const [newName, setNewName] = useState('');
  const [newTarget, setNewTarget] = useState('');
  const [newAssetType, setNewAssetType] = useState('DOMAIN');
  const [newCriticality, setNewCriticality] = useState('MEDIUM');
  const [duplicateAsset, setDuplicateAsset] = useState(null);
  const [checkingDuplicate, setCheckingDuplicate] = useState(false);
  const [savingAsset, setSavingAsset] = useState(false);
  const [resolvedAsset, setResolvedAsset] = useState(null); // { id, name, asset_type, criticality, status, target }

  useEffect(() => {
    cyberAnalysisApi.listAssets('ACTIVE').then((r) => setAssets(r.assets)).catch((err) => setError(err.message));
  }, []);

  useEffect(() => { setNewAssetType(guessAssetType(newTarget || '')); }, [newTarget]);

  async function checkDuplicateAndCreate() {
    if (!newName.trim() || !newTarget.trim()) return;
    setError(null);
    setCheckingDuplicate(true);
    try {
      const { asset: existing } = await cyberAnalysisApi.findAssetByTarget(newTarget.trim());
      if (existing) {
        setDuplicateAsset(existing);
        return;
      }
      setSavingAsset(true);
      const { asset } = await cyberAnalysisApi.createAsset({ name: newName.trim(), assetType: newAssetType, criticality: newCriticality });
      await cyberAnalysisApi.addAssetIdentifier(asset.id, {
        identifierType: IDENTIFIER_TYPE_BY_ASSET_TYPE[newAssetType] || newAssetType,
        value: newTarget.trim(),
      });
      setResolvedAsset({ ...asset, target: newTarget.trim() });
    } catch (err) {
      setError(err.message);
    } finally {
      setCheckingDuplicate(false);
      setSavingAsset(false);
    }
  }

  function useDuplicateAsset() {
    setMode('existing');
    setSelectedAssetId(duplicateAsset.id);
    setResolvedAsset(duplicateAsset);
    setDuplicateAsset(null);
  }

  function selectExisting(asset) {
    setSelectedAssetId(asset.id);
    setResolvedAsset(asset);
  }

  // Step 2 -- Engines: BCI recommends, the user narrows the checked set --
  // never widens it (server enforces the same bound independently).
  const [requestedClass, setRequestedClass] = useState('PASSIVE');
  const [scopeDecision, setScopeDecision] = useState(null); // { decision, reason, targetType }
  const [enginePlan, setEnginePlan] = useState(null); // { engines, hasExecutableEngine }
  const [loadingPlan, setLoadingPlan] = useState(false);
  const [selectedEngineIds, setSelectedEngineIds] = useState([]);
  const [selectedCapabilities, setSelectedCapabilities] = useState([]);
  // Whether the user has manually touched the class dropdown for the
  // current asset -- once true, BCI never overrides their choice.
  const [classTouchedByUser, setClassTouchedByUser] = useState(false);
  // Which asset.target the auto-suggestion below has already run for, so
  // it only ever probes once per asset rather than on every class change.
  const autoSuggestedForRef = useRef(null);
  const [autoSuggestedClass, setAutoSuggestedClass] = useState(null);

  useEffect(() => {
    setClassTouchedByUser(false);
    setAutoSuggestedClass(null);
    setSelectedCapabilities([]);
    autoSuggestedForRef.current = null;
  }, [resolvedAsset?.target]);

  useEffect(() => {
    if (step !== 1 || !resolvedAsset?.target) return;
    let alive = true;
    setLoadingPlan(true);
    setEnginePlan(null);
    setScopeDecision(null);
    cyberAnalysisApi.evaluateScope(resolvedAsset.target, requestedClass)
      .then(async (decision) => {
        if (!alive) return;
        setScopeDecision(decision);
        if (decision.decision === 'ALLOW') {
          const plan = await cyberAnalysisApi.getEnginePlan(decision.targetType, requestedClass, selectedCapabilities);
          if (!alive) return;

          // BCI recommends a scan class too, not just engines: a target
          // type can genuinely have zero executable engines at one class
          // (e.g. a DOMAIN target has no engine that can run PASSIVE-only,
          // since even a missing-HSTS check is a real HTTP request) while
          // a higher, still-real class does. Probe classes in order once
          // per asset and jump straight to the lowest one that actually
          // has something to run, rather than leaving the user stuck on a
          // default that was never going to work for this target type.
          if (!classTouchedByUser && !plan.hasExecutableEngine && autoSuggestedForRef.current !== resolvedAsset.target) {
            autoSuggestedForRef.current = resolvedAsset.target;
            for (const candidateClass of SCAN_CLASSES) {
              if (candidateClass === requestedClass) continue;
              const candidatePlan = await cyberAnalysisApi.getEnginePlan(decision.targetType, candidateClass);
              if (!alive) return;
              if (candidatePlan.hasExecutableEngine) {
                setAutoSuggestedClass(candidateClass);
                setSelectedCapabilities([]);
                setRequestedClass(candidateClass);
                return; // re-runs this effect with the better class
              }
            }
          }

          if (selectedCapabilities.length === 0) {
            const defaults = plan.capabilities.filter((capability) => capability.available).map((capability) => capability.id);
            if (defaults.length > 0) {
              setSelectedCapabilities(defaults);
              return;
            }
          }
          setEnginePlan(plan);
          // Default selection: every recommended engine that is also
          // actually HEALTHY right now -- the real, immediately runnable
          // subset of BCI's recommendation. The user can narrow further.
          setSelectedEngineIds(plan.engines.filter((e) => e.recommended && e.status === 'HEALTHY').map((e) => e.id));
        }
      })
      .catch((err) => alive && setError(err.message))
      .finally(() => alive && setLoadingPlan(false));
    return () => { alive = false; };
  }, [step, resolvedAsset, requestedClass, classTouchedByUser, selectedCapabilities]);

  function toggleEngine(engineId) {
    setSelectedEngineIds((ids) => (ids.includes(engineId) ? ids.filter((id) => id !== engineId) : [...ids, engineId]));
  }

  function toggleCapability(capabilityId) {
    setSelectedCapabilities((ids) => ids.includes(capabilityId)
      ? (ids.length > 1 ? ids.filter((id) => id !== capabilityId) : ids)
      : [...ids, capabilityId]);
  }

  // Step 3 -- Quantum: a real preference among the modes the org's policy
  // and live provider health actually allow right now. The final decision
  // (with any forced fallback) is always made server-side, at optimize
  // time in step 5, by decideExecutionMode() -- this is a preference, not
  // an execution.
  const [quantumProviders, setQuantumProviders] = useState(null);
  const [quantumPolicy, setQuantumPolicy] = useState(null);
  const [selectedComputeMode, setSelectedComputeMode] = useState(null);
  const [effortBudget, setEffortBudget] = useState(5);
  const [dataClassification, setDataClassification] = useState('INTERNAL');

  useEffect(() => {
    if (step !== 2) return;
    Promise.all([cyberAnalysisApi.listQuantumProviders(), cyberAnalysisApi.getQuantumPolicy()])
      .then(([providersRes, policyRes]) => {
        setQuantumProviders(providersRes.providers);
        setQuantumPolicy(policyRes.policy);
        const usable = (mode) => {
          const provider = providersRes.providers.find((p) => p.id === PROVIDER_ID_BY_MODE[mode]);
          if (!provider || provider.status !== 'AVAILABLE') return false;
          if (mode === 'QUANTUM_SIMULATOR') return policyRes.policy.allowQuantumSimulator;
          if (mode === 'QUANTUM_HARDWARE') return policyRes.policy.allowQuantumHardware;
          return true; // CLASSICAL and QUANTUM_INSPIRED are never policy-gated
        };
        // Same top-of-chain preference order as decideExecutionMode()'s
        // default fallback (HARDWARE -> SIMULATOR -> INSPIRED -> CLASSICAL)
        // -- a suggestion only; the real decision still happens server-side.
        const recommended = ['QUANTUM_HARDWARE', 'QUANTUM_SIMULATOR', 'QUANTUM_INSPIRED', 'CLASSICAL'].find(usable) || 'CLASSICAL';
        setSelectedComputeMode(recommended);
      })
      .catch((err) => setError(err.message));
  }, [step]);

  function isComputeModeUsable(mode) {
    if (!quantumProviders || !quantumPolicy) return false;
    const provider = quantumProviders.find((p) => p.id === PROVIDER_ID_BY_MODE[mode]);
    if (!provider || provider.status !== 'AVAILABLE') return false;
    if (mode === 'QUANTUM_SIMULATOR') return quantumPolicy.allowQuantumSimulator;
    if (mode === 'QUANTUM_HARDWARE') return quantumPolicy.allowQuantumHardware;
    return true;
  }

  // Step 4 -- Scan (plan freezes the instant the job is created)
  const [job, setJob] = useState(null);
  const [engineRuns, setEngineRuns] = useState([]);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    if (!job || TERMINAL_SCAN_STATUSES.includes(job.status)) return undefined;
    const interval = setInterval(async () => {
      try {
        const [{ job: latest }, { engineRuns: runs }] = await Promise.all([
          cyberAnalysisApi.getScan(job.id),
          cyberAnalysisApi.getScanEngineRuns(job.id),
        ]);
        setJob(latest);
        setEngineRuns(runs);
        if (TERMINAL_SCAN_STATUSES.includes(latest.status)) {
          clearInterval(interval);
          if (latest.status === 'COMPLETED' || latest.status === 'NO_COVERAGE') setStep(4);
        }
      } catch {
        clearInterval(interval);
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [job?.id, job?.status]);

  async function startAnalysis() {
    setStarting(true);
    setError(null);
    try {
      const { job: created } = await cyberAnalysisApi.createScan({
        target: resolvedAsset.target,
        requestedClass,
        selectedEngineIds,
        selectedCapabilities,
        selectedComputeMode,
      });
      setJob(created);
      const { engineRuns: runs } = await cyberAnalysisApi.getScanEngineRuns(created.id).catch(() => ({ engineRuns: [] }));
      setEngineRuns(runs);
      if (created.status === 'COMPLETED' || created.status === 'NO_COVERAGE') setStep(4);
    } catch (err) {
      setError(err.data?.reason ? `${err.message}: ${err.data.reason}` : err.message);
    } finally {
      setStarting(false);
    }
  }

  // Step 5 -- Result: real findings for this target, aggregated the same
  // way assetSummary.js does server-side, over api.cyberAnalysisFindings(),
  // plus the real per-scan remediation optimization run against exactly
  // this job's findings, carrying the wizard's chosen compute-method
  // preference through to the real fallback chain.
  const [resultFindings, setResultFindings] = useState(null);
  const [optimization, setOptimization] = useState(null); // real optimizeRemediation() result, or null while pending
  const [optimizing, setOptimizing] = useState(false);

  useEffect(() => {
    if (step !== 4 || !resolvedAsset?.target || !job) return;
    api.cyberAnalysisFindings().then((r) => {
      setResultFindings(r.findings.filter((f) => f.target === resolvedAsset.target));
    }).catch(() => setResultFindings([]));

    if (job.status !== 'COMPLETED') return; // NO_COVERAGE/FAILED/etc. have no findings to optimize
    setOptimizing(true);
    cyberAnalysisApi.optimizeRemediationForScan({
      effortBudget,
      dataClassification,
      findingIds: job.result?.findingIds || [],
      preferredMode: selectedComputeMode,
      scanJobId: job.id,
    }).then(setOptimization).catch((err) => setError(err.message)).finally(() => setOptimizing(false));
  }, [step, resolvedAsset, job]); // eslint-disable-line react-hooks/exhaustive-deps

  const planFrozen = !!job;
  const canGoBack = step > 0 && step < 3; // never back past a created job (step 3=scan once job exists), never past result
  const stepLabels = [t('cyberWizStepAsset'), t('cyberWizStepEngines'), t('cyberWizStepQuantum'), t('cyberWizStepScan'), t('cyberWizStepResult')];

  const canProceedFromAsset = !!resolvedAsset?.target;
  const selectedCapabilitiesCovered = selectedCapabilities.every((capabilityId) => selectedEngineIds.some((engineId) => {
    const engine = enginePlan?.engines.find((candidate) => candidate.id === engineId);
    return (engine?.targetCapabilities || engine?.capabilities || []).includes(capabilityId);
  }));
  const canProceedFromEngines = scopeDecision?.decision === 'ALLOW' && !!enginePlan?.hasExecutableEngine && selectedEngineIds.length > 0 && selectedCapabilities.length > 0 && selectedCapabilitiesCovered;
  const canProceedFromQuantum = !!selectedComputeMode;

  return (
    <div className="fixed inset-0 z-[99] bg-black/80 overflow-y-auto p-3 sm:p-6">
      <div className="max-w-3xl mx-auto space-y-4">
        <div className="hud-panel rounded-xl p-4 sm:p-5 flex items-center justify-between">
          <div>
            <p className="text-gold/70 text-xs tracking-widest uppercase">{t('cyberNewAnalysis')}</p>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              {stepLabels.map((label, i) => (
                <React.Fragment key={label}>
                  {i > 0 && <span className="text-cyan-100/20">→</span>}
                  <span className={`text-[11px] tracking-widest uppercase flex items-center gap-1 ${i === step ? 'text-cyan-100' : 'text-cyan-100/40'}`}>
                    <span>{i === step ? '●' : '○'}</span> {label}
                  </span>
                </React.Fragment>
              ))}
            </div>
          </div>
          <button onClick={onClose} className="text-cyan-100/60 hover:text-cyan-100"><X className="w-5 h-5" /></button>
        </div>

        <ErrorNote error={error} />

        {step === 0 && (
          <Panel title={t('cyberWizStepAsset')}>
            <div className="flex gap-2 mb-4">
              <button className={mode === 'existing' ? btnPrimaryCls : btnCls} onClick={() => setMode('existing')}>{t('cyberWizExistingAsset')}</button>
              <button className={mode === 'new' ? btnPrimaryCls : btnCls} onClick={() => setMode('new')}>{t('cyberWizNewAsset')}</button>
            </div>

            {mode === 'existing' && (
              assets && (assets.length === 0 ? (
                <p className="text-cyan-100/40 text-sm">{t('cyberNoneYet')}</p>
              ) : (
                <div className={tableWrap}>
                  <table className="w-full">
                    <thead><tr><th className={th}></th><th className={th}>{t('cyberColName')}</th><th className={th}>{t('cyberColTarget')}</th><th className={th}>{t('cyberColType')}</th><th className={th}>{t('cyberColCriticality')}</th></tr></thead>
                    <tbody>
                      {assets.map((a) => (
                        <tr key={a.id} className="cursor-pointer hover:bg-cyan-400/5" onClick={() => a.target && selectExisting(a)}>
                          <td className={td}><input type="radio" checked={selectedAssetId === a.id} readOnly disabled={!a.target} /></td>
                          <td className={td}>{a.name}</td>
                          <td className={`${td} text-cyan-100/60`}>{a.target || t('cyberNoTargetYet')}</td>
                          <td className={td}>{a.asset_type}</td>
                          <td className={td}>{a.criticality}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))
            )}

            {mode === 'new' && (
              <div className="space-y-2">
                <div className="grid sm:grid-cols-2 gap-2">
                  <input className={inputCls} placeholder={t('cyberNamePlaceholder')} value={newName} onChange={(e) => setNewName(e.target.value)} />
                  <input className={inputCls} placeholder={t('cyberAssetTargetPlaceholder')} value={newTarget} onChange={(e) => { setNewTarget(e.target.value); setDuplicateAsset(null); }} />
                </div>
                {newTarget.trim() && (
                  <p className="text-cyan-100/40 text-xs">{t('cyberWizDetectedType', { type: newAssetType })}</p>
                )}
                <div className="grid sm:grid-cols-2 gap-2">
                  <select className={inputCls} value={newAssetType} onChange={(e) => setNewAssetType(e.target.value)}>
                    {ASSET_TYPES.map((at) => <option key={at} value={at}>{at}</option>)}
                  </select>
                  <select className={inputCls} value={newCriticality} onChange={(e) => setNewCriticality(e.target.value)}>
                    {['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>

                {duplicateAsset && (
                  <div className="border border-gold/30 rounded p-3 space-y-2">
                    <p className="text-gold text-[13px]">{t('cyberWizDuplicateTarget')}</p>
                    <button className={btnPrimaryCls} onClick={useDuplicateAsset}>{t('cyberWizUseExisting')}</button>
                  </div>
                )}

                {!resolvedAsset && (
                  <button
                    className={btnCls}
                    disabled={!newName.trim() || !newTarget.trim() || checkingDuplicate || savingAsset}
                    onClick={checkDuplicateAndCreate}
                  >
                    {checkingDuplicate || savingAsset ? t('cyberLoading') : t('cyberAddAssetBtn')}
                  </button>
                )}
              </div>
            )}

            {resolvedAsset && (
              <div className="mt-4 pt-4 border-t border-cyan-300/10 grid grid-cols-2 sm:grid-cols-4 gap-2 text-[13px]">
                <div><span className="text-cyan-100/40 block text-[11px] uppercase">{t('cyberColName')}</span>{resolvedAsset.name}</div>
                <div><span className="text-cyan-100/40 block text-[11px] uppercase">{t('cyberColTarget')}</span>{resolvedAsset.target}</div>
                <div><span className="text-cyan-100/40 block text-[11px] uppercase">{t('cyberColType')}</span>{resolvedAsset.asset_type}</div>
                <div><span className="text-cyan-100/40 block text-[11px] uppercase">{t('cyberColCriticality')}</span>{resolvedAsset.criticality}</div>
              </div>
            )}
          </Panel>
        )}

        {step === 1 && (
          <Panel title={t('cyberWizStepEngines')}>
            <div className="mb-3">
              <label className="block text-cyan-100/50 text-xs mb-1">{t('cyberColClass')}</label>
              <select className={inputCls} value={requestedClass} onChange={(e) => { setClassTouchedByUser(true); setSelectedCapabilities([]); setRequestedClass(e.target.value); }}>
                {SCAN_CLASSES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              {autoSuggestedClass === requestedClass && (
                <p className="text-cyan-100/40 text-xs mt-1">{t('cyberWizClassAutoSuggested', { class: autoSuggestedClass })}</p>
              )}
            </div>

            {loadingPlan && <p className="text-cyan-100/50 text-sm">{t('cyberLoading')}</p>}

            {scopeDecision && scopeDecision.decision !== 'ALLOW' && (
              <div className="border border-red-400/30 rounded p-3 text-red-300 text-[13px]">{t('cyberWizScopeDenied', { reason: scopeDecision.reason })}</div>
            )}

            {enginePlan && (
              <>
                <p className="text-cyan-100/40 text-xs mb-2">Capabilities — BCI önerir, kullanıcı seçer</p>
                <div className="grid sm:grid-cols-2 gap-2 mb-4">
                  {enginePlan.capabilities.map((capability) => (
                    <label key={capability.id} className={`border border-cyan-300/15 rounded p-2 text-[12px] ${capability.available ? 'cursor-pointer' : 'opacity-45'}`}>
                      <input
                        type="checkbox"
                        className="mr-2"
                        checked={selectedCapabilities.includes(capability.id)}
                        disabled={!capability.available}
                        onChange={() => toggleCapability(capability.id)}
                      />
                      <span className="text-cyan-100">{capability.name}</span>
                      <span className="block ml-5 text-cyan-100/45">{capability.id} · {capability.available ? 'KULLANILABİLİR' : 'KULLANILAMIYOR'}</span>
                    </label>
                  ))}
                </div>
                <p className="text-cyan-100/40 text-xs mb-2">{t('cyberWizSelectEngines')}</p>
                <div className={tableWrap}>
                  <table className="w-full">
                    <thead><tr><th className={th}></th><th className={th}>{t('cyberColEngine')}</th><th className={th}>{t('cyberColStatus')}</th><th className={th}>{t('cyberWizCompatible')}</th><th className={th}>Capabilities / Sınıf</th><th className={th}>{t('cyberWizRecommendation')}</th></tr></thead>
                    <tbody>
                      {enginePlan.engines.map((e) => {
                        const selectable = e.compatible && e.recommended && e.status === 'HEALTHY';
                        return (
                          <tr key={e.id} className={selectable ? 'cursor-pointer hover:bg-cyan-400/5' : 'opacity-50'} onClick={() => selectable && toggleEngine(e.id)}>
                            <td className={td}>
                              <input aria-label={`engine ${e.id}`} type="checkbox" checked={selectedEngineIds.includes(e.id)} disabled={!selectable} readOnly />
                            </td>
                            <td className={td}><span className="block">{e.name}</span>{e.reasons?.length > 0 && <span className="text-cyan-100/35 text-[10px]">{e.reasons.join(', ')}</span>}</td>
                            <td className={td}><Badge tone={engineStatusTone(e.status)}>{e.status}</Badge></td>
                            <td className={td}>{e.compatible ? <Badge tone="ok">{t('cyberWizYes')}</Badge> : <Badge tone="muted">{t('cyberWizNo')}</Badge>}</td>
                            <td className={td}><span className="block">{(e.targetCapabilities || e.capabilities).join(', ')}</span><span className="text-cyan-100/40">{e.intrusiveness}</span></td>
                            <td className={td}>{e.recommended ? <Badge tone="ok">{t('cyberWizRecommended')}</Badge> : <Badge tone="muted">—</Badge>}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <p className="text-cyan-100/40 text-xs mt-2">
                  {t('cyberWizEngineSummary', {
                    total: enginePlan.engines.length,
                    healthy: enginePlan.engines.filter((e) => e.status === 'HEALTHY').length,
                    compatible: enginePlan.engines.filter((e) => e.compatible).length,
                    recommended: enginePlan.engines.filter((e) => e.recommended).length,
                  })}
                </p>
                {!enginePlan.hasExecutableEngine && (
                  <div className="border border-red-400/30 rounded p-3 text-red-300 text-[13px] mt-2">{t('cyberWizNoExecutableEngine')}</div>
                )}
                {enginePlan.hasExecutableEngine && selectedEngineIds.length === 0 && (
                  <div className="border border-gold/30 rounded p-3 text-gold text-[13px] mt-2">{t('cyberWizEngineRequired')}</div>
                )}
                {!selectedCapabilitiesCovered && (
                  <div className="border border-gold/30 rounded p-3 text-gold text-[13px] mt-2">Seçilen motorlar seçili capability’lerin tamamını kapsamıyor.</div>
                )}
              </>
            )}
          </Panel>
        )}

        {step === 2 && (
          <Panel title={t('cyberWizStepQuantum')}>
            <p className="text-cyan-100/50 text-[13px] mb-3">{t('cyberWizQuantumExplainer')}</p>

            {quantumProviders && quantumPolicy && (
              <>
                <p className="text-cyan-100/40 text-xs mb-2">{t('cyberWizComputeMethod')}</p>
                <div className="space-y-2 mb-4">
                  {COMPUTE_MODES.map((mode) => {
                    const provider = quantumProviders.find((p) => p.id === PROVIDER_ID_BY_MODE[mode]);
                    const usable = isComputeModeUsable(mode);
                    const policyDenied = provider?.status === 'AVAILABLE'
                      && ((mode === 'QUANTUM_SIMULATOR' && !quantumPolicy.allowQuantumSimulator)
                        || (mode === 'QUANTUM_HARDWARE' && !quantumPolicy.allowQuantumHardware));
                    return (
                      <label
                        key={mode}
                        className={`flex items-center gap-2 border rounded p-2.5 text-[13px] ${usable ? 'border-cyan-300/20 cursor-pointer hover:bg-cyan-400/5' : 'border-cyan-300/10 opacity-50'} ${selectedComputeMode === mode ? 'bg-cyan-400/10' : ''}`}
                      >
                        <input
                          type="radio"
                          name="computeMode"
                          checked={selectedComputeMode === mode}
                          disabled={!usable}
                          onChange={() => setSelectedComputeMode(mode)}
                        />
                        <span className="flex-1">{mode}{mode === 'QUANTUM_HARDWARE' && <span className="text-gold text-[10px] ml-2">{t('cyberWizExperimentalQpu')}</span>}</span>
                        {!provider || provider.status !== 'AVAILABLE' ? (
                          <Badge tone="muted">{t('cyberWizNotConfigured')}</Badge>
                        ) : policyDenied ? (
                          <Badge tone="warn">{t('cyberWizPolicyDenied')}</Badge>
                        ) : (
                          <Badge tone="ok">{t('cyberWizYes')}</Badge>
                        )}
                      </label>
                    );
                  })}
                </div>
                <p className="text-cyan-100/30 text-[11px] mb-4">{t('cyberWizBciRecommended')}: {['QUANTUM_HARDWARE', 'QUANTUM_SIMULATOR', 'QUANTUM_INSPIRED', 'CLASSICAL'].find((m) => isComputeModeUsable(m)) || 'CLASSICAL'}</p>

                <p className="text-cyan-100/40 text-xs mb-2">{t('cyberWizOptimizationParams')}</p>
                <div className="grid sm:grid-cols-2 gap-2">
                  <div>
                    <label className="block text-cyan-100/50 text-xs mb-1">{t('cyberEffortBudgetLabel')}</label>
                    <input
                      type="number"
                      min="1"
                      className={inputCls}
                      value={effortBudget}
                      onChange={(e) => setEffortBudget(Math.max(1, parseInt(e.target.value, 10) || 1))}
                    />
                  </div>
                  <div>
                    <label className="block text-cyan-100/50 text-xs mb-1">{t('cyberDataClassificationLabel')}</label>
                    <select className={inputCls} value={dataClassification} onChange={(e) => setDataClassification(e.target.value)}>
                      {DATA_CLASSIFICATIONS.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                </div>
              </>
            )}
          </Panel>
        )}

        {step === 3 && (
          <Panel title={t('cyberWizStepScan')}>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[13px] mb-4">
              <div><span className="text-cyan-100/40 block text-[11px] uppercase">{t('cyberColTarget')}</span>{resolvedAsset?.target}</div>
              <div><span className="text-cyan-100/40 block text-[11px] uppercase">{t('cyberColType')}</span>{resolvedAsset?.asset_type}</div>
              <div><span className="text-cyan-100/40 block text-[11px] uppercase">{t('cyberColCriticality')}</span>{resolvedAsset?.criticality}</div>
              <div><span className="text-cyan-100/40 block text-[11px] uppercase">{t('cyberColClass')}</span>{requestedClass}</div>
            </div>

            {!job ? (
              <>
                <p className="text-cyan-100/70 text-[13px] mb-3">{t('cyberWizReadyToStart')}</p>
                <button className={btnPrimaryCls} disabled={starting} onClick={startAnalysis}>{starting ? t('cyberRunning') : t('cyberWizStartAnalysis')}</button>
              </>
            ) : (
              <>
                <p className="text-cyan-100/70 text-[13px] mb-2">
                  {t('cyberColStatus')}: <Badge tone={scanStatusTone(job.status)}>{job.status === 'NO_COVERAGE' ? t('cyberScanNoCoverage') : job.status}</Badge>
                </p>
                {job.status === 'NO_COVERAGE' && <p className="text-gold/70 text-[11px] mb-2">{t('cyberScanNoCoverageDetail')}</p>}
                <div className={tableWrap}>
                  <table className="w-full">
                    <thead><tr><th className={th}>{t('cyberColEngine')}</th><th className={th}>{t('cyberColStatus')}</th></tr></thead>
                    <tbody>
                      {engineRuns.map((r) => (
                        <tr key={r.engine_id}>
                          <td className={td}>{r.engine_id}</td>
                          <td className={td}><Badge tone={r.status === 'COMPLETED' ? 'ok' : r.status === 'SKIPPED' ? 'warn' : 'danger'}>{r.status}</Badge></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </Panel>
        )}

        {step === 4 && job && (
          <Panel title={t('cyberWizStepResult')}>
            {(() => {
              const skippedOrFailed = engineRuns.filter((r) => r.status !== 'COMPLETED');
              const outcome = job.status === 'NO_COVERAGE' ? 'no_coverage'
                : skippedOrFailed.length > 0 && skippedOrFailed.length < engineRuns.length ? 'partial'
                : job.status === 'COMPLETED' ? 'success' : 'failed';
              return (
                <div className="space-y-3">
                  <p className="text-[13px]">
                    {outcome === 'success' && <Badge tone="ok">{t('cyberWizOutcomeSuccess')}</Badge>}
                    {outcome === 'partial' && <Badge tone="warn">{t('cyberWizOutcomePartial')}</Badge>}
                    {outcome === 'no_coverage' && <Badge tone="warn">{t('cyberScanNoCoverage')}</Badge>}
                    {outcome === 'failed' && <Badge tone="danger">{t('cyberWizOutcomeFailed')}</Badge>}
                  </p>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    <div className="hud-panel rounded-xl p-3 text-center">
                      <div className="text-2xl font-serif">{engineRuns.filter((r) => r.status === 'COMPLETED').reduce((s, r) => s + (r.observation_count || 0), 0)}</div>
                      <div className="text-cyan-100/50 text-[11px] uppercase">{t('cyberWizObservations')}</div>
                    </div>
                    <div className="hud-panel rounded-xl p-3 text-center">
                      <div className="text-2xl font-serif">{resultFindings?.length ?? '—'}</div>
                      <div className="text-cyan-100/50 text-[11px] uppercase">{t('cyberFindingCount')}</div>
                    </div>
                    <div className="hud-panel rounded-xl p-3 text-center">
                      <div className={`text-2xl font-serif ${scoreTone(resultFindings?.length ? Math.max(...resultFindings.map((f) => f.risk_score || 0)) : null)}`}>
                        {resultFindings?.length ? Math.max(...resultFindings.map((f) => f.risk_score || 0)) : '—'}
                      </div>
                      <div className="text-cyan-100/50 text-[11px] uppercase">{t('cyberRiskScoreLabel')}</div>
                    </div>
                  </div>
                  {resultFindings?.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {Object.entries(resultFindings.reduce((acc, f) => {
                        const k = HIGH_PRIORITY_LEVELS.includes(f.priority) ? f.priority : (f.priority || 'UNSCORED');
                        acc[k] = (acc[k] || 0) + 1;
                        return acc;
                      }, {})).map(([p, c]) => <Badge key={p} tone={HIGH_PRIORITY_LEVELS.includes(p) ? 'danger' : 'muted'}>{p}: {c}</Badge>)}
                    </div>
                  )}

                  {job.status === 'COMPLETED' && (
                    <div className="border-t border-cyan-300/10 pt-3">
                      <h3 className="text-cyan-100/60 text-[11px] tracking-widest uppercase mb-2">{t('cyberWizProvenanceTitle')}</h3>
                      {optimizing && <p className="text-cyan-100/50 text-sm">{t('cyberLoading')}</p>}
                      {optimization && (
                        <div className="space-y-2 text-[13px]">
                          <div className="grid grid-cols-3 gap-2">
                            <div><span className="text-cyan-100/40 block text-[11px] uppercase">{t('cyberWizBciRecommended')}</span>{optimization.recommendedMode || '—'}</div>
                            <div><span className="text-cyan-100/40 block text-[11px] uppercase">{t('cyberWizYouSelected')}</span>{optimization.selectedMode || '—'}</div>
                            <div><span className="text-cyan-100/40 block text-[11px] uppercase">{t('cyberWizActuallyUsed')}</span>{optimization.actualMode || '—'}</div>
                          </div>
                          {optimization.fallbackReason && (
                            <p className="text-gold text-[12px]">{t('cyberWizFallbackOccurred')}: {optimization.fallbackReason}</p>
                          )}
                          <p>
                            {t('cyberWizOptimizationVerdict')}: {optimization.verdict === 'NOT_APPLICABLE'
                              ? <Badge tone="muted">{t('cyberWizNotApplicable')}</Badge>
                              : <Badge tone={optimization.verdict === 'QUANTUM_BENEFIT_OBSERVED_FOR_THIS_WORKLOAD' ? 'ok' : 'muted'}>{optimization.verdict}</Badge>}
                          </p>
                        </div>
                      )}
                    </div>
                  )}

                  <div className="flex gap-2 pt-2 border-t border-cyan-300/10">
                    <button className={btnPrimaryCls} onClick={onGoToFindings}>{t('cyberNavFindings')}</button>
                    <button className={btnCls} onClick={onClose}>{t('cyberClose')}</button>
                  </div>
                </div>
              );
            })()}
          </Panel>
        )}

        {step < 4 && (
          <div className="flex justify-between">
            <button className={btnCls} disabled={!canGoBack} onClick={() => setStep((s) => s - 1)}>{t('cyberPrevTab')}</button>
            {step < 3 && (
              <button
                className={btnPrimaryCls}
                disabled={(step === 0 && !canProceedFromAsset) || (step === 1 && !canProceedFromEngines) || (step === 2 && !canProceedFromQuantum)}
                onClick={() => setStep((s) => s + 1)}
              >
                {t('cyberNextTab')}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
