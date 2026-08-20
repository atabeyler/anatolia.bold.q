import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import AnalysisView from './AnalysisView.jsx';
import { LangProvider } from '../services/langContext.jsx';
import { api } from '../services/api.js';

vi.mock('../services/api.js', () => ({
  api: {
    generateAnalysis: vi.fn(async () => ({
      success: true, content: '# Rapor', docxBase64: btoa('docx-bytes'), pdfBase64: btoa('pdf-bytes'), quantumMode: false,
    })),
    scenarioDeepDive: vi.fn(async () => ({ content: '# Alt senaryo' })),
  },
}));

// ConsultChat has its own extensive test coverage (ConsultChat.test.jsx) and
// its own set of mocked dependencies -- stub it here so AnalysisView tests
// only exercise AnalysisView's own logic (the "danisma" category just
// delegates to it wholesale).
vi.mock('./ConsultChat.jsx', () => ({ default: () => <div>ConsultChat stub</div> }));

function renderView(props = {}) {
  return render(<LangProvider><AnalysisView category={null} onCategoryChange={vi.fn()} {...props} /></LangProvider>);
}

// The wizard now gates the prompt/quantum-mode/generate fields behind its
// 5-step flow (see AnalysisWizard.jsx) -- the prompt textarea lives on step
// 1, the quantum-mode toggle on step 3, and the actual "generate" button on
// step 5. Clicks "SONRAKİ" `times` times from whatever step is current.
function clickNext(times) {
  for (let i = 0; i < times; i++) {
    fireEvent.click(screen.getByRole('button', { name: /SONRAKİ/i }));
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn(() => 'blob:fake'), revokeObjectURL: vi.fn() });
});

