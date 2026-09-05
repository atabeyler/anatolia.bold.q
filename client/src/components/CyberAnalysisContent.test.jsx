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
    getAsset: vi.fn(),
    updateAsset: vi.fn(),
    getAssetSummary: vi.fn(),
    addAssetIdentifier: vi.fn(),
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
  cyberAnalysisApi.createAsset.mockResolvedValue({ asset: { id: 'asset-1', name: 'example.com', asset_type: 'DOMAIN', criticality: 'MEDIUM', status: 'ACTIVE' } });
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

  it('switches to the Assets tab and lets the user add a real asset with a real target/identifier via the BCI integration API', async () => {
    renderContent();
    await waitFor(() => screen.getByText('82'));
    fireEvent.click(screen.getByRole('button', { name: 'Assets' }));
    await waitFor(() => expect(cyberAnalysisApi.listAssets).toHaveBeenCalled());
    fireEvent.change(screen.getByPlaceholderText('Name'), { target: { value: 'example.com' } });
    fireEvent.change(screen.getByPlaceholderText(/Target/), { target: { value: 'example.com' } });
    fireEvent.click(screen.getByRole('button', { name: /Add asset/i }));
    await waitFor(() => expect(cyberAnalysisApi.createAsset).toHaveBeenCalledWith({ name: 'example.com', assetType: 'DOMAIN' }));
    // The target is what makes the asset findable by risk scoring, coverage
    // score, the security graph, and "Start Scan" -- it must always be
    // registered as a real identifier, never silently dropped.
    await waitFor(() => expect(cyberAnalysisApi.addAssetIdentifier).toHaveBeenCalledWith('asset-1', { identifierType: 'DOMAIN', value: 'example.com' }));
  });

  it('disables "Add asset" until both name and target are filled in', async () => {
    renderContent();
    await waitFor(() => screen.getByText('82'));
    fireEvent.click(screen.getByRole('button', { name: 'Assets' }));
    await waitFor(() => expect(cyberAnalysisApi.listAssets).toHaveBeenCalled());

    expect(screen.getByRole('button', { name: /Add asset/i })).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText('Name'), { target: { value: 'example.com' } });
    expect(screen.getByRole('button', { name: /Add asset/i })).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText(/Target/), { target: { value: 'example.com' } });
    expect(screen.getByRole('button', { name: /Add asset/i })).not.toBeDisabled();
  });

  it('"Start Scan" on an asset row carries its real target into the Scans tab and switches to it -- no retyping, no new tab/window', async () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    cyberAnalysisApi.listAssets.mockResolvedValue({
      assets: [{ id: 'asset-1', name: 'prod-web', asset_type: 'DOMAIN', criticality: 'HIGH', status: 'ACTIVE', target: 'prod.example.com' }],
    });
    renderContent();
    await waitFor(() => screen.getByText('82'));
    fireEvent.click(screen.getByRole('button', { name: 'Assets' }));
    await waitFor(() => screen.getByText('prod-web'));

    fireEvent.click(screen.getByRole('button', { name: 'Start scan' }));

    await waitFor(() => expect(cyberAnalysisApi.listScans).toHaveBeenCalled());
    expect(screen.getByPlaceholderText(/example.com/i)).toHaveValue('prod.example.com');
    expect(openSpy).not.toHaveBeenCalled();
    openSpy.mockRestore();
  });

  it('disables "Start Scan" on an asset row with no registered target yet', async () => {
    cyberAnalysisApi.listAssets.mockResolvedValue({
      assets: [{ id: 'asset-1', name: 'legacy-asset', asset_type: 'HOST', criticality: 'MEDIUM', status: 'ACTIVE', target: null }],
    });
    renderContent();
    await waitFor(() => screen.getByText('82'));
    fireEvent.click(screen.getByRole('button', { name: 'Assets' }));
    await waitFor(() => screen.getByText('legacy-asset'));
    expect(screen.getByRole('button', { name: 'Start scan' })).toBeDisabled();
  });

  it('archives an asset after confirmation, keeping the same real update API (no fake delete)', async () => {
    cyberAnalysisApi.listAssets.mockResolvedValue({
      assets: [{ id: 'asset-1', name: 'prod-web', asset_type: 'DOMAIN', criticality: 'HIGH', status: 'ACTIVE', target: 'prod.example.com' }],
    });
    cyberAnalysisApi.getAsset.mockResolvedValue({
      asset: { id: 'asset-1', name: 'prod-web', asset_type: 'DOMAIN', criticality: 'HIGH', status: 'ACTIVE', created_at: new Date().toISOString() },
      identifiers: [{ id: 'i1', identifier_type: 'DOMAIN', value: 'prod.example.com' }],
      technologies: [],
      relationships: [],
    });
    cyberAnalysisApi.getAssetSummary.mockResolvedValue({
      summary: { targets: ['prod.example.com'], lastScan: null, findingCount: 0, openFindingCount: 0, priorityBreakdown: {}, riskScore: null },
    });
    cyberAnalysisApi.updateAsset.mockResolvedValue({ asset: { id: 'asset-1', status: 'ARCHIVED' } });

    renderContent();
    await waitFor(() => screen.getByText('82'));
    fireEvent.click(screen.getByRole('button', { name: 'Assets' }));
    await waitFor(() => screen.getByText('prod-web'));

    fireEvent.click(screen.getByRole('button', { name: 'Select' }));
    await waitFor(() => expect(cyberAnalysisApi.getAssetSummary).toHaveBeenCalledWith('asset-1'));

    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
    fireEvent.click(screen.getByRole('button', { name: /Yes, archive/i }));
    await waitFor(() => expect(cyberAnalysisApi.updateAsset).toHaveBeenCalledWith('asset-1', { status: 'ARCHIVED' }));
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

  it('steps forward on Enter and back on Esc, working everywhere (no need to click an empty area first)', async () => {
    renderContent();
    await waitFor(() => screen.getByText('82'));

    // Dashboard has nothing required to fill in, so Enter advances immediately.
    fireEvent.keyDown(window, { key: 'Enter' });
    await waitFor(() => expect(cyberAnalysisApi.listAssets).toHaveBeenCalled());

    // Esc goes back even while focus is inside a text field.
    const nameInput = screen.getByPlaceholderText('Name');
    fireEvent.keyDown(nameInput, { key: 'Escape' });
    await waitFor(() => screen.getByText('82'));
  });

  it('keeps Enter (and the Next button) disabled on a step with a required field until it is filled in', async () => {
    renderContent();
    await waitFor(() => screen.getByText('82'));
    fireEvent.click(screen.getByRole('button', { name: 'Assets' }));
    await waitFor(() => expect(cyberAnalysisApi.listAssets).toHaveBeenCalled());

    expect(screen.getByRole('button', { name: /Next/ })).toBeDisabled();
    const listScansCallsBefore = cyberAnalysisApi.listScans.mock.calls.length;
    fireEvent.keyDown(window, { key: 'Enter' });
    // Still on Assets -- Enter must not have advanced to Scans.
    expect(cyberAnalysisApi.listScans.mock.calls.length).toBe(listScansCallsBefore);
    expect(screen.getByRole('button', { name: /Add asset/i })).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('Name'), { target: { value: 'example.com' } });
    expect(screen.getByRole('button', { name: /Next/ })).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText(/Target/), { target: { value: 'example.com' } });
    await waitFor(() => expect(screen.getByRole('button', { name: /Next/ })).not.toBeDisabled());
    fireEvent.keyDown(window, { key: 'Enter' });
    await waitFor(() => expect(cyberAnalysisApi.listScans).toHaveBeenCalled());
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

  it('keeps Next enabled right after starting a scan, even though the target input clears itself', async () => {
    cyberAnalysisApi.createScan.mockResolvedValue({ job: { id: 'job-1', status: 'QUEUED' } });
    renderContent();
    await waitFor(() => screen.getByText('82'));
    fireEvent.click(screen.getByRole('button', { name: 'Scans' }));
    await waitFor(() => expect(cyberAnalysisApi.listScans).toHaveBeenCalled());

    fireEvent.change(screen.getByPlaceholderText(/example.com/i), { target: { value: 'example.com' } });
    await waitFor(() => expect(screen.getByRole('button', { name: /Next/ })).not.toBeDisabled());

    fireEvent.click(screen.getByRole('button', { name: 'Start scan' }));
    await waitFor(() => expect(cyberAnalysisApi.createScan).toHaveBeenCalled());
    // The input clears itself on a successful submit -- Next must not
    // re-disable just because the field is now empty; the scan was
    // actually started, which is the step's real completion condition.
    expect(screen.getByPlaceholderText(/example.com/i)).toHaveValue('');
    expect(screen.getByRole('button', { name: /Next/ })).not.toBeDisabled();
  });

  it('shows the Command Center with real aggregated metrics and a New Analysis CTA that opens the dedicated wizard overlay', async () => {
    cyberAnalysisApi.listAssets.mockResolvedValue({ assets: [{ id: 'a1', name: 'x', asset_type: 'DOMAIN', criticality: 'HIGH', status: 'ACTIVE', target: 'x.com' }] });
    cyberAnalysisApi.listScans.mockResolvedValue({
      jobs: [{ id: 's1', target: 'x.com', requested_class: 'PASSIVE', status: 'ANALYZING', attempts: 1 }],
    });
    renderContent();
    await waitFor(() => screen.getByText('82'));

    expect(screen.getAllByText(/Command Center/i).length).toBeGreaterThan(0);
    await waitFor(() => expect(screen.getByText('Active Assets')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /New Analysis/i }));
    // The wizard overlay, not the persistent Assets tab -- it has its own
    // Existing/New Asset toggle, distinct from AssetsTab's "Add Asset" panel.
    await waitFor(() => expect(screen.getByRole('button', { name: /Existing Asset/i })).toBeInTheDocument());
  });

  it('never shows Prev/Next on the technical panels (Engines, Quantum & PQC) -- they are not analysis steps', async () => {
    renderContent();
    await waitFor(() => screen.getByText('82'));
    fireEvent.click(screen.getByRole('button', { name: 'Engines' }));
    await waitFor(() => expect(cyberAnalysisApi.listEngines).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: /Previous/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Next/ })).not.toBeInTheDocument();
  });

  it('renders a scan with NO_COVERAGE status distinctly from COMPLETED, never as a clean zero-finding result', async () => {
    cyberAnalysisApi.listScans.mockResolvedValue({
      jobs: [{ id: 's1', target: 'boldkimya.com.tr', requested_class: 'PASSIVE', status: 'NO_COVERAGE', attempts: 1 }],
    });
    renderContent();
    await waitFor(() => screen.getByText('82'));
    fireEvent.click(screen.getByRole('button', { name: 'Scans' }));
    await waitFor(() => expect(screen.getByText('NO COVERAGE')).toBeInTheDocument());
    expect(screen.queryByText('COMPLETED')).not.toBeInTheDocument();
  });
});
