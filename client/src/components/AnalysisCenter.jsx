import { AnalysisWorkflow } from './AnalysisWorkflow.jsx';
import AnalysisView from './AnalysisView.jsx';

export default function AnalysisCenter(props) {
  return (
    <div className="max-w-6xl mx-auto">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <div className="text-[9px] tracking-[0.24em] text-cyan-300/60">ANATOLIA-Q / ANALİZ MERKEZİ</div>
          <h1 className="text-sm sm:text-lg font-display tracking-[0.18em] text-cyan-100">KARAR ANALİZ ÇALIŞMA ALANI</h1>
        </div>
        <div className="hidden sm:block text-[9px] tracking-wider text-white/30">EVIDENCE-DRIVEN WORKSPACE</div>
      </div>
      <AnalysisWorkflow hasPrompt={false} hasData={false} quantumMode={false} hasResult={false} />
      <AnalysisView {...props} />
    </div>
  );
}