describe('AnalysisView', () => {
  it('shows the category picker when no category is selected', () => {
    const onCategoryChange = vi.fn();
    renderView({ category: null, onCategoryChange });
    fireEvent.click(screen.getByText('Savunma').closest('button'));
    expect(onCategoryChange).toHaveBeenCalledWith('savunma');
  });

  it('delegates to ConsultChat for the "danisma" category', () => {
    renderView({ category: 'danisma' });
    expect(screen.getByText('ConsultChat stub')).toBeInTheDocument();
  });

  it('opens the new-analysis wizard for a selected category, with the generate button disabled until a prompt is entered', () => {
    renderView({ category: 'ekonomi' });
    expect(screen.getByText('Yeni Analiz Başlat')).toBeInTheDocument();
    clickNext(4);
    expect(screen.getByRole('button', { name: /DETAYLI ANALİZ RAPORU ÜRET/i })).toBeDisabled();
  });

  it('enables the generate button once a prompt is entered', () => {
    renderView({ category: 'ekonomi' });
    const textarea = screen.getAllByRole('textbox').find((el) => el.tagName === 'TEXTAREA');
    fireEvent.change(textarea, { target: { value: 'test brief' } });
    clickNext(4);
    expect(screen.getByRole('button', { name: /DETAYLI ANALİZ RAPORU ÜRET/i })).not.toBeDisabled();
  });

  it('generates a standard analysis and renders the markdown report', async () => {
    renderView({ category: 'ekonomi' });
    const textarea = screen.getAllByRole('textbox').find((el) => el.tagName === 'TEXTAREA');
    fireEvent.change(textarea, { target: { value: 'ekonomik brifing talebi' } });
    clickNext(4);
    fireEvent.click(screen.getByRole('button', { name: /DETAYLI ANALİZ RAPORU ÜRET/i }));

    await waitFor(() => expect(api.generateAnalysis).toHaveBeenCalled());
    expect(api.generateAnalysis.mock.calls[0][0]).toBe('ekonomi');
    expect(api.generateAnalysis.mock.calls[0][3]).toBe(false); // quantumMode off by default
    expect(api.generateAnalysis.mock.calls[0][10]).toBe('normal'); // priority default
    expect(api.generateAnalysis.mock.calls[0][11]).toBe('standart'); // depth default
    expect(await screen.findByText('Rapor')).toBeInTheDocument();
  });

  it('passes quantumMode=true through to the API when the quantum toggle is checked', async () => {
    renderView({ category: 'ekonomi' });
    const textarea = screen.getAllByRole('textbox').find((el) => el.tagName === 'TEXTAREA');
    fireEvent.change(textarea, { target: { value: 'brief' } });
    clickNext(2);
    fireEvent.click(screen.getByText('KUANTUM OLASILIK MODU'));
    clickNext(2);
    fireEvent.click(screen.getByRole('button', { name: /KUANTUM OLASILIK ANALİZİ BAŞLAT/i }));

    await waitFor(() => expect(api.generateAnalysis).toHaveBeenCalled());
    expect(api.generateAnalysis.mock.calls[0][3]).toBe(true);
  });

  it('shows an error message when generation fails', async () => {
    api.generateAnalysis.mockRejectedValueOnce(new Error('sunucu hatasi'));
    renderView({ category: 'ekonomi' });
    const textarea = screen.getAllByRole('textbox').find((el) => el.tagName === 'TEXTAREA');
    fireEvent.change(textarea, { target: { value: 'brief' } });
    clickNext(4);
    fireEvent.click(screen.getByRole('button', { name: /DETAYLI ANALİZ RAPORU ÜRET/i }));
    expect(await screen.findByText(/sunucu hatasi/)).toBeInTheDocument();
  });

  it('shows the quantum backend badge and lets the user reset after a quantum result', async () => {
    api.generateAnalysis.mockResolvedValueOnce({
      success: true,
      content: '# Kuantum Rapor',
      docxBase64: btoa('x'),
      quantumMode: true,
      quantum: { backend: 'qiskit-aer-simulator', qubits: 3, shots: 4096 },
      scenarios: [{ id: 'A', title: 'Senaryo A', quantumProbability: 42, llmEstimate: 40 }],
    });
    renderView({ category: 'ekonomi' });
    const textarea = screen.getAllByRole('textbox').find((el) => el.tagName === 'TEXTAREA');
    fireEvent.change(textarea, { target: { value: 'brief' } });
    clickNext(2);
    fireEvent.click(screen.getByText('KUANTUM OLASILIK MODU'));
    clickNext(2);
    fireEvent.click(screen.getByRole('button', { name: /KUANTUM OLASILIK ANALİZİ BAŞLAT/i }));

    expect(await screen.findByText(/qiskit-aer-simulator/)).toBeInTheDocument();
    // Rendered twice -- once in the ScenarioPanel list, once as an axis label
    // in ScenarioComparisonChart (since this scenario has a quantumProbability).
    expect(screen.getAllByText('Senaryo A').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByText('YENİ ANALİZ'));
    expect(screen.queryByText(/qiskit-aer-simulator/)).not.toBeInTheDocument();
    // The wizard reopens automatically once the result is cleared (see
    // AnalysisView.jsx: it's shown whenever there is a category but no result).
    expect(screen.getByText('Yeni Analiz Başlat')).toBeInTheDocument();
  });

  it('drills into an alternative scenario and back', async () => {
    api.generateAnalysis.mockResolvedValueOnce({
      success: true,
      content: '# Kuantum Rapor',
      docxBase64: btoa('x'),
      quantumMode: true,
      scenarios: [
        { id: 'A', title: 'Senaryo A (Birincil)', quantumProbability: 42, llmEstimate: 40 },
        { id: 'B', title: 'Senaryo B', quantumProbability: 30, llmEstimate: 28 },
      ],
    });
    renderView({ category: 'ekonomi' });
    const textarea = screen.getAllByRole('textbox').find((el) => el.tagName === 'TEXTAREA');
    fireEvent.change(textarea, { target: { value: 'brief' } });
    clickNext(2);
    fireEvent.click(screen.getByText('KUANTUM OLASILIK MODU'));
    clickNext(2);
    fireEvent.click(screen.getByRole('button', { name: /KUANTUM OLASILIK ANALİZİ BAŞLAT/i }));
    await waitFor(() => expect(screen.getAllByText('Senaryo B').length).toBeGreaterThan(0));

    fireEvent.click(screen.getByRole('button', { name: 'ANALİZ ET' }));
    await waitFor(() => expect(api.scenarioDeepDive).toHaveBeenCalledWith('ekonomi', 'B', 'Senaryo B', 'tr'));
    expect(await screen.findByText('Alt senaryo')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Ana Rapora Dön'));
    expect(screen.queryByText('Alt senaryo')).not.toBeInTheDocument();
  });

  it('downloads the PDF as a client-side blob (no extra network call, since it comes back with the analysis)', async () => {
    renderView({ category: 'ekonomi' });
    const textarea = screen.getAllByRole('textbox').find((el) => el.tagName === 'TEXTAREA');
    fireEvent.change(textarea, { target: { value: 'brief' } });
    clickNext(4);
    fireEvent.click(screen.getByRole('button', { name: /DETAYLI ANALİZ RAPORU ÜRET/i }));
    await screen.findByText('Rapor');

    fireEvent.click(screen.getByRole('button', { name: /\.PDF İNDİR/i }));
    expect(URL.createObjectURL).toHaveBeenCalled();
  });

  it('shares the report via the Web Share API when the platform supports file sharing', async () => {
    const shareMock = vi.fn(async () => {});
    vi.stubGlobal('navigator', { ...navigator, canShare: () => true, share: shareMock });
    renderView({ category: 'ekonomi' });
    const textarea = screen.getAllByRole('textbox').find((el) => el.tagName === 'TEXTAREA');
    fireEvent.change(textarea, { target: { value: 'brief' } });
    clickNext(4);
    fireEvent.click(screen.getByRole('button', { name: /DETAYLI ANALİZ RAPORU ÜRET/i }));
    await screen.findByText('Rapor');

    fireEvent.click(screen.getByRole('button', { name: /PAYLAŞ/i }));
    await waitFor(() => expect(shareMock).toHaveBeenCalled());
  });

  it('falls back to a plain download when sharing when the platform has no file-share support', async () => {
    vi.stubGlobal('navigator', { ...navigator, canShare: undefined, share: undefined });
    renderView({ category: 'ekonomi' });
    const textarea = screen.getAllByRole('textbox').find((el) => el.tagName === 'TEXTAREA');
    fireEvent.change(textarea, { target: { value: 'brief' } });
    clickNext(4);
    fireEvent.click(screen.getByRole('button', { name: /DETAYLI ANALİZ RAPORU ÜRET/i }));
    await screen.findByText('Rapor');

    fireEvent.click(screen.getByRole('button', { name: /PAYLAŞ/i }));
    await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalled());
  });

  it('shows a visible warning when quantum mode was requested but the circuit computation failed', async () => {
    api.generateAnalysis.mockResolvedValueOnce({
      success: true, content: '# Rapor', docxBase64: btoa('x'), pdfBase64: btoa('x'),
      quantumMode: true, quantumWarning: 'Kuantum devre hesaplaması başarısız oldu — gösterilen olasılıklar YZ tahminleridir.',
    });
    renderView({ category: 'ekonomi' });
    const textarea = screen.getAllByRole('textbox').find((el) => el.tagName === 'TEXTAREA');
    fireEvent.change(textarea, { target: { value: 'brief' } });
    clickNext(2);
    fireEvent.click(screen.getByText('KUANTUM OLASILIK MODU'));
    clickNext(2);
    fireEvent.click(screen.getByRole('button', { name: /KUANTUM OLASILIK ANALİZİ BAŞLAT/i }));

    expect(await screen.findByText(/Kuantum devre hesaplaması başarısız oldu/)).toBeInTheDocument();
  });

  it('shows no warning when quantum mode succeeds', async () => {
    api.generateAnalysis.mockResolvedValueOnce({
      success: true, content: '# Rapor', docxBase64: btoa('x'), pdfBase64: btoa('x'),
      quantumMode: true, quantumWarning: null,
    });
    renderView({ category: 'ekonomi' });
    const textarea = screen.getAllByRole('textbox').find((el) => el.tagName === 'TEXTAREA');
    fireEvent.change(textarea, { target: { value: 'brief' } });
    clickNext(2);
    fireEvent.click(screen.getByText('KUANTUM OLASILIK MODU'));
    clickNext(2);
    fireEvent.click(screen.getByRole('button', { name: /KUANTUM OLASILIK ANALİZİ BAŞLAT/i }));

    await screen.findByText('Rapor');
    expect(screen.queryByText(/başarısız/)).not.toBeInTheDocument();
  });
});
