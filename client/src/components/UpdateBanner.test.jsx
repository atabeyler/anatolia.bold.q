import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';

afterEach(() => {
  delete window.anatoliaDesktop;
  vi.doUnmock('@capacitor/core');
  vi.resetModules();
});

describe('UpdateBanner (web build)', () => {
  it('renders nothing on the plain web build (neither desktop nor Android)', async () => {
    const { default: UpdateBanner } = await import('./UpdateBanner.jsx');
    const { container } = render(<UpdateBanner />);
    await new Promise((r) => setTimeout(r, 0));
    expect(container).toBeEmptyDOMElement();
  });
});

describe('UpdateBanner (desktop)', () => {
  it('renders nothing when no update is available', async () => {
    window.anatoliaDesktop = {
      isDesktop: true,
      update: { onAvailable: () => () => {}, onProgress: () => () => {} },
    };
    vi.resetModules();
    const { default: UpdateBanner } = await import('./UpdateBanner.jsx');
    const { container } = render(<UpdateBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the version and, on approval, downloads then offers install', async () => {
    let pushAvailable;
    const approve = vi.fn(async () => ({ ok: true }));
    const install = vi.fn();
    window.anatoliaDesktop = {
      isDesktop: true,
      update: {
        onAvailable: (cb) => { pushAvailable = cb; return () => {}; },
        onProgress: () => () => {},
        approve,
        install,
      },
    };
    vi.resetModules();
    const { default: UpdateBanner } = await import('./UpdateBanner.jsx');
    render(<UpdateBanner />);

    act(() => { pushAvailable({ available: true, version: '2.1.140', notes: '' }); });
    await waitFor(() => expect(screen.getByText('A new version is available: v2.1.140')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Update'));
    expect(approve).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByText('Install and Restart')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Install and Restart'));
    expect(install).toHaveBeenCalledTimes(1);
  });

  it('shows an error state when the download fails', async () => {
    let pushAvailable;
    const approve = vi.fn(async () => ({ ok: false, error: 'boom' }));
    window.anatoliaDesktop = {
      isDesktop: true,
      update: { onAvailable: (cb) => { pushAvailable = cb; return () => {}; }, onProgress: () => () => {}, approve, install: vi.fn() },
    };
    vi.resetModules();
    const { default: UpdateBanner } = await import('./UpdateBanner.jsx');
    render(<UpdateBanner />);

    act(() => { pushAvailable({ available: true, version: '2.1.140' }); });
    await waitFor(() => expect(screen.getByText('Update')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Update'));

    await waitFor(() => expect(screen.getByText('Download failed.')).toBeInTheDocument());
  });

  it('lets the user retry the download after a failure', async () => {
    let pushAvailable;
    const approve = vi.fn()
      .mockResolvedValueOnce({ ok: false, error: 'boom' })
      .mockResolvedValueOnce({ ok: true });
    window.anatoliaDesktop = {
      isDesktop: true,
      update: { onAvailable: (cb) => { pushAvailable = cb; return () => {}; }, onProgress: () => () => {}, approve, install: vi.fn() },
    };
    vi.resetModules();
    const { default: UpdateBanner } = await import('./UpdateBanner.jsx');
    render(<UpdateBanner />);

    act(() => { pushAvailable({ available: true, version: '2.1.140' }); });
    await waitFor(() => expect(screen.getByText('Update')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Update'));
    await waitFor(() => expect(screen.getByText('Download failed.')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Try Again'));
    expect(approve).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(screen.getByText('Install and Restart')).toBeInTheDocument());
  });

  it('dismissing the banner hides it', async () => {
    let pushAvailable;
    window.anatoliaDesktop = {
      isDesktop: true,
      update: { onAvailable: (cb) => { pushAvailable = cb; return () => {}; }, onProgress: () => () => {} },
    };
    vi.resetModules();
    const { default: UpdateBanner } = await import('./UpdateBanner.jsx');
    const { container } = render(<UpdateBanner />);

    act(() => { pushAvailable({ available: true, version: '2.1.140' }); });
    await waitFor(() => expect(screen.getByText('Update')).toBeInTheDocument());

    fireEvent.click(screen.getByLabelText('Close'));
    expect(container).toBeEmptyDOMElement();
  });
});

describe('UpdateBanner (Android)', () => {
  it('checks the server on mount and downloads/installs the APK on approval', async () => {
    vi.doMock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => true, getPlatform: () => 'android' } }));
    vi.resetModules();
    // mobileBridge's own bootstrap does a plain fetch() health check -- keep it harmless.
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false })));

    const { default: UpdateBanner } = await import('./UpdateBanner.jsx');
    const mobileBridge = await import('../services/mobileBridge.js');
    mobileBridge.mobileUpdate.check = vi.fn(async () => ({ available: true, version: '2.1.140', url: 'https://x/app.apk', sha256: 'abc123' }));
    const approve = vi.fn(async () => {});
    mobileBridge.mobileUpdate.approve = approve;

    render(<UpdateBanner />);
    await waitFor(() => expect(screen.getByText('A new version is available: v2.1.140')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Update'));
    expect(approve).toHaveBeenCalledWith('https://x/app.apk', 'abc123');

    vi.unstubAllGlobals();
  });

  it('shows an error state when the download/install hand-off fails', async () => {
    vi.doMock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => true, getPlatform: () => 'android' } }));
    vi.resetModules();
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false })));

    const { default: UpdateBanner } = await import('./UpdateBanner.jsx');
    const mobileBridge = await import('../services/mobileBridge.js');
    mobileBridge.mobileUpdate.check = vi.fn(async () => ({ available: true, version: '2.1.140', url: 'https://x/app.apk' }));
    mobileBridge.mobileUpdate.approve = vi.fn(async () => { throw new Error('boom'); });

    render(<UpdateBanner />);
    await waitFor(() => expect(screen.getByText('Update')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Update'));

    await waitFor(() => expect(screen.getByText('Download failed.')).toBeInTheDocument());

    vi.unstubAllGlobals();
  });

  it('retries the check on a 5-minute interval so a failed cold-start attempt still surfaces a later update', async () => {
    vi.doMock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => true, getPlatform: () => 'android' } }));
    vi.resetModules();
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false })));
    vi.useFakeTimers();

    const { default: UpdateBanner } = await import('./UpdateBanner.jsx');
    const mobileBridge = await import('../services/mobileBridge.js');
    let available = false;
    const check = vi.fn(async () => (available ? { available: true, version: '2.1.140', url: 'https://x/app.apk' } : { available: false }));
    mobileBridge.mobileUpdate.check = check;

    render(<UpdateBanner />);
    await act(async () => { await Promise.resolve(); });
    expect(check).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/A new version is available/)).not.toBeInTheDocument();

    available = true;
    await act(async () => { await vi.advanceTimersByTimeAsync(5 * 60 * 1000); });
    expect(check).toHaveBeenCalledTimes(2);
    expect(screen.getByText('A new version is available: v2.1.140')).toBeInTheDocument();

    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
});
