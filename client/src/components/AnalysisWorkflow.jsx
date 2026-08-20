import { Atom, Check, Cpu, Database, FileSearch, Flag, GitMerge, ServerCog, Sparkles } from 'lucide-react';

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
