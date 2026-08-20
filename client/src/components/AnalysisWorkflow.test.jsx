import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ResultSourceBadge } from './AnalysisWorkflow.jsx';

describe('ResultSourceBadge', () => {
  it('labels a simulator result', () => {
    render(<ResultSourceBadge source="qiskit_aer_simulation" />);
    expect(screen.getByText('SIMULATOR')).toBeInTheDocument();
  });

  it('labels a real-hardware-verified result', () => {
    render(<ResultSourceBadge source="ibm_hardware_verified" />);
    expect(screen.getByText('REAL HARDWARE')).toBeInTheDocument();
  });

  it('labels an AI-estimate result', () => {
    render(<ResultSourceBadge source="ai_estimate" />);
    expect(screen.getByText('AI ESTIMATE')).toBeInTheDocument();
  });

  it('falls back to AI ESTIMATE for an unrecognized/missing source', () => {
    render(<ResultSourceBadge source={undefined} />);
    expect(screen.getByText('AI ESTIMATE')).toBeInTheDocument();
  });
});
