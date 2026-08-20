import { useState } from 'react';
import { Atom, Check, Cpu, Database, FileSearch, Flag, GitMerge, ServerCog, Sparkles, Bot, Cpu as CpuIcon, ShieldCheck, ChevronDown, Workflow } from 'lucide-react';

// Mirrors server/src/services/analysisOrchestrator.js's RESULT_SOURCE_TYPES
// -- every quantum/fraud/optimizer result carries a `resultSource` computed
// by resolveResultSource() there; this is the one place that turns it into
// a badge, so "where did this number come from" reads identically wherever
// a result appears instead of each panel inventing its own label/color.
const RESULT_SOURCE_INFO = {
  ai_estimate: { label: 'AI ESTIMATE', Icon: Bot, className: 'border-amber-400/30 bg-amber-400/10 text-amber-200' },
  qiskit_aer_simulation: { label: 'SIMULATOR', Icon: CpuIcon, className: 'border-cyan-400/30 bg-cyan-400/10 text-cyan-200' },
  ibm_hardware_verified: { label: 'REAL HARDWARE', Icon: ShieldCheck, className: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200' },
};

export function ResultSourceBadge({ source }) {
  const info = RESULT_SOURCE_INFO[source] || RESULT_SOURCE_INFO.ai_estimate;
  const { Icon } = info;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-[8px] tracking-wider font-semibold ${info.className}`}>
      <Icon className="w-2.5 h-2.5" /> {info.label}
    </span>
  );
}

const steps = [
  ['GÖREV OLUŞTURULDU', Flag],
  ['VERİ DOĞRULAMA', Database],
  ['AI ANALİZİ', Sparkles],
  ['DEVRE ÜRETİMİ', Atom],
  ['KLASİK BENCHMARK', Cpu],
  ['IBM DOĞRULAMA', ServerCog],
  ['KARAR BİRLEŞTİRME', GitMerge],
  ['RAPOR OLUŞTURMA', FileSearch],
];

export function AnalysisWorkflow({ hasPrompt, hasData, quantumMode, hasResult, loading = false }) {
  // hasResult -> pipeline fully settled; loading -> mid-run (AI/circuit
  // phase); otherwise reflect how far the operator has filled in the form.
  const active = hasResult ? steps.length - 1 : loading ? (quantumMode ? 3 : 2) : hasPrompt ? (hasData ? 1 : 0) : -1;
  return (
    <div className="mb-3 rounded-lg border border-cyan-400/15 bg-[#031326]/80 overflow-x-auto" aria-label="ANATOLIA-Q analiz işlem hattı">
      <div className="flex min-w-[820px]">
        {steps.map(([label, Icon], index) => {
          const done = index < active || (hasResult && index === steps.length - 1);
          const current = index === active && !hasResult;
          return (
            <div key={label} className={`relative flex-1 px-2.5 py-2.5 border-r border-white/5 last:border-r-0 ${current ? 'bg-cyan-400/10' : ''}`} aria-current={current ? 'step' : undefined}>
              <div className="flex items-center gap-2">
                <span className={`w-6 h-6 rounded-full border flex items-center justify-center flex-shrink-0 ${done || (hasResult && index === steps.length - 1) ? 'border-emerald-400/50 bg-emerald-400/10 text-emerald-300' : current ? 'border-cyan-300/60 bg-cyan-300/10 text-cyan-200' : 'border-white/10 text-white/25'}`}>
                  {done || (hasResult && index === steps.length - 1) ? <Check className="w-3 h-3" /> : <Icon className={`w-3 h-3 ${current ? 'animate-pulse' : ''}`} />}
                </span>
                <div className="min-w-0">
                  <div className="text-[7px] text-white/25">0{index + 1}</div>
                  <div className={`text-[8px] tracking-[0.1em] font-semibold truncate ${current ? 'text-cyan-200' : done ? 'text-emerald-300/80' : 'text-white/35'}`}>{label}</div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <div className="px-3 py-1.5 border-t border-cyan-400/10 flex items-center gap-4 text-[9px] text-white/35">
        <span className="flex items-center gap-1.5"><Sparkles className="w-3 h-3 text-cyan-300" /> AI reasoning</span>
        <span className="flex items-center gap-1.5"><Atom className={`w-3 h-3 ${quantumMode ? 'text-emerald-300' : 'text-white/20'}`} /> Kuantum {quantumMode ? 'etkin' : 'opsiyonel'}</span>
        <span className="ml-auto">ANATOLIA-Q ANALYSIS PIPELINE</span>
      </div>
    </div>
  );
}

export function ResultProvenance({ result }) {
  if (!result) return null;
  const quantum = result.quantum || result.quantumResult;
  const fraud = result.fraud || result.fraudQuantum;
  const optimizer = result.optimizer || result.portfolioOptimizer;
  const ibm = result.ibmVerification || quantum?.ibmVerification;
  const chips = [
    ['AI ANALYSIS', true, 'AI'],
    ['REAL DATA', Boolean(result.dataProvenance?.hasRealData || result.realDataUsed || result.provenance?.hasRealData), 'DATA'],
    ['CLASSICAL', Boolean(optimizer?.classical || optimizer?.classicalOptimal || result.classical), 'CLASSICAL'],
    ['QISKIT AER', Boolean(quantum || fraud || optimizer), 'SIMULATOR'],
    ['IBM HARDWARE', Boolean(ibm?.completed || ibm?.status === 'completed' || quantum?.hardwareVerified), 'HARDWARE'],
  ];
  return (
    <div className="rounded-lg border border-cyan-400/15 bg-[#031326]/80 p-3" aria-label="Analiz sonuç kaynakları">
      <div className="flex items-center gap-2 mb-2">
        <FileSearch className="w-4 h-4 text-cyan-300" />
        <span className="text-[10px] text-cyan-100 tracking-[0.14em] font-semibold">SONUÇ KAYNAKLARI</span>
        <span className="ml-auto text-[8px] text-white/25">PROVENANCE</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {chips.map(([label, enabled, kind]) => (
          <span key={label} className={`px-2.5 py-1.5 rounded border text-[9px] tracking-wider ${enabled ? 'border-cyan-400/30 bg-cyan-400/10 text-cyan-200' : 'border-white/10 text-white/25'}`}>
            {enabled ? '●' : '○'} {label} <span className="text-white/25 ml-1">{kind}</span>
          </span>
        ))}
      </div>
      <div className="mt-2 text-[9px] text-white/30">Simülasyon, yapay zekâ tahmini ve gerçek kuantum donanımı sonuçları ayrı kaynaklar olarak gösterilir.</div>
    </div>
  );
}

const ENGINE_NODE_INFO = {
  'scenario-quantum': { label: 'SENARYO MOTORU', detail: 'Qiskit Aer kuantum devresi' },
  'fraud-quantum-kernel': { label: 'FRAUD ÇEKİRDEĞİ', detail: 'Kuantum kernel anomali tespiti' },
  'portfolio-qaoa': { label: 'OPTİMİZASYON MOTORU', detail: 'QAOA kaynak tahsisi' },
};

// UI-02 (technical audit): item 21 asked for a "HOW THIS RESULT WAS
// PRODUCED" panel with clickable pipeline nodes, built from the run's
// Evidence Objects (server/src/services/evidence.js) and its Decision
// Fusion verdict (decisionFusion.js) instead of the reader having to
// cross-reference each engine's own panel to reconstruct what actually ran.
export function DecisionPipelinePanel({ result }) {
  const [openId, setOpenId] = useState(null);
  if (!result?.evidence?.length) return null;

  const aiItem = result.evidence.find((e) => e.engine === 'ai');
  const engineItems = result.evidence.filter((e) => e.engine !== 'ai');
  const anyHardwareVerified = engineItems.some((e) => e.verified);

  const nodes = [
    { id: 'input', label: 'GİRDİ', detail: 'Kullanıcı talebi ve yüklenen kaynak belgeler doğrulandı.' },
    { id: 'ai', label: 'YZ ANALİZİ', detail: `Sağlayıcı: ${aiItem?.source || result.provider || 'bilinmiyor'}` },
    ...engineItems.map((e) => ({
      id: e.engine,
      label: ENGINE_NODE_INFO[e.engine]?.label || e.engine.toUpperCase(),
      detail: `${ENGINE_NODE_INFO[e.engine]?.detail || ''} — ${e.method}${e.confidence ? ` (${e.confidence})` : ''}`,
    })),
    ...(anyHardwareVerified ? [{ id: 'ibm', label: 'IBM DOĞRULAMASI', detail: 'En az bir sonuç gerçek IBM Quantum donanımında doğrulandı.' }] : []),
    ...(result.decisionFusion ? [{ id: 'fusion', label: 'KARAR FÜZYONU', detail: result.decisionFusion.summary }] : []),
    { id: 'report', label: 'RAPOR', detail: 'Yukarıdaki adımların birleşimi olarak nihai rapor üretildi.' },
  ];

  return (
    <div className="rounded-lg border border-cyan-400/15 bg-[#031326]/80 p-3" aria-label="Karar üretim izi">
      <div className="flex items-center gap-2 mb-3">
        <Workflow className="w-4 h-4 text-cyan-300" />
        <h3 className="font-display text-cyan-100 tracking-widest text-xs">SONUÇ NASIL ÜRETİLDİ</h3>
      </div>
      <div className="flex flex-wrap items-stretch gap-1.5">
        {nodes.map((node, i) => (
          <div key={node.id} className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setOpenId(openId === node.id ? null : node.id)}
              className={`px-2.5 py-1.5 rounded border text-[9px] tracking-wider flex items-center gap-1 transition-colors ${openId === node.id ? 'border-cyan-300/60 bg-cyan-400/15 text-cyan-100' : 'border-cyan-400/20 bg-black/20 text-cyan-200/80 hover:border-cyan-400/40'}`}
            >
              {node.label}
              <ChevronDown className={`w-2.5 h-2.5 transition-transform ${openId === node.id ? 'rotate-180' : ''}`} />
            </button>
            {i < nodes.length - 1 && <span className="text-cyan-400/30 text-[10px]">→</span>}
          </div>
        ))}
      </div>
      {openId && (
        <div className="mt-3 p-2.5 rounded border border-cyan-400/15 bg-black/30 text-[10px] text-cyan-200/80 leading-relaxed">
          {nodes.find((n) => n.id === openId)?.detail}
        </div>
      )}
    </div>
  );
}
