import { Atom, BrainCircuit, Database, Gauge, ShieldCheck } from 'lucide-react';
import { AnalysisWorkflow } from './AnalysisWorkflow.jsx';
import AnalysisView from './AnalysisView.jsx';

const ENGINE_BADGES = [
  ['AI REASONING', BrainCircuit, 'READY'],
  ['REAL DATA', Database, 'AUTO'],
  ['CLASSICAL', Gauge, 'READY'],
  ['QISKIT AER', Atom, 'SIMULATOR'],
];

export default function AnalysisCenter(props) {
  return (
    <div className="max-w-7xl mx-auto">
      <div className="mb-3 flex flex-col xl:flex-row xl:items-center justify-between gap-3">
        <div>
          <div className="text-[9px] tracking-[0.24em] text-cyan-300/60">ANATOLIA-Q / ANALİZ MERKEZİ</div>
          <h1 className="text-sm sm:text-lg font-display tracking-[0.18em] text-cyan-100">KARAR ANALİZ ÇALIŞMA ALANI</h1>
          <p className="mt-1 text-[10px] text-white/35">Veri, yapay zekâ, klasik hesaplama ve kuantum sonuçlarını tek karar zincirinde inceleyin.</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {ENGINE_BADGES.map(([label, Icon, state]) => (
            <div key={label} className="rounded border border-cyan-400/15 bg-[#031326]/80 px-2.5 py-2 flex items-center gap-2">
              <Icon className="w-3.5 h-3.5 text-cyan-300/70" />
              <div>
                <div className="text-[8px] tracking-wider text-white/55">{label}</div>
                <div className="text-[8px] tracking-wider text-emerald-300/70">● {state}</div>
              </div>
            </div>
          ))}
          <div className="rounded border border-amber-300/15 bg-[#031326]/80 px-2.5 py-2 flex items-center gap-2">
            <ShieldCheck className="w-3.5 h-3.5 text-amber-300/70" />
            <div><div className="text-[8px] tracking-wider text-white/55">IBM HARDWARE</div><div className="text-[8px] tracking-wider text-amber-300/70">○ VERIFY ON DEMAND</div></div>
          </div>
        </div>
      </div>

      <AnalysisWorkflow hasPrompt={false} hasData={false} quantumMode={false} hasResult={false} />

      <div className="mb-3 rounded-lg border border-cyan-400/10 bg-[#031326]/55 px-3 py-2 flex flex-wrap items-center gap-x-5 gap-y-1 text-[9px] text-white/35">
        <span>01 Görevi tanımla</span><span>02 Veri ekle</span><span>03 Motorları seç</span><span>04 Analizi çalıştır</span><span>05 Kaynakları karşılaştır</span><span>06 Karar izini doğrula</span>
      </div>

      <AnalysisView {...props} />
    </div>
  );
}
