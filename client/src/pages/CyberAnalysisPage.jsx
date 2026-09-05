import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import CyberAnalysisContent from '../components/CyberAnalysisContent.jsx';

// Standalone route for Cyber Analysis (see App.jsx). The same content also
// renders inline as the "siber" analysis category in AnalysisView.jsx --
// see CyberAnalysisContent.jsx.
export default function CyberAnalysisPage() {
  return (
    <div className="quantum-bg min-h-screen relative p-4 sm:p-6">
      <div className="relative z-10 max-w-5xl mx-auto space-y-4">
        <div className="flex justify-end">
          <Link
            to="/"
            className="border border-cyan-300/35 text-cyan-100 px-3 py-2 rounded flex items-center gap-2 hover:bg-cyan-400/10"
          >
            <ArrowLeft className="w-4 h-4" />
            Dashboard
          </Link>
        </div>
        <CyberAnalysisContent />
      </div>
    </div>
  );
}
