import React from 'react';
import { Atom, Check, Cpu, Database, FileSearch, Flag, Play, Sparkles } from 'lucide-react';

const steps = [
  ['GÖREV', Flag],
  ['VERİ', Database],
  ['MOTORLAR', Cpu],
  ['ÇALIŞTIR', Play],
  ['SONUÇ', FileSearch],
  ['DECISION TRACE', Check],
];

export function AnalysisWorkflow({ hasPrompt, hasData, quantumMode, hasResult }) {
  const active = hasResult ? 4 : hasPrompt ? (hasData ? 2 : 1) : 0;
  return (
    <div className="mb-4 rounded-lg border border-cyan-400/15 bg-[#031326]/80 overflow-x-auto">
      <div className="flex min-w-[720px]">
        {steps.map(([label, Icon], index) => {
          const done = index < active || (hasResult && index === 4);
          const current = index === active;
          return (
            <div key={label} className={`relative flex-1 px-3 py-3 border-r border-white/5 last:border-r-0 ${current ? 'bg-cyan-400/10' : ''}`}>
              <div className="flex items-center gap-2">
                <span className={`w-7 h-7 rounded-full border flex items-center justify-center ${done ? 'border-emerald-400/50 bg-emerald-400/10 text-emerald-300' : current ? 'border-cyan-300/60 bg-cyan-300/10 text-cyan-200' : 'border-white/10 text-white/25'}`}>
                  {done ? <Check className="w-3.5 h-3.5" /> : <Icon className="w-3.5 h-3.5" />}
                </span>
                <div>
                  <div className="text-[8px] text-white/25">0{index + 1}</div>
                  <div className={`text-[9px] tracking-[0.14em] font-semibold ${current ? 'text-cyan-200' : done ? 'text-emerald-300/80' : 'text-white/35'}`}>{label}</div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <div className="px-3 py-2 border-t border-cyan-400/10 flex items-center gap-4 text-[9px] text-white/35">
        <span className="flex items-center gap-1.5"><Sparkles className="w-3 h-3 text-cyan-300" /> AI reasoning</span>
        <span className="flex items-center gap-1.5"><Atom className={`w-3 h-3 ${quantumMode ? 'text-emerald-300' : 'text-white/20'}`} /> Quantum {quantumMode ? 'enabled' : 'optional'}</span>
        <span className="ml-auto">ANATOLIA-Q ANALYSIS PIPELINE</span>
      </div>
    </div>
  );
}

export function ResultProvenance({ result }) {
  if (!result) return null;
  const chips = [
    ['AI ANALYSIS', true, 'AI'],
    ['REAL DATA', !!(result.dataProvenance?.hasRealData || result.realDataUsed), 'DATA'],
    ['CLASSICAL', !!(result.optimizer?.classical || result.classical), 'CLASSICAL'],
    ['QISKIT AER', !!(result.quantum || result.fraud || result.optimizer), 'SIMULATOR'],
    ['IBM HARDWARE', !!(result.ibmVerification?.completed || result.quantum?.hardwareVerified), 'HARDWARE'],
  ];
  return (
    <div className="rounded-lg border border-cyan-400/15 bg-[#031326]/80 p-3">
      <div className="flex items-center gap-2 mb-2">
        <FileSearch className="w-4 h-4 text-cyan-300" />
        <span className="text-[10px] text-cyan-100 tracking-[0.14em] font-semibold">SONUÇ KAYNAKLARI</span>
        <span className="ml-auto text-[8px] text-white/25">PROVENANCE</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {chips.map(([label, enabled, kind]) => (
          <span key={label} className={`px-2.5 py-1.5 rounded border text-[9px] tracking-wider ${enabled ? 'border-cyan-400/30 bg-cyan-400/8 text-cyan-200' : 'border-white/10 text-white/25'}`}>
            {enabled ? '●' : '○'} {label} <span className="text-white/25 ml-1">{kind}</span>
          </span>
        ))}
      </div>
      <div className="mt-2 text-[9px] text-white/30">Simülasyon, yapay zekâ tahmini ve gerçek kuantum donanımı sonuçları ayrı kaynaklar olarak gösterilir.</div>
    </div>
  );
}
