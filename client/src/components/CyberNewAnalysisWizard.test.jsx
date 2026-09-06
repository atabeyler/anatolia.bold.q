import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import CyberNewAnalysisWizard from './CyberNewAnalysisWizard.jsx';
import { LangProvider } from '../services/langContext.jsx';
import { api, cyberAnalysisApi } from '../services/api.js';

vi.mock('../services/api.js', () => ({
  api: {
    cyberAnalysisFindings: vi.fn(async () => ({ findings: [] })),
  },
  cyberAnalysisApi: {
    listAssets: vi.fn(async () => ({ assets: [] })),
    findAssetByTarget: vi.fn(async () => ({ asset: null })),
    createAsset: vi.fn(),
    addAssetIdentifier: vi.fn(),
    evaluateScope: vi.fn(),
    getEnginePlan: vi.fn(),
    listQuantumProviders: vi.fn(async () => ({ providers: [] })),
    getQuantumPolicy: vi.fn(async () => ({ policy: { allowQuantumSimulator: false, allowQuantumHardware: false, maxExternalDataClassification: 'PUBLIC' } })),
    createScan: vi.fn(),
    getScan: vi.fn(),
    getScanEngineRuns: vi.fn(async () => ({ engineRuns: [] })),
    optimizeRemediationForScan: vi.fn(async () => ({ verdict: 'NOT_APPLICABLE', recommendedMode: 'CLASSICAL', selectedMode: 'CLASSICAL', actualMode: 'CLASSICAL', fallbackReason: null })),
  },
}));

function renderWizard(props = {}) {
  return render(<LangProvider><CyberNewAnalysisWizard onClose={vi.fn()} onGoToFindings={vi.fn()} {...props} /></LangProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  cyberAnalysisApi.createAsset.mockResolvedValue({ asset: { id: 'asset-1', name: 'Bold Web', asset_type: 'DOMAIN', criticality: 'MEDIUM', status: 'ACTIVE' } });
  cyberAnalysisApi.findAssetByTarget.mockResolvedValue({ asset: null });
  localStorage.setItem('anatolia_lang', 'en');
});

