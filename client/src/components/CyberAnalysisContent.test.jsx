import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import CyberAnalysisContent from './CyberAnalysisContent.jsx';
import { LangProvider } from '../services/langContext.jsx';
import { api, cyberAnalysisApi } from '../services/api.js';

vi.mock('../services/api.js', () => ({
  api: {
    cyberAnalysisStatus: vi.fn(async () => ({ available: true })),
    cyberAnalysisOverview: vi.fn(async () => ({ securityScore: { score: 82, openFindingCount: 3 }, coverageScore: { score: 40 } })),
    cyberAnalysisFindings: vi.fn(async () => ({ findings: [] })),
  },
  cyberAnalysisApi: {
    listAssets: vi.fn(async () => ({ assets: [] })),
    createAsset: vi.fn(),
    listScans: vi.fn(async () => ({ jobs: [] })),
    createScan: vi.fn(),
    getScan: vi.fn(),
    listReports: vi.fn(async () => ({ reports: [] })),
    generateReport: vi.fn(),
    listEngines: vi.fn(async () => ({ engines: [] })),
    runEngineHealthCheck: vi.fn(),
    listQuantumProviders: vi.fn(async () => ({ providers: [] })),
    getQuantumPolicy: vi.fn(async () => ({ policy: { allowQuantumSimulator: false, allowQuantumHardware: false, maxExternalDataClassification: 'PUBLIC' } })),
    listQuantumBenchmarks: vi.fn(async () => ({ benchmarks: [] })),
    listQuantumJobs: vi.fn(async () => ({ jobs: [] })),
    listCryptoInventory: vi.fn(async () => ({ findings: [] })),
    getPqcReadiness: vi.fn(async () => ({ readinessScore: null, quantumVulnerableCount: 0, unclassifiedCount: 0, roadmap: [] })),
    getCbom: vi.fn(async () => ({ componentCount: 0 })),
  },
}));

function renderContent() {
  return render(<LangProvider><CyberAnalysisContent /></LangProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  api.cyberAnalysisStatus.mockResolvedValue({ available: true });
  // All labels now route through i18n (t()) instead of hardcoded English;
  // pin the language so the assertions below stay deterministic.
  localStorage.setItem('anatolia_lang', 'en');
});

describe('CyberAnalysisContent', () => {
  it('shows a clear unavailable message when BCI is not configured', async () => {
    api.cyberAnalysisStatus.mockResolvedValue({ available: false });
    renderContent();
    await waitFor(() => expect(screen.getByText(/BOLD Cyber Intelligence/i)).toBeInTheDocument());
  });

  it('shows real dashboard scores on load, using the existing SSO session (no separate login)', async () => {
    renderContent();
    await waitFor(() => expect(screen.getByText('82')).toBeInTheDocument());
    expect(screen.getByText('40')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('switches to the Assets tab and lets the user add a real asset via the BCI integration API', async () => {
    renderContent();
    await waitFor(() => screen.getByText('82'));
    fireEvent.click(screen.getByRole('button', { name: 'Assets' }));
    await waitFor(() => expect(cyberAnalysisApi.listAssets).toHaveBeenCalled());
    fireEvent.change(screen.getByPlaceholderText('Name'), { target: { value: 'example.com' } });
    fireEvent.click(screen.getByRole('button', { name: /Add asset/i }));
    await waitFor(() => expect(cyberAnalysisApi.createAsset).toHaveBeenCalledWith({ name: 'example.com', assetType: 'DOMAIN' }));
  });

  it('never opens a new tab/window anywhere in the tab flow', async () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    renderContent();
    await waitFor(() => screen.getByText('82'));
    fireEvent.click(screen.getByRole('button', { name: 'Quantum & PQC' }));
    await waitFor(() => expect(cyberAnalysisApi.listQuantumProviders).toHaveBeenCalled());
    expect(openSpy).not.toHaveBeenCalled();
    openSpy.mockRestore();
  });

  it('steps through tabs with Previous/Next, disabling at both ends', async () => {
    renderContent();
    await waitFor(() => screen.getByText('82'));
    expect(screen.getByRole('button', { name: /Previous/ })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(cyberAnalysisApi.listAssets).toHaveBeenCalled());
    expect(screen.getByRole('button', { name: /Previous/ })).not.toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: /Previous/ }));
    await waitFor(() => screen.getByText('82'));
    expect(screen.getByRole('button', { name: /Previous/ })).toBeDisabled();
  });

  it('auto-advances from Scans to Findings once a started scan actually reaches COMPLETED on the backend', async () => {
    cyberAnalysisApi.createScan.mockResolvedValue({ job: { id: 'job-1', status: 'QUEUED' } });
    cyberAnalysisApi.getScan.mockResolvedValue({ job: { id: 'job-1', status: 'COMPLETED' } });
    renderContent();
    await waitFor(() => screen.getByText('82'));

    fireEvent.click(screen.getByRole('button', { name: 'Scans' }));
    await waitFor(() => expect(cyberAnalysisApi.listScans).toHaveBeenCalled());
    fireEvent.change(screen.getByPlaceholderText(/example.com/i), { target: { value: 'example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Start scan' }));

    await waitFor(() => expect(cyberAnalysisApi.createScan).toHaveBeenCalledWith({ target: 'example.com', requestedClass: 'PASSIVE' }));
    // Real polling against the actual job -- not a fabricated percentage --
    // is what drives the tab switch once the job's real status is terminal.
    await waitFor(() => expect(cyberAnalysisApi.getScan).toHaveBeenCalledWith('job-1'), { timeout: 6000 });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Findings' })).toHaveClass('bg-cyan-400/15'), { timeout: 6000 });
  }, 10000);
});
