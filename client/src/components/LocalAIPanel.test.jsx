import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';

// Minimal stand-in for useLang()'s t() -- just echoes the key so assertions
// can target the exact i18n key without needing the full i18next bundle,
// same spirit as passing a stub `t` prop the way SecurityPanel/AppMenus.jsx
// tests would.
const t = (key) => key;

afterEach(() => {
  delete window.anatoliaDesktop;
  vi.doUnmock('@capacitor/core');
  vi.resetModules();
});

describe('LocalAIPanel (web build)', () => {
  it('renders nothing without a native bridge', async () => {
    const { default: LocalAIPanel } = await import('./LocalAIPanel.jsx');
    const { container } = render(<LocalAIPanel t={t} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('LocalAIPanel (desktop)', () => {
  it('shows not-installed state and device capability', async () => {
    window.anatoliaDesktop = {
      isDesktop: true,
      ai: {
        modelStatus: async () => ({
          installed: false,
          available: false,
          capability: { capable: true, totalMemBytes: 8 * 1024 * 1024 * 1024, freeDiskBytes: 10 * 1024 * 1024 * 1024, cpuCount: 8 },
          spec: { label: 'Qwen2.5-1.5B-Instruct (Q4_K_M, GGUF)', displayLabel: 'Q LOCAL Standart Model', sizeBytes: 1117320736 },
        }),
        onModelDownloadProgress: () => () => {},
      },
    };
    vi.resetModules();
    const { default: LocalAIPanel } = await import('./LocalAIPanel.jsx');
    render(<LocalAIPanel t={t} />);

    await waitFor(() => expect(screen.getByText('localAINotInstalled')).toBeInTheDocument());
    expect(screen.getByText(/Q LOCAL Standart Model/)).toBeInTheDocument();
    expect(screen.getByText(/8.0 GB/)).toBeInTheDocument();
    expect(screen.getByText('localAIDownloadButton')).toBeInTheDocument();
  });

  it('shows installed state with the remove button, not download', async () => {
    window.anatoliaDesktop = {
      isDesktop: true,
      ai: {
        modelStatus: async () => ({
          installed: true,
          available: true,
          capability: { capable: true, totalMemBytes: 8 * 1024 * 1024 * 1024, cpuCount: 8 },
          spec: { label: 'Qwen2.5-1.5B-Instruct (Q4_K_M, GGUF)', sizeBytes: 1117320736 },
        }),
        onModelDownloadProgress: () => () => {},
      },
    };
    vi.resetModules();
    const { default: LocalAIPanel } = await import('./LocalAIPanel.jsx');
    render(<LocalAIPanel t={t} />);

    await waitFor(() => expect(screen.getByText('localAIInstalled')).toBeInTheDocument());
    expect(screen.getByText('localAIRemoveButton')).toBeInTheDocument();
    expect(screen.queryByText('localAIDownloadButton')).not.toBeInTheDocument();
  });

  it('shows a resumable partial download instead of presenting it as a fresh download', async () => {
    window.anatoliaDesktop = {
      isDesktop: true,
      ai: {
        modelStatus: async () => ({
          installed: false,
          partialBytes: 500 * 1024 * 1024,
          capability: { capable: true, totalMemBytes: 16 * 1024 * 1024 * 1024, cpuCount: 4 },
          spec: { label: 'Qwen2.5-7B-Instruct', sizeBytes: 4683074240 },
        }),
        onModelDownloadProgress: () => () => {},
      },
    };
    vi.resetModules();
    const { default: LocalAIPanel } = await import('./LocalAIPanel.jsx');
    render(<LocalAIPanel t={t} />);

    await waitFor(() => expect(screen.getByText('localAIResumeButton')).toBeInTheDocument());
    expect(screen.getByText(/500 MB \/ 4.4 GB/)).toBeInTheDocument();
    expect(screen.getByText(/localAIPartialDownload/)).toBeInTheDocument();
  });

  it('flags a device below the recommended capability', async () => {
    window.anatoliaDesktop = {
      isDesktop: true,
      ai: {
        modelStatus: async () => ({
          installed: false,
          available: false,
          capability: { capable: false, totalMemBytes: 2 * 1024 * 1024 * 1024, cpuCount: 2 },
          spec: { label: 'Qwen2.5-1.5B-Instruct (Q4_K_M, GGUF)', sizeBytes: 1117320736 },
        }),
        onModelDownloadProgress: () => () => {},
      },
    };
    vi.resetModules();
    const { default: LocalAIPanel } = await import('./LocalAIPanel.jsx');
    render(<LocalAIPanel t={t} />);

    await waitFor(() => expect(screen.getByText('localAINotCapable')).toBeInTheDocument());
  });

  it('downloads the model and refreshes to the installed state', async () => {
    let installed = false;
    const modelDownload = vi.fn(async () => {
      installed = true;
      return { ok: true, path: '/models/qwen.gguf', sha256: 'abc' };
    });
    window.anatoliaDesktop = {
      isDesktop: true,
      ai: {
        modelStatus: async () => ({
          installed,
          capability: { capable: true, totalMemBytes: 8 * 1024 * 1024 * 1024, cpuCount: 8 },
          spec: { label: 'Qwen2.5-1.5B-Instruct (Q4_K_M, GGUF)', sizeBytes: 1117320736 },
        }),
        modelDownload,
        onModelDownloadProgress: () => () => {},
      },
    };
    vi.resetModules();
    const { default: LocalAIPanel } = await import('./LocalAIPanel.jsx');
    render(<LocalAIPanel t={t} />);

    await waitFor(() => expect(screen.getByText('localAIDownloadButton')).toBeInTheDocument());
    fireEvent.click(screen.getByText('localAIDownloadButton'));
    expect(modelDownload).toHaveBeenCalledTimes(1);

    await waitFor(() => expect(screen.getByText('localAIInstalled')).toBeInTheDocument());
  });

  it('shows an honest error when the download/checksum verification fails', async () => {
    window.anatoliaDesktop = {
      isDesktop: true,
      ai: {
        modelStatus: async () => ({
          installed: false,
          capability: { capable: true, totalMemBytes: 8 * 1024 * 1024 * 1024, cpuCount: 8 },
          spec: { label: 'Qwen2.5-1.5B-Instruct (Q4_K_M, GGUF)', sizeBytes: 1117320736 },
        }),
        modelDownload: async () => ({ ok: false, error: 'Model bütünlük kontrolü başarısız (checksum uyuşmadı)' }),
        onModelDownloadProgress: () => () => {},
      },
    };
    vi.resetModules();
    const { default: LocalAIPanel } = await import('./LocalAIPanel.jsx');
    render(<LocalAIPanel t={t} />);

    await waitFor(() => expect(screen.getByText('localAIDownloadButton')).toBeInTheDocument());
    fireEvent.click(screen.getByText('localAIDownloadButton'));

    await waitFor(() => expect(screen.getByText(/bütünlük kontrolü başarısız/)).toBeInTheDocument());
    // Failed download leaves the model not-installed, so Download stays offered again.
    expect(screen.getByText('localAIDownloadButton')).toBeInTheDocument();
  });

  it('removes an installed model', async () => {
    let installed = true;
    const modelRemove = vi.fn(async () => {
      installed = false;
      return { ok: true };
    });
    window.anatoliaDesktop = {
      isDesktop: true,
      ai: {
        modelStatus: async () => ({
          installed,
          capability: { capable: true, totalMemBytes: 8 * 1024 * 1024 * 1024, cpuCount: 8 },
          spec: { label: 'Qwen2.5-1.5B-Instruct (Q4_K_M, GGUF)', sizeBytes: 1117320736 },
        }),
        modelRemove,
        onModelDownloadProgress: () => () => {},
      },
    };
    vi.resetModules();
    const { default: LocalAIPanel } = await import('./LocalAIPanel.jsx');
    render(<LocalAIPanel t={t} />);

    await waitFor(() => expect(screen.getByText('localAIRemoveButton')).toBeInTheDocument());
    fireEvent.click(screen.getByText('localAIRemoveButton'));
    expect(modelRemove).toHaveBeenCalledTimes(1);

    await waitFor(() => expect(screen.getByText('localAINotInstalled')).toBeInTheDocument());
  });

  it('shows indeterminate downloading state, then live progress when reported', async () => {
    let installed = false;
    let pushProgress;
    let resolveDownload;
    const modelDownload = vi.fn(() => new Promise((resolve) => { resolveDownload = resolve; }));
    window.anatoliaDesktop = {
      isDesktop: true,
      ai: {
        modelStatus: async () => ({
          installed,
          capability: { capable: true, totalMemBytes: 8 * 1024 * 1024 * 1024, cpuCount: 8 },
          spec: { label: 'Qwen2.5-1.5B-Instruct (Q4_K_M, GGUF)', sizeBytes: 1117320736 },
        }),
        modelDownload,
        onModelDownloadProgress: (cb) => { pushProgress = cb; return () => {}; },
      },
    };
    vi.resetModules();
    const { default: LocalAIPanel } = await import('./LocalAIPanel.jsx');
    render(<LocalAIPanel t={t} />);

    await waitFor(() => expect(screen.getByText('localAIDownloadButton')).toBeInTheDocument());
    fireEvent.click(screen.getByText('localAIDownloadButton'));

    await waitFor(() => expect(screen.getAllByText('localAIDownloading').length).toBeGreaterThan(0));

    act(() => { pushProgress({ received: 500 * 1024 * 1024, total: 1117320736 }); });
    await waitFor(() => expect(screen.getByText(/500 MB \/ 1.0 GB/)).toBeInTheDocument());

    installed = true;
    resolveDownload({ ok: true, path: '/x', sha256: 'abc' });
    await waitFor(() => expect(screen.getByText('localAIInstalled')).toBeInTheDocument());
  });
});

describe('LocalAIPanel (Android)', () => {
  it('drives the mobile bridge the same way, including progress reported via the direct callback', async () => {
    vi.doMock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => true, getPlatform: () => 'android' } }));
    vi.resetModules();
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false })));

    const { default: LocalAIPanel } = await import('./LocalAIPanel.jsx');
    const mobileBridge = await import('../services/mobileBridge.js');
    mobileBridge.mobileAI.modelStatus = vi.fn(async () => ({
      installed: false,
      capability: { capable: true, totalMemBytes: 8 * 1024 * 1024 * 1024, cpuCount: 8 },
      spec: { label: 'Qwen2.5-1.5B-Instruct (Q4_K_M, GGUF)', sizeBytes: 1117320736 },
    }));
    const modelDownload = vi.fn(async (onProgress) => {
      onProgress?.({ received: 1117320736, total: 1117320736 });
      return { ok: true, path: '/x', sha256: 'abc' };
    });
    mobileBridge.mobileAI.modelDownload = modelDownload;

    render(<LocalAIPanel t={t} />);
    await waitFor(() => expect(screen.getByText('localAIDownloadButton')).toBeInTheDocument());
    fireEvent.click(screen.getByText('localAIDownloadButton'));

    expect(modelDownload).toHaveBeenCalledTimes(1);
    expect(typeof modelDownload.mock.calls[0][0]).toBe('function');

    vi.unstubAllGlobals();
  });
});