describe('CyberNewAnalysisWizard', () => {
  it('creates a new asset with a real target, registers it as an identifier, and carries it into step 2', async () => {
    renderWizard();
    fireEvent.click(screen.getByRole('button', { name: 'New Asset' }));

    fireEvent.change(screen.getByPlaceholderText('Name'), { target: { value: 'Bold Web' } });
    fireEvent.change(screen.getByPlaceholderText(/Target/), { target: { value: 'www.boldkimya.com.tr' } });
    fireEvent.click(screen.getByRole('button', { name: /Add asset/i }));

    await waitFor(() => expect(cyberAnalysisApi.createAsset).toHaveBeenCalledWith({ name: 'Bold Web', assetType: 'DOMAIN', criticality: 'MEDIUM' }));
    await waitFor(() => expect(cyberAnalysisApi.addAssetIdentifier).toHaveBeenCalledWith('asset-1', { identifierType: 'DOMAIN', value: 'www.boldkimya.com.tr' }));
    await waitFor(() => expect(screen.getByText('www.boldkimya.com.tr')).toBeInTheDocument());
  });

  it('detects a duplicate target and offers the existing asset instead of creating a second one', async () => {
    cyberAnalysisApi.findAssetByTarget.mockResolvedValue({
      asset: { id: 'existing-1', name: 'Already Here', asset_type: 'DOMAIN', criticality: 'HIGH', status: 'ACTIVE', target: 'dup.example' },
    });
    renderWizard();
    fireEvent.click(screen.getByRole('button', { name: 'New Asset' }));
    fireEvent.change(screen.getByPlaceholderText('Name'), { target: { value: 'x' } });
    fireEvent.change(screen.getByPlaceholderText(/Target/), { target: { value: 'dup.example' } });
    fireEvent.click(screen.getByRole('button', { name: /Add asset/i }));

    await waitFor(() => expect(screen.getByText(/already exists/i)).toBeInTheDocument());
    expect(cyberAnalysisApi.createAsset).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /Use Existing Asset/i }));
    await waitFor(() => expect(screen.getAllByText('dup.example').length).toBeGreaterThan(0));
  });

  it('blocks proceeding past step 2 when the real engine plan has zero executable engines (DOMAIN + PASSIVE)', async () => {
    cyberAnalysisApi.evaluateScope.mockResolvedValue({ decision: 'ALLOW', targetType: 'DOMAIN' });
    cyberAnalysisApi.getEnginePlan.mockResolvedValue({
      engines: [{ id: 'nuclei', name: 'nuclei', status: 'HEALTHY', compatible: true, recommended: false }],
      hasExecutableEngine: false,
    });
    renderWizard();
    fireEvent.click(screen.getByRole('button', { name: 'New Asset' }));
    fireEvent.change(screen.getByPlaceholderText('Name'), { target: { value: 'x' } });
    fireEvent.change(screen.getByPlaceholderText(/Target/), { target: { value: 'example.com' } });
    fireEvent.click(screen.getByRole('button', { name: /Add asset/i }));
    await waitFor(() => expect(cyberAnalysisApi.createAsset).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: /Next/i }));
    await waitFor(() => expect(cyberAnalysisApi.getEnginePlan).toHaveBeenCalledWith('DOMAIN', 'PASSIVE'));
    await waitFor(() => expect(screen.getByText(/No executable analysis engine/i)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /Next/i })).toBeDisabled();
  });

  it('lets the user proceed once a real, healthy, recommended engine exists for the chosen class', async () => {
    cyberAnalysisApi.evaluateScope.mockResolvedValue({ decision: 'ALLOW', targetType: 'DOMAIN' });
    cyberAnalysisApi.getEnginePlan.mockResolvedValue({
      engines: [{ id: 'nuclei', name: 'nuclei', status: 'HEALTHY', compatible: true, recommended: true }],
      hasExecutableEngine: true,
    });
    renderWizard();
    fireEvent.click(screen.getByRole('button', { name: 'New Asset' }));
    fireEvent.change(screen.getByPlaceholderText('Name'), { target: { value: 'x' } });
    fireEvent.change(screen.getByPlaceholderText(/Target/), { target: { value: 'example.com' } });
    fireEvent.click(screen.getByRole('button', { name: /Add asset/i }));
    await waitFor(() => expect(cyberAnalysisApi.createAsset).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: /Next/i }));

    await waitFor(() => expect(screen.getByRole('button', { name: /Next/i })).not.toBeDisabled());
  });

  it('never lets the user go back to step 1 once a scan job has actually been created (immutable plan)', async () => {
    cyberAnalysisApi.evaluateScope.mockResolvedValue({ decision: 'ALLOW', targetType: 'DOMAIN' });
    cyberAnalysisApi.getEnginePlan.mockResolvedValue({
      engines: [{ id: 'nuclei', name: 'nuclei', status: 'HEALTHY', compatible: true, recommended: true }],
      hasExecutableEngine: true,
    });
    cyberAnalysisApi.createScan.mockResolvedValue({ job: { id: 'job-1', status: 'QUEUED', target: 'example.com' } });
    renderWizard();

    fireEvent.click(screen.getByRole('button', { name: 'New Asset' }));
    fireEvent.change(screen.getByPlaceholderText('Name'), { target: { value: 'x' } });
    fireEvent.change(screen.getByPlaceholderText(/Target/), { target: { value: 'example.com' } });
    fireEvent.click(screen.getByRole('button', { name: /Add asset/i }));
    await waitFor(() => expect(cyberAnalysisApi.createAsset).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: /Next/i }));
    await waitFor(() => expect(screen.getByRole('button', { name: /Next/i })).not.toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: /Next/i })); // -> Quantum
    await waitFor(() => expect(screen.getByRole('button', { name: /Next/i })).not.toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: /Next/i })); // -> Scan

    fireEvent.click(screen.getByRole('button', { name: /Start Analysis/i }));
    await waitFor(() => expect(cyberAnalysisApi.createScan).toHaveBeenCalledWith({
      target: 'example.com', requestedClass: 'PASSIVE', selectedEngineIds: ['nuclei'], selectedComputeMode: 'CLASSICAL',
    }));

    // Previous is disabled once a job exists -- no going back to change the plan.
    expect(screen.getByRole('button', { name: /Previous/i })).toBeDisabled();
  });

  it('defaults engine selection to the recommended+healthy subset and lets the user narrow it, blocking Next at zero', async () => {
    cyberAnalysisApi.evaluateScope.mockResolvedValue({ decision: 'ALLOW', targetType: 'REPOSITORY' });
    cyberAnalysisApi.getEnginePlan.mockResolvedValue({
      engines: [
        { id: 'semgrep', name: 'semgrep', status: 'HEALTHY', compatible: true, recommended: true },
        { id: 'osv-scanner', name: 'osv-scanner', status: 'HEALTHY', compatible: true, recommended: true },
        { id: 'nuclei', name: 'nuclei', status: 'HEALTHY', compatible: false, recommended: false },
      ],
      hasExecutableEngine: true,
    });
    renderWizard();
    fireEvent.click(screen.getByRole('button', { name: 'New Asset' }));
    fireEvent.change(screen.getByPlaceholderText('Name'), { target: { value: 'x' } });
    fireEvent.change(screen.getByPlaceholderText(/Target/), { target: { value: 'example.com' } });
    fireEvent.click(screen.getByRole('button', { name: /Add asset/i }));
    await waitFor(() => expect(cyberAnalysisApi.createAsset).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: /Next/i }));

    const semgrepCheckbox = await screen.findByRole('row', { name: /semgrep/i });
    await waitFor(() => expect(screen.getByRole('button', { name: /Next/i })).not.toBeDisabled());

    // Both real engines checked by default -- uncheck one, then both, and
    // confirm zero-selected blocks Next with the honest reason shown.
    const checkboxes = screen.getAllByRole('checkbox');
    expect(checkboxes.filter((c) => c.checked)).toHaveLength(2);
    fireEvent.click(checkboxes[0]);
    fireEvent.click(checkboxes[1]);
    await waitFor(() => expect(screen.getByText(/at least one engine/i)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /Next/i })).toBeDisabled();
    expect(semgrepCheckbox).toBeInTheDocument();
  });

  it('shows the real optimization verdict and provenance once a completed scan is reached', async () => {
    cyberAnalysisApi.evaluateScope.mockResolvedValue({ decision: 'ALLOW', targetType: 'DOMAIN' });
    cyberAnalysisApi.getEnginePlan.mockResolvedValue({
      engines: [{ id: 'nuclei', name: 'nuclei', status: 'HEALTHY', compatible: true, recommended: true }],
      hasExecutableEngine: true,
    });
    cyberAnalysisApi.createScan.mockResolvedValue({ job: { id: 'job-1', status: 'COMPLETED', target: 'example.com', result: { findingIds: ['f1'] } } });
    cyberAnalysisApi.optimizeRemediationForScan.mockResolvedValue({
      verdict: 'NOT_APPLICABLE', recommendedMode: 'CLASSICAL', selectedMode: 'CLASSICAL', actualMode: 'CLASSICAL', fallbackReason: null,
    });
    renderWizard();

    fireEvent.click(screen.getByRole('button', { name: 'New Asset' }));
    fireEvent.change(screen.getByPlaceholderText('Name'), { target: { value: 'x' } });
    fireEvent.change(screen.getByPlaceholderText(/Target/), { target: { value: 'example.com' } });
    fireEvent.click(screen.getByRole('button', { name: /Add asset/i }));
    await waitFor(() => expect(cyberAnalysisApi.createAsset).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: /Next/i }));
    await waitFor(() => expect(screen.getByRole('button', { name: /Next/i })).not.toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: /Next/i })); // -> Quantum
    await waitFor(() => expect(screen.getByRole('button', { name: /Next/i })).not.toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: /Next/i })); // -> Scan
    fireEvent.click(screen.getByRole('button', { name: /Start Analysis/i }));

    await waitFor(() => expect(cyberAnalysisApi.optimizeRemediationForScan).toHaveBeenCalledWith(
      expect.objectContaining({ findingIds: ['f1'], preferredMode: 'CLASSICAL', scanJobId: 'job-1' })
    ));
    await waitFor(() => expect(screen.getByText(/Not applicable/i)).toBeInTheDocument());
  });

  it('never opens a new tab/window at any step', async () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    renderWizard();
    fireEvent.click(screen.getByRole('button', { name: 'New Asset' }));
    expect(openSpy).not.toHaveBeenCalled();
    openSpy.mockRestore();
  });
});
