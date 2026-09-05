import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import CyberAnalysisWizard from '../components/CyberAnalysisWizard.jsx';

// Standalone route for Cyber Analysis (see App.jsx). The same wizard also
// renders inline as the "siber" analysis category in AnalysisView.jsx --
// see CyberAnalysisWizard.jsx.
export default function CyberAnalysisPage() {
  return (
    <div className="quantum-bg min-h-screen relative p-4 sm:p-6">
      <div className="relative z-10 max-w-3xl mx-auto space-y-4">
        <div className="flex justify-end">
          <Link
            to="/"
            className="border border-cyan-300/35 text-cyan-100 px-3 py-2 rounded flex items-center gap-2 hover:bg-cyan-400/10"
          >
            <ArrowLeft className="w-4 h-4" />
            Dashboard
          </Link>
        </div>
        <CyberAnalysisWizard />
      </div>
    </div>
  );
}
