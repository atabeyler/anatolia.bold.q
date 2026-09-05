import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import CyberAnalysisWizard from './CyberAnalysisWizard.jsx';
import { LangProvider } from '../services/langContext.jsx';
import { api, cyberAnalysisApi } from '../services/api.js';

vi.mock('../services/api.js', () => ({
  api: {
    cyberAnalysisStatus: vi.fn(async () => ({ available: true })),
    cyberAnalysisOverview: vi.fn(async () => ({ securityScore: { score: 82 }, coverageScore: { score: 40 } })),
    cyberAnalysisFindings: vi.fn(async () => ({ findings: [] })),
  },
  cyberAnalysisApi: {
    evaluateScope: vi.fn(),
    createScope: vi.fn(),
    createScan: vi.fn(),
    getScan: vi.fn(),
    generateReport: vi.fn(),
  },
}));

function renderWizard() {
  return render(<LangProvider><CyberAnalysisWizard /></LangProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  api.cyberAnalysisStatus.mockResolvedValue({ available: true });
  localStorage.removeItem('anatolia_lang');
});

describe('CyberAnalysisWizard', () => {
  it('shows a clear unavailable message with a retry action when BCI is not configured -- never a silent bounce', async () => {
    api.cyberAnalysisStatus.mockResolvedValue({ available: false });
    renderWizard();
    await waitFor(() => expect(screen.getByText(/BOLD Cyber Intelligence/i)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /Tekrar Dene/i })).toBeInTheDocument();
  });

  it('retries the status check when BCI later becomes available', async () => {
    api.cyberAnalysisStatus.mockResolvedValueOnce({ available: false }).mockResolvedValueOnce({ available: true });
    renderWizard();
    await waitFor(() => screen.getByRole('button', { name: /Tekrar Dene/i }));
    fireEvent.click(screen.getByRole('button', { name: /Tekrar Dene/i }));
    await waitFor(() => expect(screen.getByPlaceholderText(/example.com/i)).toBeInTheDocument());
  });

  it('starts on the target step and never opens a new tab/window anywhere in the flow', async () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    renderWizard();
    await waitFor(() => expect(screen.getByPlaceholderText(/example.com/i)).toBeInTheDocument());
    expect(openSpy).not.toHaveBeenCalled();
    openSpy.mockRestore();
  });

  it('blocks progression past authorization until the real backend returns ALLOW', async () => {
    cyberAnalysisApi.evaluateScope.mockResolvedValue({ decision: 'DENY', reason: 'no_matching_scope' });
    renderWizard();
    await waitFor(() => screen.getByPlaceholderText(/example.com/i));
    fireEvent.change(screen.getByPlaceholderText(/example.com/i), { target: { value: 'example.com' } });
    fireEvent.click(screen.getByRole('button', { name: /İleri/i }));

    fireEvent.click(screen.getByRole('button', { name: /Yetkiyi Kontrol Et/i }));
    await waitFor(() => expect(cyberAnalysisApi.evaluateScope).toHaveBeenCalledWith('example.com', 'PASSIVE'));
    expect(screen.getByText(/Yetkili değil/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /İleri/i })).toBeDisabled();
  });

  it('advances to the start step only once the backend allows the scan', async () => {
    cyberAnalysisApi.evaluateScope.mockResolvedValue({ decision: 'ALLOW' });
    renderWizard();
    await waitFor(() => screen.getByPlaceholderText(/example.com/i));
    fireEvent.change(screen.getByPlaceholderText(/example.com/i), { target: { value: 'example.com' } });
    fireEvent.click(screen.getByRole('button', { name: /İleri/i }));
    fireEvent.click(screen.getByRole('button', { name: /Yetkiyi Kontrol Et/i }));
    await waitFor(() => expect(screen.getByText(/Yetkili — analiz başlatılabilir/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /İleri/i }));
    expect(screen.getByRole('button', { name: /Analizi Başlat/i })).toBeInTheDocument();
  });

  it('starts a real scan via the BCI integration API and polls until COMPLETED, then renders real results', async () => {
    cyberAnalysisApi.evaluateScope.mockResolvedValue({ decision: 'ALLOW' });
    cyberAnalysisApi.createScan.mockResolvedValue({ job: { id: 'job1', status: 'QUEUED' } });
    cyberAnalysisApi.getScan
      .mockResolvedValueOnce({ job: { id: 'job1', status: 'ANALYZING' } })
      .mockResolvedValueOnce({ job: { id: 'job1', status: 'COMPLETED' } });
    api.cyberAnalysisFindings.mockResolvedValue({ findings: [{ id: 'f1', target: 'example.com', title: 'Outdated TLS', category: 'crypto', priority: 'HIGH', risk_score: 70 }] });

    renderWizard();
    await waitFor(() => screen.getByPlaceholderText(/example.com/i));
    fireEvent.change(screen.getByPlaceholderText(/example.com/i), { target: { value: 'example.com' } });
    fireEvent.click(screen.getByRole('button', { name: /İleri/i }));
    fireEvent.click(screen.getByRole('button', { name: /Yetkiyi Kontrol Et/i }));
    await waitFor(() => expect(screen.getByText(/Yetkili — analiz başlatılabilir/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /İleri/i }));
    fireEvent.click(screen.getByRole('button', { name: /Analizi Başlat/i }));

    await waitFor(() => expect(cyberAnalysisApi.createScan).toHaveBeenCalledWith({ target: 'example.com', requestedClass: 'PASSIVE' }));
    // First poll (immediate) reports ANALYZING -- the real-only status, no
    // fabricated percentage.
    await waitFor(() => expect(screen.getByText(/Analiz çalışıyor/i)).toBeInTheDocument());
    // The wizard's own poll interval is real (4s); wait past it for the
    // second poll (COMPLETED) to land.
    await waitFor(() => expect(screen.getByText('Outdated TLS')).toBeInTheDocument(), { timeout: 8000 });
    expect(screen.getByText('82')).toBeInTheDocument();
  }, 12000);
});
